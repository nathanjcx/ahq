import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { createPackage } from '@electron/asar';
import { build } from 'esbuild';
import electron from 'electron';

test('copies packaged directories from ASAR with nested files and exclusions', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'packaged-copy-'));
  try {
    const source = path.join(temp, 'source');
    await mkdir(path.join(source, 'nested', 'node_modules'), { recursive: true });
    await mkdir(path.join(source, 'empty'));
    const bytes = Buffer.from([0, 255, 1, 128]);
    await writeFile(path.join(source, 'nested', 'asset.bin'), bytes);
    await writeFile(path.join(source, 'nested', 'node_modules', 'excluded'), 'excluded');
    const archive = path.join(temp, 'fixture.asar');
    await createPackage(source, archive);
    const destination = path.join(temp, 'copied');
    const driver = path.join(temp, 'copy.cjs');
    await build({
      stdin: {
        contents: `
          import { copyPackagedDirectory } from './desktop/copy-packaged-directory';
          import path from 'node:path';
          copyPackagedDirectory(${JSON.stringify(archive)}, ${JSON.stringify(destination)},
            file => path.basename(file) !== 'node_modules'
          ).catch(error => { console.error(error); process.exitCode = 1; });
        `,
        resolveDir: process.cwd(),
        loader: 'ts',
      },
      bundle: true,
      platform: 'node',
      format: 'cjs',
      outfile: driver,
    });
    await promisify(execFile)(electron as unknown as string, [driver], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      timeout: 10_000,
    });
    assert.deepEqual(await readFile(path.join(destination, 'nested', 'asset.bin')), bytes);
    assert.deepEqual(await readdir(path.join(destination, 'nested')), ['asset.bin']);
    assert.deepEqual(await readdir(path.join(destination, 'empty')), []);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
