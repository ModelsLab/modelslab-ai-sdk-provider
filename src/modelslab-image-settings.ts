/**
 * Image model IDs for the ModelsLab v7 text-to-image endpoint.
 * Any model ID from https://modelslab.com/models with the `imagen` feature works.
 */
export type ModelsLabImageModelId =
  | 'flux'
  | 'sdxl'
  | 'midjourney'
  | 'imagen-3'
  | 'imagen-4'
  | (string & {});
