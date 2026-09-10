import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { finishTask, prepareTask } from '../desktop/demo-execution';
import type { LocalTaskInput } from '../shared/demo';

const signal = () => new AbortController().signal;
async function workspace() {
  return mkdtemp(path.join(os.tmpdir(), 'ahq-evidence-'));
}
const bug: LocalTaskInput = { kind: 'bug', title: 'Fix checkout', files: [] };
test('reports require a real file and export its actual contents as PDF', async () => {
  const cwd = await workspace();
  try {
    const task: LocalTaskInput = {
      kind: 'report',
      title: 'Sales',
      files: [{ name: '../../sales.csv', mediaType: 'text/csv', content: 'sales\n42' }],
    };
    await prepareTask(cwd, task);
    assert.equal(await readFile(path.join(cwd, 'attachments/1-sales.csv'), 'utf8'), 'sales\n42');
    assert.ok((await finishTask(cwd, 'report-1', task, {}, signal())).error);
    await writeFile(path.join(cwd, 'report.md'), '# Sales\n\n42 sales from attachments/1-sales.csv.');
    const result = await finishTask(cwd, 'report-1', task, {}, signal());
    assert.equal(result.error, undefined);
    assert.match(result.artifacts[0].content, /42 sales/);
    assert.equal((await readFile(result.artifacts[0].filePath)).subarray(0, 4).toString(), '%PDF');
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
test('weakening worker tests cannot turn a broken checkout into a verified patch', async () => {
  const cwd = await workspace();
  try {
    await prepareTask(cwd, bug);
    await writeFile(path.join(cwd, 'test/checkout.test.js'), '');
    await writeFile(path.join(cwd, 'patch.md'), 'All tests passed.');
    const result = await finishTask(cwd, 'bug-1', bug, {}, signal());
    assert.match(result.error!, /regression tests failed/);
    assert.equal(result.artifacts.length, 2);
    assert.match(result.artifacts[1].content, /Result: failed/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
test('real checkout fix produces a diff and QA verifies the copied parent identity', async () => {
  const parent = await workspace();
  const qa = await workspace();
  try {
    await prepareTask(parent, bug);
    const source = await readFile(path.join(parent, 'checkout.js'), 'utf8');
    await writeFile(path.join(parent, 'checkout.js'), source.replace(' + (coupon > 0 ? tax : 0)', ''));
    await writeFile(path.join(parent, 'patch.md'), 'Removed double tax.');
    const patch = await finishTask(parent, 'bug-1', bug, {}, signal());
    assert.equal(patch.error, undefined);
    assert.match(patch.artifacts[1].content, /Result: passed/);
    const task: LocalTaskInput = {
      kind: 'qa',
      title: 'Check fix',
      files: [],
      parentWorkspace: parent,
      parentSessionId: 'bug-1',
    };
    const evidence = await prepareTask(qa, task);
    await writeFile(path.join(qa, 'qa.md'), 'Verified parent bug-1.');
    assert.equal((await finishTask(qa, 'qa-1', task, evidence, signal())).error, undefined);
    await writeFile(path.join(qa, 'checkout.js'), source);
    assert.match((await finishTask(qa, 'qa-1', task, evidence, signal())).error!, /modified the parent/);
  } finally {
    await rm(parent, { recursive: true, force: true });
    await rm(qa, { recursive: true, force: true });
  }
});
