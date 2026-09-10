import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { allowedPath, containsSecret, MAX_FILE_SIZE } from '../shared/workspace';
import { atomicWrite, createSnapshot } from '../desktop/workspace';

test('file selection rejects traversal, hidden paths, generated files, and secret-like filenames', () => {
  for (const file of [
    '../notes.md',
    '.env',
    'notes/../../data.txt',
    'node_modules/readme.md',
    'secrets/client.json',
    'config/api-key.json',
    'token.txt',
    'image.png',
    '/etc/private.txt',
  ])
    assert.equal(allowedPath(file), false, file);
  for (const file of ['notes.md', 'research/suppliers.csv', 'src/index.ts', 'docs/brief.txt'])
    assert.equal(allowedPath(file), true, file);
});
test('content scanning catches private keys and credential assignments', () => {
  assert.equal(containsSecret('-----BEGIN PRIVATE KEY-----'), true);
  assert.equal(containsSecret('api_key = "a-secret-value-for-testing"'), true);
  assert.equal(containsSecret('# A client update\nNext milestone: Friday'), false);
});
test('snapshot copies allowed content, excludes symlinks, and never mutates originals', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ahq-snapshot-test-'));
  try {
    const source = path.join(root, 'source');
    const copies = path.join(root, 'copies');
    await fs.mkdir(path.join(source, 'notes'), { recursive: true });
    await fs.writeFile(
      path.join(source, 'notes', 'weekly.md'),
      '# Weekly update\nThe first milestone is complete.',
    );
    await fs.writeFile(path.join(source, '.env'), 'private config');
    await fs.writeFile(path.join(source, 'api-key.json'), '{"key":"private"}');
    await fs.writeFile(path.join(source, 'too-big.txt'), 'x'.repeat(MAX_FILE_SIZE + 1));
    await fs.writeFile(path.join(source, 'binary.txt'), Buffer.from([0, 1, 2, 3]));
    await fs.writeFile(path.join(source, 'settings.txt'), 'password = "do-not-copy-this-value"');
    await fs.writeFile(path.join(root, 'outside.txt'), 'outside the authorized folder');
    await fs.symlink(path.join(root, 'outside.txt'), path.join(source, 'linked.txt'));
    const manifest = await createSnapshot(source, copies);
    assert.equal(manifest.files.length, 1);
    assert.equal(manifest.files[0].path, 'notes/weekly.md');
    assert.equal(manifest.excludedCount, 6);
    await fs.writeFile(path.join(copies, manifest.id, 'files', 'notes', 'weekly.md'), 'edited copy');
    assert.equal(
      await fs.readFile(path.join(source, 'notes', 'weekly.md'), 'utf8'),
      '# Weekly update\nThe first milestone is complete.',
    );
    assert.equal(
      JSON.parse(await fs.readFile(path.join(copies, manifest.id, 'manifest.json'), 'utf8')).id,
      manifest.id,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test('empty or unsupported folders do not leave partial snapshots behind', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ahq-empty-test-'));
  try {
    await fs.mkdir(path.join(root, 'empty'));
    await assert.rejects(
      createSnapshot(path.join(root, 'empty'), path.join(root, 'copies')),
      /No supported text/,
    );
    assert.deepEqual(await fs.readdir(path.join(root, 'copies')), []);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test('atomic writes leave one complete JSON file with private permissions', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ahq-save-test-'));
  try {
    const file = path.join(root, 'workspace.json');
    await atomicWrite(file, '{"version":1}');
    await atomicWrite(file, '{"version":2}');
    assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).version, 2);
    assert.deepEqual(await fs.readdir(root), ['workspace.json']);
    assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
