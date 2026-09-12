import { createHash } from 'node:crypto';
import { mutate } from '../../lib/server/backend';
import { putArtifact } from '../../lib/server/storage';
import type { SessionContext } from '../types';
import type { WorkerRuntime } from './state';

export interface JournalEvent {
  externalId: string;
  type: string;
  text: string;
  createdAt: number;
  gap?: boolean;
}

export async function journal(taskId: string, event: JournalEvent) {
  await mutate('services/sessions:recordEvents', { taskId, events: [event] });
}

const maxFiles = 100;
const maxFileBytes = 25_000_000;

/** Copies session deliverables into the archive once each. Limits are reported, never silent. */
export async function archiveFiles(runtime: WorkerRuntime, context: SessionContext) {
  if (!context.task.sessionId) return;
  const archived = new Set(context.archivedStorageKeys || []);
  let count = 0;
  for await (const artifact of runtime.api.beta.agents.sessions.artifacts.list(context.task.sessionId)) {
    if (++count > maxFiles) {
      await journal(context.task.id, {
        externalId: 'artifact-count-limit',
        type: 'artifact.unavailable',
        text: `This task reached the ${maxFiles}-file archive limit. Keep additional deliverables in a new task.`,
        createdAt: Date.now(),
      });
      break;
    }
    const storageKey = `${context.task.workspaceId}/${context.task.id}/${artifact.id}`;
    if (archived.has(storageKey)) continue;
    if (artifact.size_bytes > maxFileBytes) {
      await journal(context.task.id, {
        externalId: `artifact-limit:${artifact.id}`,
        type: 'artifact.unavailable',
        text: 'A file exceeds the 25 MB archive limit. Ask the employee to split it.',
        createdAt: Date.now(),
      });
      continue;
    }
    const response = await runtime.api.beta.agents.sessions.artifacts.content(artifact.id, {
      session_id: context.task.sessionId,
    });
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxFileBytes) throw new Error('Artifact exceeded archive size limit');
    await putArtifact(storageKey, bytes, 'application/octet-stream');
    await mutate('services/artifacts:recordArtifact', {
      taskId: context.task.id,
      name: artifact.path.split('/').pop() || 'file',
      mediaType: 'application/octet-stream',
      size: bytes.byteLength,
      storageKey,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
  }
}
