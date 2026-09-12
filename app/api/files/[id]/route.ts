import { actor, failure } from '../../../../lib/server/http';
import { query } from '../../../../lib/server/backend';
import { getArtifact } from '../../../../lib/server/storage';
export const runtime = 'nodejs';
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const identity = await actor(),
      { id } = await params;
    const { artifact } = await query<{ artifact: { storageKey: string; name: string; size: number } }>(
      'services/artifacts:artifactContext',
      { ...identity, artifactId: id },
    );
    const file = await getArtifact(artifact.storageKey);
    if (!file.Body) throw new Error('File is unavailable');
    return new Response(file.Body.transformToWebStream() as ReadableStream, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(artifact.name)}`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return failure(error);
  }
}
