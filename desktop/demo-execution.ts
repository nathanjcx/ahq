import { verifyLaunchForecast } from './launch-finance';
import { prepareLittleOffice, finishLittleOffice, littleOfficeInstructions } from './little-office';
import { existsSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { cp, lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LocalArtifact, LocalTaskInput } from '../shared/demo';
import { createSimulatedPullRequest } from '../runtime/pull-request';
import { writeReportPdf } from '../runtime/report-pdf';

const resources = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
const packagedData = resources ? path.join(resources, 'app.asar', 'demo-data') : undefined;
export const demoDataPath =
  packagedData && existsSync(packagedData)
    ? packagedData
    : path.resolve(
        typeof __dirname === 'string' ? __dirname : path.dirname(fileURLToPath(import.meta.url)),
        '..',
        'demo-data',
      );

const excluded = new Set([
  'attachments',
  'data',
  '.git',
  'node_modules',
  'provenance.json',
  'patch.md',
  'simulated-pr.md',
  'qa.md',
  'report.md',
  'report.pdf',
  'brief.md',
]);
async function codeHashes(directory: string, relative = ''): Promise<Record<string, string>> {
  const hashes: Record<string, string> = {};
  for (const entry of (await readdir(path.join(directory, relative), { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    if (!relative && excluded.has(entry.name)) continue;
    const name = path.join(relative, entry.name);
    if (entry.isDirectory()) Object.assign(hashes, await codeHashes(directory, name));
    else if (entry.isFile())
      hashes[name] = createHash('sha256')
        .update(await readFile(path.join(directory, name)))
        .digest('hex');
    else throw new Error(`Cannot verify nonregular project file ${name}.`);
  }
  return hashes;
}
export interface TaskEvidence {
  hashes?: Record<string, string>;
  parentSessionId?: string;
}
export function attachmentPath(workspace: string, name: string, index: number) {
  const safe = path.basename(name).replace(/[^a-zA-Z0-9._-]/g, '_') || 'attachment';
  return path.join(workspace, 'attachments', `${index + 1}-${safe}`);
}
export async function prepareTask(workspace: string, task: LocalTaskInput): Promise<TaskEvidence> {
  let evidence: TaskEvidence = {};
  if (task.project === 'little-office' && (task.kind === 'product' || task.kind === 'bug'))
    await prepareLittleOffice(workspace, task);
  if (task.kind === 'bug' && task.project !== 'little-office')
    await cp(path.join(demoDataPath, 'checkout'), workspace, { recursive: true });
  if (task.kind === 'qa') {
    if (!task.parentWorkspace || !task.parentSessionId)
      throw new Error('QA needs the completed patch session and its workspace.');
    const before = await codeHashes(task.parentWorkspace);
    for (const required of ['checkout.js', 'package.json', 'test/checkout.test.js']) {
      if (!before[required]) throw new Error(`The parent patch is missing ${required}.`);
    }
    for (const name of Object.keys(before)) {
      await mkdir(path.dirname(path.join(workspace, name)), { recursive: true });
      await cp(path.join(task.parentWorkspace, name), path.join(workspace, name));
    }
    const copied = await codeHashes(workspace);
    if (
      JSON.stringify(before) !== JSON.stringify(copied) ||
      JSON.stringify(before) !== JSON.stringify(await codeHashes(task.parentWorkspace))
    )
      throw new Error('The parent code changed while copying the QA workspace.');
    evidence = { hashes: copied, parentSessionId: task.parentSessionId };
    await writeFile(
      path.join(workspace, 'provenance.json'),
      JSON.stringify({ ...evidence, algorithm: 'sha256', verified: true }, null, 2),
    );
  }
  await mkdir(path.join(workspace, 'attachments'), { recursive: true });
  for (const [i, file] of task.files.entries()) {
    await writeFile(
      attachmentPath(workspace, file.name, i),
      file.encoding === 'base64' ? Buffer.from(file.content, 'base64') : file.content,
      { flag: 'wx' },
    );
  }
  return evidence;
}
export function taskInstructions(task: LocalTaskInput): string {
  if (task.project === 'little-office' && (task.kind === 'product' || task.kind === 'bug'))
    return littleOfficeInstructions(task);
  const launch =
    task.launchStep === 'forecast' || task.launchStep === 'revision'
      ? ' Write forecast.csv using forecast-contract.md and the supplied assumptions. ' +
        (task.launchStep === 'revision'
          ? 'Use original-forecast.csv as the baseline, apply competitor-scenario.csv changes, preserve original files, and explain before/after totals and assumption changes in report.md.'
          : 'Compute the six-month baseline forecast and explain calculations and fictional assumptions in report.md.')
      : task.launchStep === 'marketing'
        ? ' Write a Little Office launch messaging kit in brief.md including positioning, three slogans, launch announcement draft, target users, and a clear distinction between existing product and planned features. Use product-brief.md.'
        : task.launchStep === 'reporter'
          ? ' Use the current launch artifacts, revised forecast and verified code fix for the reporter briefing. Include slogans, three key messages, likely questions, concise answers, and facts to avoid overstating. Do not invent a meeting transcript.'
          : '';
  return (
    launch +
    {
      product:
        'Complete the supplied Little Office launch task in the actual source project. Follow LAUNCH-TASK.md. Write product.md with the actual changes and verification. Do not fix the deferred launch-demo bug yet.',
      report:
        'Analyze the supplied evidence. Write the complete report to report.md, citing input files and preserving uncertainty. The app exports it to PDF. Do not create the PDF or install tools.',
      meeting:
        'Prepare the requested meeting brief in brief.md from supplied evidence. Include questions, risks, proposed actions and owners. Never invent meeting discussion or agreed decisions.',
      bug: 'Fix the actual local checkout application. Run node --test. Preserve original tests. Write patch.md explaining the change and actual verification. The app creates a simulated PR from the code diff and independently runs original tests. No remote PR is created.',
      qa: 'Read provenance.json. Run node --test on this exact copied parent patch without modifying any project files. Write qa.md with commands, actual results, parent session ID, and remaining issues. The app independently verifies the code hashes and original regression tests.',
      triage:
        'Classify the supplied notification according to the assignment. Return only the requested JSON in your final message. Do not create artifacts or take other actions.',
    }[task.kind]
  );
}
async function document(workspace: string, name: string): Promise<string> {
  const file = path.join(workspace, name);
  if (!(await lstat(file)).isFile()) throw new Error(`${name} must be a regular local file.`);
  const content = await readFile(file, 'utf8');
  if (!content.trim()) throw new Error(`The assignment did not produce ${name}.`);
  return content;
}
export async function finishTask(
  workspace: string,
  sessionId: string,
  task: LocalTaskInput,
  evidence: TaskEvidence,
  signal: AbortSignal,
): Promise<{ artifacts: LocalArtifact[]; error?: string }> {
  signal.throwIfAborted();
  if (task.kind === 'triage') return { artifacts: [] };
  if (task.project === 'little-office' && (task.kind === 'product' || task.kind === 'bug'))
    return finishLittleOffice(workspace, task, signal);
  const spec = {
    product: ['product.md', 'product'],
    report: ['report.md', 'report'],
    meeting: ['brief.md', 'brief'],
    bug: ['patch.md', 'patch'],
    qa: ['qa.md', 'qa'],
  }[task.kind] as [string, LocalArtifact['kind']];
  const artifacts: LocalArtifact[] = [];
  try {
    const content = await document(workspace, spec[0]);
    artifacts.push({
      id: randomUUID(),
      title: task.title,
      kind: spec[1],
      filePath: path.join(workspace, spec[0]),
      content,
      simulated: false,
    });
    if (task.launchStep === 'forecast' || task.launchStep === 'revision')
      artifacts.push(await verifyLaunchForecast(workspace, task, path.join(demoDataPath, 'launch')));
    if (task.kind === 'report') {
      const pdf = path.join(workspace, `report-${randomUUID()}.pdf`);
      await writeReportPdf(pdf, task.title, content);
      artifacts[0].filePath = pdf;
    }
    if (task.kind === 'qa' && JSON.stringify(evidence.hashes) !== JSON.stringify(await codeHashes(workspace)))
      throw new Error('QA modified the parent code snapshot; its result cannot be accepted.');
    if (task.kind === 'bug' || task.kind === 'qa') {
      const result = await createSimulatedPullRequest({
        workspace,
        template: path.join(demoDataPath, 'checkout'),
        title: task.title,
        workId: task.sourceId ?? sessionId,
        runId: sessionId,
        signal,
      });
      artifacts.push({
        id: randomUUID(),
        title: `${task.title} · verification`,
        kind: task.kind === 'bug' ? 'patch' : 'qa',
        filePath: result.filePath,
        content: result.content,
        simulated: true,
      });
      if (!result.testsPassed)
        throw new Error('Original checkout regression tests failed. See the verification artifact.');
      if (task.kind === 'bug' && !result.diff) throw new Error('The assignment produced no project changes.');
    }
    signal.throwIfAborted();
    return { artifacts };
  } catch (error) {
    signal.throwIfAborted();
    return { artifacts, error: error instanceof Error ? error.message : String(error) };
  }
}
