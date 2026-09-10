import { readFileSync } from 'node:fs';
import { copyFile, lstat, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { SourceAttachment } from '../src/shared/types';

// Both runtime/ sources and the packaged dist-electron/ bundles sit beside demo-data/.
export const demoDataDirectory = path.resolve(__dirname, '../demo-data');

export function readProjectEvidence(project: string, file: string): string {
  if (!/^[a-z]+$/.test(project) || !/^[a-z0-9-]+\.(csv|md|json)$/.test(file)) {
    throw new Error('Invalid project evidence path');
  }
  return readFileSync(path.join(demoDataDirectory, 'projects', project, file), 'utf8');
}

export function readArrivalSequence(source: 'gmail' | 'slack') {
  const directory = path.join(demoDataDirectory, 'arrivals', source);
  const sequence: Array<{ id: string; label: string; threadId: string; author: string; title: string; content: string; attachments?: string[] }> = JSON.parse(readFileSync(path.join(directory, 'sequence.json'), 'utf8'));
  return sequence.map(({ threadId, attachments, ...event }) => ({
    ...event, source, thread: threadId,
    attachments: (attachments || []).map((file): SourceAttachment => {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(file)) throw new Error('Invalid arrival attachment path');
      return { id: `${event.id}-${file}`, name: file, content: readFileSync(path.join(directory, file), 'utf8'),
        mediaType: file.endsWith('.csv') ? 'text/csv' : file.endsWith('.json') ? 'application/json' : 'text/markdown' };
    }),
  }));
}

async function copyEvidenceDirectory(source: string, destination: string): Promise<void> {
  if (!(await lstat(source)).isDirectory()) throw new Error(`Evidence source is not a directory: ${source}`);
  await mkdir(destination, { recursive: true });
  if (!(await lstat(destination)).isDirectory()) throw new Error(`Evidence destination is not a directory: ${destination}`);
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const target = path.join(destination, entry.name);
    const from = path.join(source, entry.name);
    if (entry.isDirectory()) await copyEvidenceDirectory(from, target);
    else if (entry.isFile()) {
      const existing = await lstat(target).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
      if (existing && !existing.isFile()) throw new Error(`Evidence destination is not a regular file: ${target}`);
      await copyFile(from, target);
    } else throw new Error(`Evidence source is not a regular file or directory: ${from}`);
  }
}

export async function copyProjectEvidence(workspace: string): Promise<void> {
  const data = path.join(workspace, 'data');
  await mkdir(data, { recursive: true });
  if (!(await lstat(data)).isDirectory()) throw new Error('Evidence data directory must not be a symlink');
  await copyEvidenceDirectory(path.join(demoDataDirectory, 'projects'), path.join(data, 'projects'));
}
