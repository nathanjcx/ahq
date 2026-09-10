import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LocalTaskInput } from '../shared/demo';
import { copyPackagedDirectory } from './copy-packaged-directory';

type LittleOfficeTask = LocalTaskInput & {
  project?: string;
  launchStep?: string;
  parentWorkspace?: string;
  parentSessionId?: string;
};
export interface LittleOfficeArtifact {
  id: string;
  title: string;
  kind: 'product' | 'patch';
  filePath: string;
  content: string;
  simulated: boolean;
}

const here = typeof __dirname === 'string' ? __dirname : path.dirname(fileURLToPath(import.meta.url));
export const littleOfficeFixture = path.resolve(here, '..', 'demo-data', 'little-office');
const require = createRequire(path.join(here, 'little-office.cjs'));
const ignored = new Set([
  '.git',
  '.local-data',
  'dist',
  'dist-electron',
  'node_modules',
  'release',
  'test-results',
  'attachments',
  '.launch-dependencies',
]);
const sourceCommit = '21159c275e3bc532dedef2df70cb598cfb8cb042';
const stagedCss =
  '\n/* Deliberately staged launch demo regression. */\n@media (max-width: 1100px) {\n  .launch-welcome__action { display: none; }\n}\n';
const hiddenAction = /\.launch-welcome__action\s*\{[^}]*display:\s*none/;
const trustedTest = `import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
test('launch action has no hiding rule at supported desktop widths', async () => {
  const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, ${hiddenAction.toString()}, 'the launch action must remain visible');
});
`;

async function hashes(root: string, relative = ''): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const entry of (await readdir(path.join(root, relative), { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    if (
      ignored.has(entry.name) ||
      entry.name === 'fixture-manifest.json' ||
      entry.name === 'launch-provenance.json'
    )
      continue;
    const name = path.join(relative, entry.name);
    if (entry.isDirectory()) Object.assign(result, await hashes(root, name));
    else if (entry.isFile())
      result[name] = createHash('sha256')
        .update(await readFile(path.join(root, name)))
        .digest('hex');
  }
  return result;
}

export function littleOfficeInstructions(task: LocalTaskInput): string {
  const launch = task as LittleOfficeTask;
  if (launch.project !== 'little-office') return '';
  if (launch.launchStep === 'bug')
    return `This workspace is copied from the completed Little Office launch product. Fix the missing "Send first request" action at 960px width in src/styles.css. Keep the welcome banner and working composer action. Inspect attachments/little-office-launch-bug.png if present. Run node --test tests/launch-welcome.test.mjs. Do not edit tests, provenance, or build scripts. The host independently rebuilds and checks the actual browser before writing a simulated PR. No GitHub operations.`;
  if (launch.launchStep !== 'product') return '';
  return `This is the actual Little Office 2D app, pinned from backend commit ${sourceCommit}. Make a bounded launch improvement in src/App.tsx and src/styles.css: add a welcome section with className="launch-welcome", text "Your office is open.", and a button with className="button button--sunny launch-welcome__action", label "Send first request", and onClick={() => setComposer({ kind: "message" })}. Place it immediately inside the workspace div. Style the welcome section to fit the existing design. Preserve the real office canvas and app. The host will bundle the frontend with local sample state and capture it. The host deliberately stages a narrow-width CSS regression afterward for the follow-up bug demonstration; this is disclosed in the build report. Do not install dependencies, change runtime code, or replace the app with a mock. Do not create a PR.`;
}

async function copyDependencies(workspace: string): Promise<string> {
  const modules = path.join(workspace, '.launch-dependencies', 'node_modules');
  const copied = new Map<string, string>();
  async function copyPackage(
    name: string,
    resolver: NodeJS.Require,
    parentModules: string,
    sourceName = name,
  ): Promise<void> {
    const source = resolver.resolve
      .paths(sourceName)
      ?.map((directory) => path.join(directory, sourceName))
      .find((directory) => existsSync(path.join(directory, 'package.json')));
    if (!source) throw new Error(`Missing packaged preview dependency: ${sourceName}`);
    if (copied.get(name) === source) return;
    const destination = path.join(copied.has(name) ? parentModules : modules, name);
    if (!copied.has(name)) copied.set(name, source);
    await copyPackagedDirectory(source, destination, (file) => path.basename(file) !== 'node_modules');
    const manifestPath = path.join(source, 'package.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    for (const dependency of Object.keys(manifest.dependencies ?? {})) {
      await copyPackage(dependency, createRequire(manifestPath), path.join(destination, 'node_modules'));
    }
  }
  for (const name of ['react', 'react-dom', 'lucide-react', 'pixi.js', 'react-markdown', 'remark-gfm']) {
    await copyPackage(name, require, modules, name === 'lucide-react' ? 'little-office-lucide' : name);
  }
  return modules;
}

async function buildPreview(workspace: string): Promise<string> {
  const modules = await copyDependencies(workspace);
  // Native subprocesses cannot execute inside Electron's ASAR archive.
  const esbuildPath = require.resolve('esbuild').replace(/\.asar([\\/])/, '.asar.unpacked$1');
  const { build } = require(esbuildPath) as typeof import('esbuild');
  const result = await build({
    entryPoints: [path.join(workspace, 'src/main.tsx')],
    bundle: true,
    write: false,
    outfile: path.join(workspace, 'dist/preview.js'),
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    minify: true,
    nodePaths: [modules],
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [
      {
        name: 'raw-csv',
        setup(builder) {
          builder.onResolve({ filter: /\.csv\?raw$/ }, (args) => ({
            path: path.resolve(args.resolveDir, args.path.slice(0, -4)),
            namespace: 'raw-csv',
          }));
          builder.onLoad({ filter: /.*/, namespace: 'raw-csv' }, async (args) => ({
            contents: await readFile(args.path, 'utf8'),
            loader: 'text',
          }));
        },
      },
    ],
  });
  const js = result.outputFiles.find((file) => file.path.endsWith('.js'))?.text;
  const css = result.outputFiles.find((file) => file.path.endsWith('.css'))?.text;
  if (!js || !css) throw new Error('The actual Little Office frontend did not produce JavaScript and CSS.');
  const snapshot = JSON.parse(
    await readFile(path.join(littleOfficeFixture, 'launch-preview-state.json'), 'utf8'),
  );
  const bridge = `const snapshot=${JSON.stringify(snapshot).replace(/</g, '\\u003c')};window.office={platform:'launch-preview',async command(c){if(c.type==='snapshot')return snapshot;throw new Error('This launch preview uses local sample state. Run the source app for live actions.');},subscribe(){return()=>{};},async openArtifact(){},async openExternal(){}};`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Little Office launch preview</title><style>${css.replace(/<\/style/gi, '<\\/style')}</style></head><body><div id="root"></div><script>${bridge}${js.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;
  await mkdir(path.join(workspace, 'dist'), { recursive: true });
  const target = path.join(workspace, 'dist/index.html');
  await writeFile(target, html);
  return target;
}

async function capture(workspace: string, fixed: boolean, signal?: AbortSignal): Promise<string> {
  const { BrowserWindow } = require('electron') as typeof import('electron');
  const window = new BrowserWindow({
    show: false,
    width: 960,
    height: 720,
    useContentSize: true,
    webPreferences: {
      partition: `little-office-preview-${randomUUID()}`,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    let allowed = details.url.startsWith('data:') || details.url.startsWith('blob:');
    if (details.url.startsWith('file:')) allowed = fileURLToPath(details.url).startsWith(`${workspace}${path.sep}`);
    callback({ cancel: !allowed });
  });
  const abort = () => {
    if (!window.isDestroyed()) window.destroy();
  };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    signal?.throwIfAborted();
    await window.loadFile(path.join(workspace, 'dist/index.html'));
    const result = await window.webContents.executeJavaScript(
      `new Promise((resolve,reject)=>{const start=Date.now();function inspect(){const welcome=document.querySelector('.launch-welcome');const button=document.querySelector('.launch-welcome__action');if(welcome&&button){const r=button.getBoundingClientRect();resolve({width:innerWidth,welcome:welcome.textContent,visible:r.width>0&&r.height>0&&r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight&&getComputedStyle(button).visibility!=='hidden'});}else if(Date.now()-start>10000)reject(new Error('Launch banner or action missing'));else setTimeout(inspect,50);}inspect();})`,
    );
    assert.equal(result.width, 960);
    assert.match(result.welcome, /Your office is open\./);
    assert.equal(
      result.visible,
      fixed,
      fixed
        ? 'The launch action must be visible at 960px.'
        : 'The staged missing-action regression did not reproduce.',
    );
    const target = path.join(
      workspace,
      fixed ? 'little-office-launch-fixed.png' : 'little-office-launch-bug.png',
    );
    await writeFile(target, (await window.webContents.capturePage()).toPNG());
    if (fixed) {
      await window.webContents.executeJavaScript(`document.querySelector('.launch-welcome__action').click()`);
      const opened = await window.webContents.executeJavaScript(
        `new Promise(resolve=>setTimeout(()=>resolve(!!document.querySelector('.modal')),100))`,
      );
      assert.ok(opened, 'The launch action must open the message composer.');
    }
    return target;
  } finally {
    signal?.removeEventListener('abort', abort);
    if (!window.isDestroyed()) window.destroy();
  }
}

export async function prepareLittleOffice(
  workspace: string,
  task: LocalTaskInput,
  signal?: AbortSignal,
): Promise<void> {
  const launch = task as LittleOfficeTask;
  if (launch.project !== 'little-office' || !['product', 'bug'].includes(launch.launchStep ?? '')) return;
  signal?.throwIfAborted();
  const source = launch.launchStep === 'bug' ? launch.parentWorkspace : littleOfficeFixture;
  if (!source) throw new Error('The Little Office bug task needs the completed product workspace.');
  const filter = (name: string) => !ignored.has(path.basename(name));
  if (launch.launchStep === 'product') await copyPackagedDirectory(source, workspace, filter);
  else await cp(source, workspace, { recursive: true, filter });
  if (launch.launchStep === 'bug') {
    await mkdir(path.join(workspace, 'attachments'), { recursive: true });
    await cp(
      path.join(source, 'little-office-launch-bug.png'),
      path.join(workspace, 'attachments/little-office-launch-bug.png'),
    );
  }
  await writeFile(
    path.join(workspace, 'launch-provenance.json'),
    JSON.stringify(
      {
        sourceCommit,
        sourceBranch: 'backend',
        parentSessionId: launch.parentSessionId,
        hashes: await hashes(workspace),
      },
      null,
      2,
    ),
  );
}

export async function finishLittleOffice(
  workspace: string,
  task: LocalTaskInput,
  signal?: AbortSignal,
): Promise<{ artifacts: LittleOfficeArtifact[]; error?: string }> {
  const launch = task as LittleOfficeTask;
  if (launch.project !== 'little-office' || !['product', 'bug'].includes(launch.launchStep ?? ''))
    return { artifacts: [] };
  const artifacts: LittleOfficeArtifact[] = [];
  const add = async (
    title: string,
    kind: 'product' | 'patch',
    filePath: string,
    content: string,
    simulated = false,
  ) => artifacts.push({ id: randomUUID(), title, kind, filePath, content, simulated });
  try {
    signal?.throwIfAborted();
    const app = await readFile(path.join(workspace, 'src/App.tsx'), 'utf8');
    assert.notEqual(
      app,
      await readFile(path.join(littleOfficeFixture, 'src/App.tsx'), 'utf8'),
      'The product agent must change the actual app.',
    );
    assert.match(app, /launch-welcome__action/);
    const cssFile = path.join(workspace, 'src/styles.css');
    if (launch.launchStep === 'product') {
      const css = await readFile(cssFile, 'utf8');
      await writeFile(cssFile, css + stagedCss);
      await writeFile(path.join(workspace, 'tests/launch-welcome.test.mjs'), trustedTest);
      const preview = await buildPreview(workspace);
      const screenshot = await capture(workspace, false, signal);
      const report = `# Little Office launch build\n\nBuilt the actual 2D app frontend from backend commit ${sourceCommit}. The product agent added the welcome banner and composer action.\n\nVerification: esbuild bundled the frontend; Electron rendered the actual app at 960 by 720 pixels and reproduced the missing action.\n\nThe host deliberately inserted the narrow-width CSS bug after the product change for the follow-up demo. The screenshot is a real browser capture. The standalone preview uses local sample state; live runtime actions are unavailable there. Runtime source is preserved in this workspace.\n`;
      const reportPath = path.join(workspace, 'launch-build.md');
      await writeFile(reportPath, report);
      await add('Little Office launch build', 'product', reportPath, report);
      await add('Little Office runnable preview', 'product', preview, 'Runnable frontend built from the pinned Little Office source. Open the preview to interact with it.');
      await add(
        'Launch bug screenshot',
        'product',
        screenshot,
        'Actual 960 by 720 browser capture. The staged launch action is missing.',
      );
    } else {
      if (!launch.parentWorkspace) throw new Error('The bug fix needs its completed product workspace.');
      const before = await readFile(path.join(launch.parentWorkspace, 'src/styles.css'), 'utf8');
      const after = await readFile(cssFile, 'utf8');
      assert.match(before, hiddenAction, 'The parent must contain the reproduced regression.');
      assert.notEqual(after, before, 'The bug agent must edit the source.');
      await writeFile(path.join(workspace, 'tests/launch-welcome.test.mjs'), trustedTest);
      assert.doesNotMatch(after, hiddenAction, 'The trusted launch regression check failed.');
      await buildPreview(workspace);
      const screenshot = await capture(workspace, true, signal);
      const beforeLines = before.split('\n');
      const afterLines = after.split('\n');
      let start = 0;
      while (
        start < beforeLines.length &&
        start < afterLines.length &&
        beforeLines[start] === afterLines[start]
      )
        start++;
      let beforeEnd = beforeLines.length;
      let afterEnd = afterLines.length;
      while (
        beforeEnd > start &&
        afterEnd > start &&
        beforeLines[beforeEnd - 1] === afterLines[afterEnd - 1]
      ) {
        beforeEnd--;
        afterEnd--;
      }
      const diff = [
        '--- parent/src/styles.css',
        '+++ fixed/src/styles.css',
        `@@ -${start + 1},${beforeEnd - start} +${start + 1},${afterEnd - start} @@`,
        ...beforeLines.slice(start, beforeEnd).map((line) => `-${line}`),
        ...afterLines.slice(start, afterEnd).map((line) => `+${line}`),
      ].join('\n');
      const pr = `# Keep the launch action visible\n\nSimulated pull request. No remote branch or pull request was created.\n\nParent session: ${launch.parentSessionId ?? 'unknown'}\n\nVerification: the host restored and applied the trusted CSS regression assertion; esbuild bundled the changed frontend; Electron verified that the action is visible inside the 960 by 720 viewport and opens the message composer.\n\nChanged CSS lines:\n\n\`\`\`diff\n${diff}\n\`\`\`\n`;
      const prPath = path.join(workspace, 'simulated-pr.md');
      await writeFile(prPath, pr);
      await add(task.title, 'patch', prPath, pr, true);
      await add(
        'Verified fixed Little Office preview',
        'product',
        path.join(workspace, 'dist/index.html'),
        'Runnable Little Office preview with the verified launch-button fix.',
      );
      await add(
        'Fixed launch screenshot',
        'product',
        screenshot,
        'Actual browser capture of the verified fix at 960 by 720 pixels.',
      );
    }
    return { artifacts };
  } catch (error) {
    signal?.throwIfAborted();
    return { artifacts, error: error instanceof Error ? error.message : String(error) };
  }
}
