import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

const launcher = await import(new URL('../scripts/desktop-launch.mjs', import.meta.url).href);

test('macOS desktop launch uses the app bundle and forwards only required development environment', () => {
  const launch = launcher.launchCommand('darwin', '/vendor/Electron', '/dev/Astra HQ.app', '/my project', {
    PATH: '/usr/bin:/opt/homebrew/bin',
    AHQ_DEV_URL: 'http://127.0.0.1:5173',
    AHQ_DEV_CSP_NONCE: 'test-nonce',
    AHQ_LAUNCH_DIRECTORY: '/private/launch',
    AHQ_LAUNCH_TOKEN: 'launch-token',
    ELECTRON_RUN_AS_NODE: '1',
    OPENAI_API_KEY: 'not-for-command-line',
  });
  assert.equal(launch.command, '/usr/bin/open');
  assert.ok(launch.args.includes('/dev/Astra HQ.app'));
  assert.deepEqual(launch.args.slice(-2), ['--args', '/my project']);
  assert.ok(launch.args.includes('AHQ_DEV_CSP_NONCE=test-nonce'));
  assert.ok(launch.args.includes('AHQ_LAUNCH_DIRECTORY=/private/launch'));
  assert.ok(launch.args.includes('AHQ_LAUNCH_TOKEN=launch-token'));
  assert.ok(launch.args.includes('PATH=/usr/bin:/opt/homebrew/bin'));
  assert.doesNotMatch(launch.args.join(' '), /OPENAI_API_KEY|ELECTRON_RUN_AS_NODE/);
  assert.deepEqual(launcher.launchCommand('linux', '/electron', '', '/my project', {}), {
    command: '/electron',
    args: ['/my project'],
  });
});

test(
  'development app is signed and includes the packaged app speech permission description',
  {
    skip: process.platform !== 'darwin',
  },
  async () => {
    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    const bundle = await launcher.prepareMacApp();
    const info = JSON.parse(
      execFileSync(
        '/usr/bin/plutil',
        ['-convert', 'json', '-o', '-', path.join(bundle, 'Contents/Info.plist')],
        { encoding: 'utf8' },
      ),
    );
    assert.equal(info.CFBundleIdentifier, manifest.build.appId);
    assert.equal(info.CFBundleDisplayName, 'Astra HQ');
    for (const key of ['NSMicrophoneUsageDescription', 'NSSpeechRecognitionUsageDescription']) {
      assert.ok(info[key]?.trim());
      assert.equal(info[key], manifest.build.mac.extendInfo[key]);
    }
    execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle]);
  },
);

test(
  'managed macOS launcher quits its own app gracefully, preserves another instance, and handles stop during startup',
  { skip: process.platform !== 'darwin', timeout: 45_000 },
  async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), 'ahq-managed-launch-test-'));
    const profile = path.join(temp, 'isolated-profile');
    await mkdir(profile);
    const controllers: Array<{ stop(): Promise<unknown> }> = [];
    const driver = async (name: string, delay = 0) => {
      const file = path.join(temp, `${name}.cjs`);
      await build({
        stdin: {
          contents: `
            import { app } from 'electron';
            import { writeFileSync } from 'node:fs';
            import { registerManagedLaunch } from ${JSON.stringify(path.resolve('desktop/managed-launch'))};
            app.setPath('userData', ${JSON.stringify(profile)});
            app.setPath('sessionData', ${JSON.stringify(profile)});
            const deadline = setTimeout(() => app.exit(2), 12000);
            app.on('will-quit', () => {
              clearTimeout(deadline);
              writeFileSync(${JSON.stringify(path.join(temp, `${name}-quit.json`))}, JSON.stringify({ graceful: true }));
            });
            if (!app.requestSingleInstanceLock()) {
              writeFileSync(${JSON.stringify(path.join(temp, `${name}-duplicate`))}, 'duplicate');
              app.quit();
            } else {
              app.whenReady().then(async () => {
                await new Promise(resolve => setTimeout(resolve, ${delay}));
                if (!(await registerManagedLaunch(app))) return;
                writeFileSync(${JSON.stringify(path.join(temp, `${name}-ready.json`))}, JSON.stringify({
                  pid: process.pid, directory: process.env.AHQ_LAUNCH_DIRECTORY, launchedBy: process.ppid
                }));
              }).catch(error => { console.error(error); app.exit(3); });
            }
          `,
          resolveDir: process.cwd(),
          loader: 'ts',
        },
        bundle: true,
        platform: 'node',
        format: 'cjs',
        outfile: file,
        external: ['electron'],
      });
      return file;
    };
    const readReady = async (name: string) => {
      for (let attempt = 0; attempt < 60; attempt++) {
        try {
          return JSON.parse(await readFile(path.join(temp, `${name}-ready.json`), 'utf8'));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error('The isolated desktop app did not become ready.');
    };
    try {
      const first = await launcher.launchDesktop(process.env, { root: await driver('first') });
      controllers.push(first);
      const ready = await readReady('first');
      assert.equal(ready.launchedBy, 1);
      const duplicate = await launcher.launchDesktop(process.env, { root: await driver('duplicate') });
      controllers.push(duplicate);
      assert.equal((await duplicate.closed).code, 0);
      await duplicate.stop();
      assert.equal(await readFile(path.join(temp, 'duplicate-duplicate'), 'utf8'), 'duplicate');
      assert.doesNotThrow(() => process.kill(ready.pid, 0));
      await stat(ready.directory);

      assert.equal((await first.stop()).code, 0);
      assert.deepEqual(JSON.parse(await readFile(path.join(temp, 'first-quit.json'), 'utf8')), {
        graceful: true,
      });
      assert.throws(() => process.kill(ready.pid, 0), { code: 'ESRCH' });
      await assert.rejects(stat(ready.directory), { code: 'ENOENT' });

      const early = await launcher.launchDesktop(process.env, { root: await driver('early', 150) });
      controllers.push(early);
      assert.equal((await early.stop()).code, 0);
      await stat(path.join(temp, 'early-quit.json'));
      await assert.rejects(stat(path.join(temp, 'early-ready.json')), { code: 'ENOENT' });
    } finally {
      await Promise.allSettled(controllers.map((controller) => controller.stop()));
      await rm(temp, { recursive: true, force: true });
    }
  },
);
