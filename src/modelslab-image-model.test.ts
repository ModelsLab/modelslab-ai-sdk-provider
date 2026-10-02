import { APICallError } from '@ai-sdk/provider';
import { generateImage } from 'ai';
import { describe, expect, it, vi } from 'vitest';
import { createModelsLab } from './modelslab-provider';

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const IMAGE_URL = 'https://pub-3626123a908346a7a8be8d9295f44e26.r2.dev/generations/abc.png';

type Call = { url: string; method: string; body?: Record<string, unknown> };

function mockFetch(apiResponses: Array<Record<string, unknown>>) {
  const calls: Call[] = [];
  const queue = [...apiResponses];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push({
      url,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    });

    if (url.startsWith('https://modelslab.com/api/v7/')) {
      const next = queue.shift();
      if (!next) {
        throw new Error(`Unexpected API call to ${url}`);
      }
      return new Response(JSON.stringify(next), {
        status: (next.__httpStatus as number | undefined) ?? 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    return new Response(PNG_BYTES, {
      status: 200,
      headers: { 'content-type': 'image/png' },
    });
  });
  return { fetch, calls };
}

function provider(fetch: typeof globalThis.fetch) {
  return createModelsLab({ apiKey: 'test-key', fetch });
}

const baseCall = {
  prompt: 'a red apple on a white table',
  n: 1,
  size: undefined,
  aspectRatio: undefined,
  seed: undefined,
  files: undefined,
  mask: undefined,
  providerOptions: {},
} as const;

describe('ModelsLabImageModel', () => {
  it('posts to the v7 text-to-image endpoint and downloads the output', async () => {
    const { fetch, calls } = mockFetch([
      { status: 'success', id: 123, output: [IMAGE_URL], generationTime: 2.1 },
    ]);

    const result = await provider(fetch).image('flux').doGenerate(baseCall);

    expect(calls[0].url).toBe('https://modelslab.com/api/v7/images/text-to-image');
    expect(calls[0].method).toBe('POST');
    expect(calls[0].body).toEqual({
      key: 'test-key',
      model_id: 'flux',
      prompt: 'a red apple on a white table',
      samples: 1,
    });
    expect(calls[1].url).toBe(IMAGE_URL);
    expect(result.images).toEqual([PNG_BYTES]);
    expect(result.warnings).toEqual([]);
    expect(result.providerMetadata).toEqual({
      modelslab: { images: [{ url: IMAGE_URL }], id: 123 },
    });
    expect(result.response.modelId).toBe('flux');
  });

  it('maps size, aspect ratio, n and provider options to the request body', async () => {
    const { fetch, calls } = mockFetch([
      { status: 'success', id: 1, output: [IMAGE_URL, IMAGE_URL] },
    ]);

    const result = await provider(fetch).image('sdxl').doGenerate({
      ...baseCall,
      n: 2,
      size: '1024x768',
      aspectRatio: '4:3',
      providerOptions: {
        modelslab: { track_id: 'abc', webhook: 'https://example.com/hook' },
      },
    });

    expect(calls[0].body).toEqual({
      key: 'test-key',
      model_id: 'sdxl',
      prompt: 'a red apple on a white table',
      samples: 2,
      width: 1024,
      height: 768,
      aspect_ratio: '4:3',
      track_id: 'abc',
      webhook: 'https://example.com/hook',
    });
    expect(result.images).toHaveLength(2);
  });

  it('polls the fetch endpoint while the generation is processing', async () => {
    const { fetch, calls } = mockFetch([
      { status: 'processing', id: 987, output: [], eta: 10 },
      { status: 'processing', id: 987, output: [] },
      { status: 'success', id: 987, output: [IMAGE_URL] },
    ]);

    const result = await provider(fetch).image('flux').doGenerate({
      ...baseCall,
      providerOptions: { modelslab: { pollIntervalMillis: 1 } },
    });

    expect(calls.map(c => c.url)).toEqual([
      'https://modelslab.com/api/v7/images/text-to-image',
      'https://modelslab.com/api/v7/images/fetch/987',
      'https://modelslab.com/api/v7/images/fetch/987',
      IMAGE_URL,
    ]);
    expect(calls[1].body).toEqual({ key: 'test-key' });
    expect(calls[0].body).not.toHaveProperty('pollIntervalMillis');
    expect(result.images).toEqual([PNG_BYTES]);
  });

  it('throws when a polled generation fails', async () => {
    const { fetch } = mockFetch([
      { status: 'processing', id: 5 },
      { status: 'failed', id: 5, message: 'Request failed, try new API call' },
    ]);

    await expect(
      provider(fetch).image('flux').doGenerate({
        ...baseCall,
        providerOptions: { modelslab: { pollIntervalMillis: 1 } },
      }),
    ).rejects.toThrow('Request failed, try new API call');
  });

  it('times out when the generation never finishes', async () => {
    const { fetch } = mockFetch(
      Array.from({ length: 50 }, () => ({ status: 'processing', id: 5 })),
    );

    await expect(
      provider(fetch).image('flux').doGenerate({
        ...baseCall,
        providerOptions: {
          modelslab: { pollIntervalMillis: 1, pollTimeoutMillis: 5 },
        },
      }),
    ).rejects.toThrow('did not finish within 5 ms');
  });

  it('turns a status:error body (HTTP 200) into an APICallError without leaking the key', async () => {
    const { fetch, calls } = mockFetch([
      { status: 'error', message: 'The selected model id is invalid.' },
    ]);

    const error = await Promise.resolve(
      provider(fetch).image('nope').doGenerate(baseCall),
    ).catch((e: any) => e);

    expect(APICallError.isInstance(error)).toBe(true);
    expect(error.message).toBe('The selected model id is invalid.');
    expect(error.requestBodyValues).not.toHaveProperty('key');
    expect(calls).toHaveLength(1);
  });

  it('reads the legacy "messege" error field', async () => {
    const { fetch } = mockFetch([{ status: 'error', messege: 'Invalid API Key' }]);

    await expect(
      provider(fetch).image('flux').doGenerate(baseCall),
    ).rejects.toThrow('Invalid API Key');
  });

  it('turns a non-2xx response into an APICallError', async () => {
    const { fetch } = mockFetch([
      { __httpStatus: 422, status: 'error', message: 'Model not found or is not ready for generation.' },
    ]);

    const error = await Promise.resolve(
      provider(fetch).image('flux').doGenerate(baseCall),
    ).catch((e: any) => e);
    expect(APICallError.isInstance(error)).toBe(true);
    expect(error.message).toBe('Model not found or is not ready for generation.');
    expect(error.statusCode).toBe(422);
  });

  it('stops polling when the abort signal fires', async () => {
    const { fetch, calls } = mockFetch([
      { status: 'processing', id: 7 },
      { status: 'processing', id: 7 },
    ]);
    const controller = new AbortController();

    const pending = provider(fetch).image('flux').doGenerate({
      ...baseCall,
      abortSignal: controller.signal,
      providerOptions: { modelslab: { pollIntervalMillis: 60_000 } },
    });
    setTimeout(() => controller.abort(), 10);

    await expect(pending).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });

  it('warns about unsupported settings', async () => {
    const { fetch, calls } = mockFetch([{ status: 'success', id: 1, output: [IMAGE_URL] }]);

    const result = await provider(fetch).image('flux').doGenerate({
      ...baseCall,
      seed: 42,
      files: [{ type: 'url', url: 'https://example.com/in.png' }],
    });

    expect(calls[0].body).not.toHaveProperty('seed');
    expect(result.warnings.map(w => w.type === 'unsupported' && w.feature)).toEqual([
      'seed',
      'files',
    ]);
  });

  it('reads the API key from MODELSLAB_API_KEY', async () => {
    vi.stubEnv('MODELSLAB_API_KEY', 'env-key');
    try {
      const { fetch, calls } = mockFetch([{ status: 'success', id: 1, output: [IMAGE_URL] }]);
      await createModelsLab({ fetch }).image('flux').doGenerate(baseCall);
      expect(calls[0].body?.key).toBe('env-key');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('honours a custom baseURL', async () => {
    const { fetch, calls } = mockFetch([]);
    fetch.mockImplementationOnce(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), method: init?.method ?? 'GET' });
      return new Response(JSON.stringify({ status: 'success', id: 1, output: [IMAGE_URL] }), {
        headers: { 'content-type': 'application/json' },
      });
    });

    await createModelsLab({ apiKey: 'k', baseURL: 'https://proxy.example.com/v7/', fetch })
      .image('flux')
      .doGenerate(baseCall);

    expect(calls[0].url).toBe('https://proxy.example.com/v7/images/text-to-image');
  });

  it('works end-to-end with generateImage from the ai package', async () => {
    const { fetch, calls } = mockFetch([
      { status: 'success', id: 1, output: [IMAGE_URL, IMAGE_URL, IMAGE_URL, IMAGE_URL] },
      { status: 'success', id: 2, output: [IMAGE_URL] },
    ]);

    const { images } = await generateImage({
      model: provider(fetch).image('flux'),
      prompt: 'a lighthouse at dusk',
      n: 5,
      size: '512x512',
    });

    expect(images).toHaveLength(5);
    expect(images[0].uint8Array).toEqual(PNG_BYTES);
    const apiBodies = calls.filter(c => c.url.includes('/text-to-image')).map(c => c.body?.samples);
    expect(apiBodies.sort()).toEqual([1, 4]);
  });
});
