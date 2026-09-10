import { promises as fs, constants } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { FolderSchema } from '../shared/schemas';
import type { WorkspaceFolder } from '../shared/types';
import { allowedPath, containsSecret, MAX_FILES, MAX_FILE_SIZE, MAX_FOLDER_SIZE } from '../shared/workspace';
export async function createSnapshot(source: string, snapshotsRoot: string): Promise<WorkspaceFolder> {
  const canonicalSource = await fs.realpath(source);
  if (!(await fs.stat(canonicalSource)).isDirectory())
    throw new Error('Choose a folder to create a working copy.');
  const snapshot: WorkspaceFolder = {
    id: randomUUID(),
    name: path.basename(canonicalSource),
    files: [],
    createdAt: new Date().toISOString(),
    excludedCount: 0,
  };
  const destination = path.join(snapshotsRoot, snapshot.id);
  await fs.mkdir(destination, { recursive: true, mode: 0o700 });
  let bytes = 0,
    examined = 0;
  async function walk(directory: string, depth = 0) {
    if (depth > 12 || examined > 5000) {
      snapshot.excludedCount++;
      return;
    }
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      examined++;
      const full = path.join(directory, entry.name),
        relative = path.relative(canonicalSource, full).split(path.sep).join('/');
      if (
        entry.isSymbolicLink() ||
        entry.name.startsWith('.') ||
        /^(node_modules|dist|build|vendor|coverage|private|credentials?|secrets?)$/i.test(entry.name)
      ) {
        snapshot.excludedCount++;
        continue;
      }
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
        continue;
      }
      if (!entry.isFile() || !allowedPath(relative) || snapshot.files.length >= MAX_FILES) {
        snapshot.excludedCount++;
        continue;
      }
      const handle = await fs.open(full, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = await handle.stat();
        const real = await fs.realpath(full);
        if (
          !real.startsWith(`${canonicalSource}${path.sep}`) ||
          stat.size > MAX_FILE_SIZE ||
          bytes + stat.size > MAX_FOLDER_SIZE
        ) {
          snapshot.excludedCount++;
          continue;
        }
        const data = await handle.readFile();
        if (data.length > MAX_FILE_SIZE || bytes + data.length > MAX_FOLDER_SIZE || data.includes(0)) {
          snapshot.excludedCount++;
          continue;
        }
        const text = data.toString('utf8');
        if (containsSecret(text)) {
          snapshot.excludedCount++;
          continue;
        }
        const target = path.join(destination, 'files', relative);
        await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
        await fs.writeFile(target, data, { mode: 0o600 });
        snapshot.files.push({ path: relative, size: data.length, excerpt: text.slice(0, 1500) });
        bytes += data.length;
      } finally {
        await handle.close();
      }
    }
  }
  try {
    await walk(canonicalSource);
    if (!snapshot.files.length)
      throw new Error('No supported text files found. Try a folder with Markdown, text, or CSV files.');
    await fs.writeFile(path.join(destination, 'manifest.json'), JSON.stringify(snapshot), { mode: 0o600 });
    return snapshot;
  } catch (error) {
    await fs.rm(destination, { recursive: true, force: true });
    throw error;
  }
}
export async function atomicWrite(file: string, data: string | Buffer) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(temp, data, { mode: 0o600 });
  await fs.rename(temp, file);
}

/** Read only the snapshots selected for this assignment or roadmap. */
export async function readSnapshotFiles(
  folderIds: string[],
  folders: WorkspaceFolder[],
  snapshotsRoot: string,
): Promise<{ folder: string; path: string; content: string }[]> {
  const files: { folder: string; path: string; content: string }[] = [];
  let totalBytes = 0;
  for (const id of new Set(folderIds)) {
    if (!folders.some((folder) => folder.id === id))
      throw new Error('That folder is not part of this workspace.');
    const manifest = FolderSchema.parse(
      JSON.parse(await fs.readFile(path.join(snapshotsRoot, id, 'manifest.json'), 'utf8')),
    );
    const base = await fs.realpath(path.join(snapshotsRoot, id, 'files'));
    for (const file of manifest.files) {
      if (!allowedPath(file.path)) throw new Error('An unsafe file was excluded from this request.');
      const target = await fs.realpath(path.join(base, file.path));
      if (!target.startsWith(`${base}${path.sep}`))
        throw new Error('File access outside the snapshot is not allowed.');
      const content = await fs.readFile(target, 'utf8');
      totalBytes += Buffer.byteLength(content);
      if (totalBytes > MAX_FOLDER_SIZE)
        throw new Error('The selected context exceeds the 8 MB upload limit.');
      if (containsSecret(content))
        throw new Error(
          'A file appears to contain a secret. Remove it from the source folder and make a fresh copy.',
        );
      files.push({ folder: manifest.name, path: file.path, content });
    }
  }
  return files;
}
