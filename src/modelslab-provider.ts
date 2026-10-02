import {
  NoSuchModelError,
  type ImageModelV4,
  type ProviderV4,
} from '@ai-sdk/provider';
import {
  loadApiKey,
  withoutTrailingSlash,
  withUserAgentSuffix,
  type FetchFunction,
} from '@ai-sdk/provider-utils';
import { ModelsLabImageModel } from './modelslab-image-model';
import type { ModelsLabImageModelId } from './modelslab-image-settings';
import { VERSION } from './version';

export interface ModelsLabProviderSettings {
  /**
   * ModelsLab API key. Defaults to the `MODELSLAB_API_KEY` environment variable.
   */
  apiKey?: string;
  /**
   * Base URL for API calls. Defaults to `https://modelslab.com/api/v7`.
   */
  baseURL?: string;
  /**
   * Custom headers to include in the requests.
   */
  headers?: Record<string, string>;
  /**
   * Custom fetch implementation, e.g. for testing or middleware.
   */
  fetch?: FetchFunction;
}

export interface ModelsLabProvider extends ProviderV4 {
  /**
   * Creates a ModelsLab image generation model.
   */
  image(modelId: ModelsLabImageModelId): ImageModelV4;

  /**
   * Creates a ModelsLab image generation model.
   */
  imageModel(modelId: ModelsLabImageModelId): ImageModelV4;
}

const defaultBaseURL = 'https://modelslab.com/api/v7';

export function createModelsLab(
  options: ModelsLabProviderSettings = {},
): ModelsLabProvider {
  const baseURL = withoutTrailingSlash(options.baseURL ?? defaultBaseURL);

  const getApiKey = () =>
    loadApiKey({
      apiKey: options.apiKey,
      environmentVariableName: 'MODELSLAB_API_KEY',
      description: 'ModelsLab',
    });

  const getHeaders = () =>
    withUserAgentSuffix(
      { ...options.headers },
      `ai-sdk-modelslab/${VERSION}`,
    );

  const createImageModel = (modelId: ModelsLabImageModelId) =>
    new ModelsLabImageModel(modelId, {
      provider: 'modelslab.image',
      baseURL: baseURL ?? defaultBaseURL,
      apiKey: getApiKey,
      headers: getHeaders,
      fetch: options.fetch,
    });

  return {
    specificationVersion: 'v4' as const,
    image: createImageModel,
    imageModel: createImageModel,
    languageModel: (modelId: string) => {
      throw new NoSuchModelError({ modelId, modelType: 'languageModel' });
    },
    embeddingModel: (modelId: string) => {
      throw new NoSuchModelError({ modelId, modelType: 'embeddingModel' });
    },
  };
}

/**
 * Default ModelsLab provider instance.
 */
export const modelslab = createModelsLab();
