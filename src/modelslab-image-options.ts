import { z } from 'zod/v4';

/**
 * Provider options for ModelsLab image generation, passed via
 * `providerOptions: { modelslab: { ... } }`.
 *
 * Request fields (`width`, `height`, `size`, `resolution`, `colors`,
 * `background_color`, `track_id`, `webhook`) are sent to the API as-is and
 * override values derived from the AI SDK `size` / `aspectRatio` settings.
 */
export const modelsLabImageOptionsSchema = z
  .object({
    /** Interval between fetch polls when a generation is queued. Default 2000 ms. */
    pollIntervalMillis: z.number().int().positive().nullish(),
    /** Maximum total time to wait for a queued generation. Default 300000 ms. */
    pollTimeoutMillis: z.number().int().positive().nullish(),
    width: z.number().int().nullish(),
    height: z.number().int().nullish(),
    size: z.string().nullish(),
    resolution: z.string().nullish(),
    colors: z.array(z.unknown()).nullish(),
    background_color: z.unknown().nullish(),
    track_id: z.union([z.string(), z.number()]).nullish(),
    webhook: z.string().nullish(),
  })
  .passthrough();

export type ModelsLabImageOptions = z.infer<typeof modelsLabImageOptionsSchema>;
