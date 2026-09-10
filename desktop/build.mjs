import { build } from 'esbuild';
await build({
  entryPoints: ['desktop/main.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile: 'dist-desktop/main.cjs',
  external: ['electron', 'sql.js'],
  sourcemap: true,
});
await build({
  entryPoints: ['desktop/preload.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile: 'dist-desktop/preload.cjs',
  external: ['electron', 'sql.js'],
});

if (process.platform === 'darwin') {
  const { execFileSync } = await import('node:child_process');
  const { resolve } = await import('node:path');
  execFileSync(
    'xcrun',
    [
      'swiftc',
      '-swift-version',
      '5',
      '-O',
      'desktop/transcribe.swift',
      '-o',
      'dist-desktop/transcribe',
      '-framework',
      'Speech',
      '-Xlinker',
      '-sectcreate',
      '-Xlinker',
      '__TEXT',
      '-Xlinker',
      '__info_plist',
      '-Xlinker',
      resolve('desktop/speech-info.plist'),
    ],
    { stdio: 'inherit' },
  );
}
