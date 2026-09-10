import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { constants, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electron from 'electron';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));

// Launch Services makes Astra HQ responsible for its microphone and speech
// requests. Spawning Electron directly can attribute them to the terminal/IDE.
export function launchCommand(platform, executable, appBundle, root, environment) {
  if (platform !== 'darwin') return { command: executable, args: [root] };
  const args = ['-W', '-n', '-a', appBundle];
  for (const key of [
    'PATH',
    'CODEX_HOME',
    'AHQ_DEV_URL',
    'AHQ_DEV_CSP_NONCE',
    'AHQ_LAUNCH_DIRECTORY',
    'AHQ_LAUNCH_TOKEN',
  ]) {
    if (environment[key]) args.push('--env', `${key}=${environment[key]}`);
  }
  args.push('--args', root);
  return { command: '/usr/bin/open', args };
}

export async function prepareMacApp() {
  const manifest = JSON.parse(await fs.readFile(path.join(projectRoot, 'package.json'), 'utf8'));
  const sourceBundle = path.resolve(electron, '../../..');
  const sourceInfo = path.join(sourceBundle, 'Contents/Info.plist');
  const info = {
    CFBundleIdentifier: manifest.build.appId,
    CFBundleName: manifest.build.productName,
    CFBundleDisplayName: manifest.build.productName,
    ...manifest.build.mac.extendInfo,
  };
  const fingerprint = createHash('sha256')
    .update(await fs.readFile(sourceInfo))
    .update(JSON.stringify(info))
    .update(await fs.readFile(path.join(projectRoot, 'assets/app.icns')))
    .digest('hex');
  const output = path.join(projectRoot, 'release/dev');
  const bundle = path.join(output, `${manifest.build.productName}.app`);
  const stamp = path.join(output, 'bundle-fingerprint');
  let previous;
  try {
    previous = await fs.readFile(stamp, 'utf8');
    await fs.access(path.join(bundle, 'Contents/MacOS/Electron'));
  } catch {
    previous = undefined;
  }
  if (previous === fingerprint) return bundle;
  await fs.mkdir(output, { recursive: true });
  await fs.rm(bundle, { recursive: true, force: true });
  await fs.cp(sourceBundle, bundle, {
    recursive: true,
    verbatimSymlinks: true,
    mode: constants.COPYFILE_FICLONE,
  });
  const plist = path.join(bundle, 'Contents/Info.plist');
  for (const [key, value] of Object.entries(info)) {
    execFileSync('/usr/bin/plutil', ['-replace', key, '-string', value, plist]);
  }
  await fs.copyFile(
    path.join(projectRoot, 'assets/app.icns'),
    path.join(bundle, 'Contents/Resources/electron.icns'),
  );
  execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', bundle], { stdio: 'inherit' });
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle], { stdio: 'inherit' });
  await fs.writeFile(stamp, fingerprint);
  return bundle;
}

export async function launchDesktop(environment = process.env, { root = projectRoot } = {}) {
  const env = { ...environment };
  delete env.ELECTRON_RUN_AS_NODE;
  const bundle = process.platform === 'darwin' ? await prepareMacApp() : '';
  const directory =
    process.platform === 'darwin' ? await fs.mkdtemp(path.join(os.tmpdir(), 'astra-hq-launch-')) : undefined;
  const token = randomBytes(24).toString('hex');
  // A private rendezvous belongs only to this launch. A second instance that
  // fails the app lock never subscribes, so stopping it cannot quit the first.
  delete env.AHQ_LAUNCH_DIRECTORY;
  delete env.AHQ_LAUNCH_TOKEN;
  if (directory) {
    env.AHQ_LAUNCH_DIRECTORY = directory;
    env.AHQ_LAUNCH_TOKEN = token;
  }
  const { command, args } = launchCommand(process.platform, electron, bundle, root, env);
  const child = spawn(command, args, {
    stdio: 'inherit',
    env,
    cwd: projectRoot,
    // Keep Ctrl-C from killing the open waiter before the launcher can ask the
    // separately launched Electron app to finish its normal shutdown.
    detached: process.platform === 'darwin',
  });
  let finished = false;
  const cleanup = async () => {
    if (directory) await fs.rm(directory, { recursive: true, force: true });
  };
  const closed = new Promise((resolve, reject) => {
    child.once('error', (error) => {
      finished = true;
      void cleanup().then(() => reject(error), reject);
    });
    child.once('exit', (code, signal) => {
      finished = true;
      void cleanup().then(() => resolve({ code, signal }), reject);
    });
  });
  let stopping;
  const stop = () => {
    if (!stopping)
      stopping = (async () => {
        if (!finished) {
          if (directory) {
            try {
              const pending = path.join(directory, 'command.pending');
              await fs.writeFile(pending, JSON.stringify({ token, command: 'quit' }), { mode: 0o600 });
              await fs.rename(pending, path.join(directory, 'command.json'));
            } catch (error) {
              if (!finished) throw error;
            }
          } else {
            child.kill('SIGTERM');
          }
        }
        return closed;
      })();
    return stopping;
  };
  return { closed, stop };
}
