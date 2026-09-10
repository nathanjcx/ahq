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
