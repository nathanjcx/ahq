import { constants } from 'node:fs';
import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);

export interface SimulatedPullRequestInput {
  workspace: string;
  template: string;
  title: string;
  workId: string;
  runId: string;
  signal?: AbortSignal;
}

// Reports and evidence belong to the office, not the checkout application.
async function copyProject(source: string, target: string, root = true): Promise<void> {
  await mkdir(target, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || ['.git', 'node_modules'].includes(entry.name)) continue;
    if (entry.isDirectory()) {
      if (!root || ['test', 'src', 'public'].includes(entry.name)) {
        await copyProject(path.join(source, entry.name), path.join(target, entry.name), false);
      }
    } else if (
      !root ||
      /\.(?:[cm]?js|ts|html|css)$/.test(entry.name) ||
      ['package.json', 'package-lock.json', 'README.md'].includes(entry.name)
    ) {
      await cp(path.join(source, entry.name), path.join(target, entry.name));
    }
  }
}

export async function createSimulatedPullRequest(input: SimulatedPullRequestInput) {
  input.signal?.throwIfAborted();
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'office-pr-'));
  try {
    const baseline = path.join(temporary, 'base');
    await copyProject(input.template, baseline);
    await copyProject(input.workspace, path.join(temporary, 'head'));
    let diff = '';
    try {
      const result = await execute(
        'git',
        ['diff', '--no-index', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/', '--', 'base', 'head'],
        { cwd: temporary, signal: input.signal, maxBuffer: 4 * 1024 * 1024 },
      );
      diff = result.stdout;
    } catch (error) {
      const result = error as Error & { code?: number; stdout?: string };
      if (result.code !== 1) throw error;
      diff = result.stdout ?? '';
    }
    const changedFiles = [
      ...new Set(
        [...diff.matchAll(/^(?:--- a\/base\/(.+)|\+\+\+ b\/head\/(.+))$/gm)].map(
          (match) => match[1] || match[2],
        ),
      ),
    ];
    // Verify an isolated code copy with the original regression tests restored.
    // A worker cannot pass verification by deleting or weakening those tests.
    const verification = path.join(temporary, 'head');
    await cp(path.join(baseline, 'test'), path.join(verification, 'test'), { recursive: true });
    let testsPassed = true;
    let testOutput: string;
    try {
      const env = { ...process.env };
      delete env.NODE_TEST_CONTEXT;
      if (process.versions.electron) env.ELECTRON_RUN_AS_NODE = '1';
      const result = await execute(process.execPath, ['--test'], {
        cwd: verification,
        env,
        signal: input.signal,
        timeout: 60_000,
        maxBuffer: 4 * 1024 * 1024,
      });
      testOutput = result.stdout + result.stderr;
    } catch (error) {
      input.signal?.throwIfAborted();
      const result = error as Error & { stdout?: string; stderr?: string };
      testsPassed = false;
      testOutput = `${result.stdout ?? ''}${result.stderr ?? ''}\n${result.message}`;
    }
    // A fence longer than any source fence keeps code and test output literal.
    const fence = '`'.repeat(
      Math.max(3, ...[...`${diff}\n${testOutput}`.matchAll(/`+/g)].map((match) => match[0].length + 1)),
    );
    const content = [
      `# ${input.title}`,
      '',
      'Simulated pull request. No remote branch or GitHub pull request was created.',
      '',
      `Work: ${input.workId}`,
      `Run: ${input.runId}`,
      'Base: pristine local checkout fixture',
      `Proposed branch: office/${input.workId}/${input.runId}`,
      '',
      '## Changed files',
      '',
      ...changedFiles.map((file) => `- ${file}`),
      ...(diff ? [] : ['No project changes.']),
      '',
      '## Verification',
      '',
      'Command: node --test',
      'Executed against an isolated code copy with the original regression tests restored.',
      `Result: ${testsPassed ? 'passed' : 'failed'}`,
      '',
      `${fence}text`,
      testOutput.trimEnd(),
      fence,
      '',
      '## Patch',
      '',
      `${fence}diff`,
      diff.trimEnd() || 'No changes.',
      fence,
      '',
    ].join('\n');
    const filePath = path.join(input.workspace, 'simulated-pr.md');
    await writeFile(filePath, content, {
      encoding: 'utf8',
      flag: constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW,
    });
    return { content, filePath, diff, changedFiles, testsPassed, testOutput };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
