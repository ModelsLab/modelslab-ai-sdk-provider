import {
  APICallError,
  InvalidResponseDataError,
  type ImageModelV4,
  type SharedV4Warning,
} from '@ai-sdk/provider';
import {
  combineHeaders,
  createBinaryResponseHandler,
  createJsonErrorResponseHandler,
  createJsonResponseHandler,
  createStatusCodeErrorResponseHandler,
  delay,
  getFromApi,
  parseProviderOptions,
  postJsonToApi,
  zodSchema,
  type FetchFunction,
} from '@ai-sdk/provider-utils';
import { z } from 'zod/v4';
import { modelsLabImageOptionsSchema } from './modelslab-image-options';
import type { ModelsLabImageModelId } from './modelslab-image-settings';

const DEFAULT_POLL_INTERVAL_MILLIS = 2000;
const DEFAULT_POLL_TIMEOUT_MILLIS = 5 * 60 * 1000;

export interface ModelsLabImageModelConfig {
  provider: string;
  baseURL: string;
  apiKey: () => string;
  headers: () => Record<string, string | undefined>;
  fetch?: FetchFunction;
  _internal?: {
    currentDate?: () => Date;
  };
}

type ModelsLabResponse = z.infer<typeof modelsLabResponseSchema>;

export class ModelsLabImageModel implements ImageModelV4 {
  readonly specificationVersion = 'v4';
  readonly maxImagesPerCall = 4;
  readonly supportsFileInputs = false;
  readonly supportsMaskInputs = false;

  get provider(): string {
    return this.config.provider;
  }

  constructor(
    readonly modelId: ModelsLabImageModelId,
    private readonly config: ModelsLabImageModelConfig,
  ) {}

  async doGenerate({
    prompt,
    n,
    size,
    aspectRatio,
    seed,
    files,
    mask,
    providerOptions,
    headers,
    abortSignal,
  }: Parameters<ImageModelV4['doGenerate']>[0]): Promise<
    Awaited<ReturnType<ImageModelV4['doGenerate']>>
  > {
    const warnings: Array<SharedV4Warning> = [];

    if (seed != null) {
      warnings.push({
        type: 'unsupported',
        feature: 'seed',
        details: 'The ModelsLab v7 text-to-image endpoint does not accept a seed.',
      });
    }

    if (files != null && files.length > 0) {
      warnings.push({
        type: 'unsupported',
        feature: 'files',
        details: 'Image inputs are not supported by this provider yet.',
      });
    }

    if (mask != null) {
      warnings.push({
        type: 'unsupported',
        feature: 'mask',
        details: 'Mask inputs are not supported by this provider yet.',
      });
    }

    const options = await parseProviderOptions({
      provider: 'modelslab',
      providerOptions,
      schema: zodSchema(modelsLabImageOptionsSchema),
    });

    const {
      pollIntervalMillis,
      pollTimeoutMillis,
      ...requestOptions
    } = options ?? {};

    const dimensions: Record<string, number> = {};
    if (size != null) {
      const [width, height] = size.split('x').map(Number);
      dimensions.width = width;
      dimensions.height = height;
    }

    const body = removeNullish({
      key: this.config.apiKey(),
      model_id: this.modelId,
      prompt,
      samples: n,
      ...dimensions,
      aspect_ratio: aspectRatio,
      ...requestOptions,
    });

    const currentDate = this.config._internal?.currentDate?.() ?? new Date();
    const fullHeaders = combineHeaders(this.config.headers(), headers);
    const url = `${this.config.baseURL}/images/text-to-image`;

    const { value: response, responseHeaders } = await postJsonToApi({
      url,
      headers: fullHeaders,
      body,
      abortSignal,
      fetch: this.config.fetch,
      failedResponseHandler: modelsLabFailedResponseHandler,
      successfulResponseHandler: createJsonResponseHandler(
        zodSchema(modelsLabResponseSchema),
      ),
    });

    const result =
      response.status === 'processing'
        ? await this.pollUntilDone({
            id: response.id,
            headers: fullHeaders,
            abortSignal,
            pollIntervalMillis:
              pollIntervalMillis ?? DEFAULT_POLL_INTERVAL_MILLIS,
            pollTimeoutMillis: pollTimeoutMillis ?? DEFAULT_POLL_TIMEOUT_MILLIS,
          })
        : response;

    const imageUrls = this.getOutputUrls(result, url, body);

    const images = await Promise.all(
      imageUrls.map(imageUrl => this.downloadImage(imageUrl, abortSignal)),
    );

    return {
      images,
      warnings,
      providerMetadata: {
        modelslab: {
          images: imageUrls.map(imageUrl => ({ url: imageUrl })),
          ...(result.id != null ? { id: result.id } : {}),
        },
      },
      response: {
        modelId: this.modelId,
        timestamp: currentDate,
        headers: responseHeaders,
      },
    };
  }

  private async pollUntilDone({
    id,
    headers,
    abortSignal,
    pollIntervalMillis,
    pollTimeoutMillis,
  }: {
    id: string | number | null | undefined;
    headers: Record<string, string | undefined>;
    abortSignal: AbortSignal | undefined;
    pollIntervalMillis: number;
    pollTimeoutMillis: number;
  }): Promise<ModelsLabResponse> {
    if (id == null) {
      throw new InvalidResponseDataError({
        data: { id },
        message: 'ModelsLab returned a processing status without a request id.',
      });
    }

    const url = `${this.config.baseURL}/images/fetch/${encodeURIComponent(String(id))}`;
    const deadline = Date.now() + pollTimeoutMillis;

    while (true) {
      await delay(pollIntervalMillis, { abortSignal });

      const { value } = await postJsonToApi({
        url,
        headers,
        body: { key: this.config.apiKey() },
        abortSignal,
        fetch: this.config.fetch,
        failedResponseHandler: modelsLabFailedResponseHandler,
        successfulResponseHandler: createJsonResponseHandler(
          zodSchema(modelsLabResponseSchema),
        ),
      });

      if (value.status !== 'processing') {
        return { ...value, id: value.id ?? id };
      }

      if (Date.now() >= deadline) {
        throw new Error(
          `ModelsLab image generation ${id} did not finish within ${pollTimeoutMillis} ms.`,
        );
      }
    }
  }

  private getOutputUrls(
    result: ModelsLabResponse,
    url: string,
    requestBodyValues: Record<string, unknown>,
  ): string[] {
    if (result.status === 'success') {
      const output = result.output ?? [];
      if (output.length === 0) {
        throw new InvalidResponseDataError({
          data: result,
          message: 'ModelsLab image generation succeeded but returned no images.',
        });
      }
      return output;
    }

    const { key: _key, ...safeBody } = requestBodyValues;

    throw new APICallError({
      message:
        result.message ??
        result.messege ??
        `ModelsLab image generation failed with status "${result.status}".`,
      url,
      requestBodyValues: safeBody,
      statusCode: 200,
      responseBody: JSON.stringify(result),
      isRetryable: false,
      data: result,
    });
  }

  private async downloadImage(
    url: string,
    abortSignal: AbortSignal | undefined,
  ): Promise<Uint8Array> {
    const { value } = await getFromApi({
      url,
      validateUrl: true,
      trustedOrigin: this.config.baseURL,
      abortSignal,
      fetch: this.config.fetch,
      failedResponseHandler: createStatusCodeErrorResponseHandler(),
      successfulResponseHandler: createBinaryResponseHandler(),
    });
    return value;
  }
}

function removeNullish(
  record: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value != null),
  );
}

const modelsLabResponseSchema = z
  .object({
    status: z.string(),
    id: z.union([z.string(), z.number()]).nullish(),
    output: z.array(z.string()).nullish(),
    message: z.string().nullish(),
    messege: z.string().nullish(),
  })
  .passthrough();

const modelsLabErrorSchema = z
  .object({
    message: z.string().nullish(),
    messege: z.string().nullish(),
    error: z.unknown().nullish(),
  })
  .passthrough();

const modelsLabFailedResponseHandler = createJsonErrorResponseHandler({
  errorSchema: zodSchema(modelsLabErrorSchema),
  errorToMessage: error =>
    error.message ??
    error.messege ??
    (typeof error.error === 'string' ? error.error : 'Unknown ModelsLab error'),
});
