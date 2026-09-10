import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSimulatedPullRequest } from '../runtime/pull-request';

const template = path.resolve('demo-data/checkout');

test('simulated PR includes the real patch and passing tests, excluding office evidence', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'checkout-pr-test-'));
  try {
    await cp(template, workspace, { recursive: true });
    const source = await readFile(path.join(workspace, 'checkout.js'), 'utf8');
    await writeFile(path.join(workspace, 'checkout.js'), source.replace(' + (coupon > 0 ? tax : 0)', ''));
    await writeFile(path.join(workspace, 'evidence.md'), 'Private office evidence');
    await writeFile(path.join(workspace, 'extra.js'), 'export const version = 1;\n');
    await rm(path.join(workspace, 'README.md'));
    const result = await createSimulatedPullRequest({ workspace, template, title: 'Fix coupon tax', workId: 'bug-184', runId: 'run-1' });
    assert.equal(result.testsPassed, true);
    assert.deepEqual(result.changedFiles.sort(), ['README.md', 'checkout.js', 'extra.js']);
    assert.match(result.diff, /-  return discounted \+ tax \+ \(coupon > 0 \? tax : 0\);/);
    assert.match(result.diff, /\+  return discounted \+ tax;/);
    assert.match(result.testOutput, /# fail 0/);
    assert.match(result.content, /Simulated pull request/);
    assert.doesNotMatch(result.content, /Private office evidence/);
    assert.equal(await readFile(result.filePath, 'utf8'), result.content);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('an unfixed project records failures and no patch', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'checkout-pr-test-'));
  try {
    await cp(template, workspace, { recursive: true });
    const result = await createSimulatedPullRequest({ workspace, template, title: 'Unfixed coupon', workId: 'bug-184', runId: 'run-2' });
    assert.equal(result.testsPassed, false);
    assert.equal(result.diff, '');
    assert.deepEqual(result.changedFiles, []);
    assert.match(result.testOutput, /# fail 2/);
    assert.match(result.content, /Result: failed/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
