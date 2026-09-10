import { Resvg } from '@resvg/resvg-js';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const svg = await readFile('assets/app-icon.svg', 'utf8');
await writeFile('public/icon.svg', svg);
await writeFile('public/favicon.svg', svg);
await writeFile('public/icon.png', new Resvg(svg, { fitTo: { mode: 'width', value: 512 } }).render().asPng());
await mkdir('assets/app.iconset', { recursive: true });
for (const size of [16, 32, 128, 256, 512]) {
  for (const density of [1, 2]) {
    const png = new Resvg(svg, { fitTo: { mode: 'width', value: size * density } }).render().asPng();
    await writeFile(`assets/app.iconset/icon_${size}x${size}${density === 2 ? '@2x' : ''}.png`, png);
  }
}
execFileSync('iconutil', ['-c', 'icns', 'assets/app.iconset', '-o', 'assets/app.icns']);
