import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Electron supports these reads inside ASAR archives, but not fs.promises.cp.
export async function copyPackagedDirectory(
  source: string,
  destination: string,
  filter: (source: string) => boolean = () => true,
): Promise<void> {
  if (!filter(source)) return;
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) await copyPackagedDirectory(from, to, filter);
    else if (filter(from)) await writeFile(to, await readFile(from));
  }
}
