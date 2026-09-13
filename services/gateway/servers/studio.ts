import { createHash, randomUUID } from 'node:crypto';
import {
  IMAGE_QUALITIES,
  IMAGE_SIZES,
  generateImage,
  type ImageQuality,
  type ImageShape,
} from '../../../lib/server/images';
import { putArtifact } from '../../../lib/server/storage';
import { GatewayError } from '../errors';
import { optionalString, requireString, type InternalTool } from './shared';

const MAX_PROMPT = 4000;

function requireChoice<T extends string>(
  args: Record<string, unknown>,
  field: string,
  choices: readonly T[],
  fallback: T,
): T {
  const value = optionalString(args, field) ?? fallback;
  if (!(choices as readonly string[]).includes(value))
    throw new GatewayError('invalid_arguments', `${field} must be one of ${choices.join(', ')}.`);
  return value as T;
}

/** A file name the archive and a person can both use: letters, digits, dashes, one .png. */
function fileName(args: Record<string, unknown>) {
  const raw = (optionalString(args, 'name') ?? 'image').replace(/\.png$/i, '');
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `${slug || 'image'}.png`;
}

/**
 * `generate_image`: a rendered PNG, archived as a deliverable of this task. The bytes never enter the
 * session's environment, so the tool answers with the archive entry a person opens from the task.
 */
const generateImageTool: InternalTool = {
  name: 'generate_image',
  description:
    'Render one image from a written brief and archive it as a deliverable of this task. Describe the subject, composition, style, palette, and any text exactly as it must appear; the model renders text it is given. Returns the archived file, which a person opens from the task. The file does not appear in /workspace/outputs.',
  properties: {
    prompt: { type: 'string', description: 'The brief for the image, specific enough to render once.' },
    name: { type: 'string', description: 'A short file name without extension, such as launch-hero.' },
    shape: {
      type: 'string',
      description: `One of ${Object.keys(IMAGE_SIZES).join(', ')}. Defaults to square.`,
    },
    quality: {
      type: 'string',
      description: `One of ${IMAGE_QUALITIES.join(', ')}. Defaults to medium; use high only for a final asset.`,
    },
  },
  required: ['prompt'],
  async run(request, context, args) {
    // The session only advertises the studio when the version's workshop names a tool; this is the gate.
    if (!context.employeeVersion.workshop?.tools.includes('generate_image'))
      throw new GatewayError('policy_denied', 'This employee’s workshop does not include generate_image.');
    const prompt = requireString(args, 'prompt');
    if (prompt.length > MAX_PROMPT)
      throw new GatewayError('invalid_arguments', `prompt must be at most ${MAX_PROMPT} characters.`);
    const shape = requireChoice<ImageShape>(
      args,
      'shape',
      Object.keys(IMAGE_SIZES) as ImageShape[],
      'square',
    );
    const quality = requireChoice<ImageQuality>(args, 'quality', IMAGE_QUALITIES, 'medium');
    const name = fileName(args);
    const bytes = await generateImage(prompt, shape, quality);
    const storageKey = `${context.task.workspaceId}/${context.task.id}/${randomUUID().replaceAll('-', '')}`;
    await putArtifact(storageKey, bytes, 'image/png');
    const { artifactId } = await request.backend.mutate<{ artifactId: string }>(
      'services/artifacts:recordArtifact',
      {
        taskId: context.task.id,
        name,
        mediaType: 'image/png',
        size: bytes.byteLength,
        storageKey,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      },
    );
    return { artifactId, name, size: IMAGE_SIZES[shape], bytes: bytes.byteLength };
  },
};

export const studioTools = [generateImageTool];
