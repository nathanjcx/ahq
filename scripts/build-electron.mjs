import { build } from 'esbuild';
await build({
  entryPoints: ['electron/main.ts', 'electron/preload.ts', 'electron/runtime-host.ts'],
  bundle: true, platform: 'node', format: 'cjs', target: 'node22',
  outdir: 'dist-electron', outExtension: { '.js': '.cjs' },
  external: ['electron', 'sql.js', 'pdfkit'], sourcemap: true,
});
