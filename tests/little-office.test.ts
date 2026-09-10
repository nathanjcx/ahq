import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import electron from 'electron';

test(
  'native launch builds real app, captures staged bug, rejects no-op fix, and verifies agent fix',
  { timeout: 90_000 },
  async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), 'little-office-test-'));
    const driver = path.resolve('desktop/.little-office-test.cjs');
    try {
      await build({
        stdin: {
          contents: `
      import { app } from 'electron';
      import assert from 'node:assert/strict';
      import { readFile, writeFile } from 'node:fs/promises';
      import path from 'node:path';
      import { prepareLittleOffice, finishLittleOffice } from './desktop/little-office';
      app.commandLine.appendSwitch('no-sandbox');
      app.on('window-all-closed', () => {});
      app.whenReady().then(async () => {
        const parent = path.join(${JSON.stringify(temp)}, 'product');
        const child = path.join(${JSON.stringify(temp)}, 'bug');
        const product = { kind: 'product', project: 'little-office', launchStep: 'product', title: 'Launch Little Office', files: [] };
        await prepareLittleOffice(parent, product);
        assert.match(await readFile(path.join(parent, 'runtime/engine.ts'), 'utf8'), /class Runtime implements OfficeRuntime/);
        assert.match((await finishLittleOffice(parent, product)).error, /product agent must change/);
        const file = path.join(parent, 'src/App.tsx');
        const original = await readFile(file, 'utf8');
        const marker = '      <div className={\x60workspace workspace--\x24{activeTab}\x60}>';
        assert.ok(original.includes(marker));
        await writeFile(file, original.replace(marker, marker + '<section className="launch-welcome"><strong>Your office is open.</strong><button className="button button--sunny launch-welcome__action" onClick={() => setComposer({kind: "message"})}>Send first request</button></section>'));
        const css = path.join(parent, 'src/styles.css');
        await writeFile(css, await readFile(css, 'utf8') + '\\n.launch-welcome {display:flex;align-items:center;justify-content:space-between;padding:16px;margin:16px;background:var(--sun-pale);flex-shrink:0;}');
        const built = await finishLittleOffice(parent, product);
        assert.equal(built.error, undefined);
        assert.equal(built.artifacts.length, 3);
        assert.equal((await readFile(built.artifacts[2].filePath)).subarray(0,8).toString('hex'), '89504e470d0a1a0a');
        assert.ok((await readFile(built.artifacts[1].filePath,'utf8')).includes('launch-preview'));
        const bug = {...product,kind:'bug',launchStep:'bug',title:'Fix launch action',parentWorkspace:parent,parentSessionId:'product-1'};
        await prepareLittleOffice(child,bug);
        assert.match((await finishLittleOffice(child,bug)).error, /bug agent must edit/);
        const fixedCss = path.join(child,'src/styles.css');
        await writeFile(fixedCss,(await readFile(fixedCss,'utf8')).replace('.launch-welcome__action { display: none; }','.launch-welcome__action { display: inline-flex; }'));
        const fixed = await finishLittleOffice(child,bug);
        assert.equal(fixed.error,undefined);
        assert.match(fixed.artifacts[0].content,/Simulated pull request/);
        assert.match(fixed.artifacts[0].content,/opens the message composer/);
        assert.ok(fixed.artifacts[0].simulated);
        console.log('LITTLE_OFFICE_NATIVE_OK');
        app.quit();
      }).catch(error=>{console.error(error);app.exit(1);});
    `,
          resolveDir: process.cwd(),
          loader: 'ts',
        },
        bundle: true,
        platform: 'node',
        format: 'cjs',
        outfile: driver,
        external: ['electron', 'esbuild'],
      });
      const env = { ...process.env };
      delete env.ELECTRON_RUN_AS_NODE;
      const result = await promisify(execFile)(electron as unknown as string, ['--no-sandbox', driver], {
        env,
        timeout: 80_000,
      });
      assert.match(result.stdout, /LITTLE_OFFICE_NATIVE_OK/);
    } finally {
      await rm(driver, { force: true });
      await rm(temp, { recursive: true, force: true });
    }
  },
);
