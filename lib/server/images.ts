import { agentsClient } from './agents';

export const IMAGE_SIZES = { square: '1024x1024', portrait: '1024x1536', landscape: '1536x1024' } as const;
export const IMAGE_QUALITIES = ['low', 'medium', 'high'] as const;
export type ImageShape = keyof typeof IMAGE_SIZES;
export type ImageQuality = (typeof IMAGE_QUALITIES)[number];

/** The image model deliverables are generated with. One place, so a model change is one line. */
export const IMAGE_MODEL = 'gpt-image-2';

/** Renders one PNG from a prompt. The caller stores it; nothing here touches storage or Convex. */
export async function generateImage(prompt: string, shape: ImageShape, quality: ImageQuality) {
  const result = await agentsClient().images.generate(
    { model: IMAGE_MODEL, prompt, size: IMAGE_SIZES[shape], quality, output_format: 'png', n: 1 },
    { timeout: 180_000 },
  );
  const data = result.data?.[0]?.b64_json;
  if (!data) throw new Error('The image model returned no image');
  return Buffer.from(data, 'base64');
}
