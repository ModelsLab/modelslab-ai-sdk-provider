# @modelslab/ai-sdk-provider

[ModelsLab](https://modelslab.com) provider for the [Vercel AI SDK](https://ai-sdk.dev).
It adds image generation through the ModelsLab v7 text-to-image API, with access to Flux, SDXL, Imagen and thousands of other ModelsLab image models.

- Implements the AI SDK `ImageModelV4` specification (AI SDK 7).
- Polls queued generations until the images are ready.
- Returns the images as bytes, plus the hosted image URLs in `providerMetadata`.

## Install

```bash
npm install @modelslab/ai-sdk-provider ai
```

Requires Node.js 22 or later and `ai` 7.x.

## API key

Create an API key in the [ModelsLab dashboard](https://modelslab.com/dashboard/api-keys) and set it as `MODELSLAB_API_KEY`.
API access requires a paid ModelsLab plan; plans start at $21/month ([pricing](https://modelslab.com/pricing)).

```bash
export MODELSLAB_API_KEY=your_api_key
```

## Usage

```ts
import { modelslab } from '@modelslab/ai-sdk-provider';
import { generateImage } from 'ai';
import { writeFileSync } from 'node:fs';

const { image } = await generateImage({
  model: modelslab.image('flux'),
  prompt: 'A red apple on a white table, studio lighting',
  size: '1024x1024',
});

writeFileSync('apple.png', image.uint8Array);
```

### Custom provider instance

```ts
import { createModelsLab } from '@modelslab/ai-sdk-provider';

const modelslab = createModelsLab({
  apiKey: process.env.MODELSLAB_API_KEY, // default
  baseURL: 'https://modelslab.com/api/v7', // default
  headers: { 'x-my-header': 'value' },
  // fetch: customFetch,
});
```

### Models

Pass any ModelsLab image `model_id` to `modelslab.image()`, for example `flux`, `sdxl`, `midjourney`, `imagen-3` or `imagen-4`.
Browse models at [modelslab.com/models](https://modelslab.com/models).

### Settings

| AI SDK setting | Sent to ModelsLab as | Notes |
| --- | --- | --- |
| `prompt` | `prompt` | |
| `n` | `samples` | Up to 4 per call. The AI SDK splits larger requests. |
| `size` (`"WxH"`) | `width`, `height` | |
| `aspectRatio` | `aspect_ratio` | |
| `seed` | — | Not supported; returns an `unsupported` warning. |
| `files`, `mask` | — | Not supported yet; return an `unsupported` warning. |

### Provider options

```ts
const { images, providerMetadata } = await generateImage({
  model: modelslab.image('flux'),
  prompt: 'A lighthouse at dusk',
  n: 2,
  providerOptions: {
    modelslab: {
      track_id: 'order-123',
      pollIntervalMillis: 2000, // default 2000
      pollTimeoutMillis: 300000, // default 300000 (5 minutes)
    },
  },
});

console.log(providerMetadata.modelslab); // { images: [{ url }], id }
```

`pollIntervalMillis` and `pollTimeoutMillis` control the provider.
All other options (`width`, `height`, `size`, `resolution`, `colors`, `background_color`, `track_id`, `webhook`, ...) go to the API unchanged and override the values derived from the AI SDK settings.

## How it works

1. `POST {baseURL}/images/text-to-image` with your API key in the JSON body (`key`).
2. If the response status is `processing`, poll `POST {baseURL}/images/fetch/{id}` until it is `success`, `failed`/`error`, or the poll timeout expires. The AI SDK `abortSignal` stops the polling.
3. Download each output URL and return the bytes.

ModelsLab returns HTTP 200 with `"status": "error"` for most failures. The provider converts these to an `APICallError` with the API message. The API key is removed from the error's `requestBodyValues`.

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
```

## Links

- [ModelsLab API documentation](https://docs.modelslab.com)
- [AI SDK image generation](https://ai-sdk.dev/docs/ai-sdk-core/image-generation)

## License

MIT
