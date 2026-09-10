import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import PDFDocument from 'pdfkit';

// Reports remain readable Markdown in the app, with a local PDF for sharing.
export async function writeReportPdf(file: string, title: string, markdown: string): Promise<void> {
  const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: title, Author: 'Astra HQ' } });
  const saved = pipeline(doc, createWriteStream(file, { flags: 'wx' }));
  const plain = (text: string) =>
    text
      .replace(/→/g, '->')
      .replace(/←/g, '<-')
      .replace(/↓/g, ' (lower)')
      .replace(/↑/g, ' (higher)')
      .replace(/−/g, '-')
      .replace(/\*\*|__|`/g, '')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#52706b').text('ASTRA HQ / REPORT');
  doc.moveDown();
  const lines = markdown.split('\n');
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line.trim().startsWith('|')) {
      const rows: string[][] = [];
      while (index < lines.length && lines[index].trim().startsWith('|')) {
        const cells = lines[index++]
          .trim()
          .replace(/^\||\|$/g, '')
          .split('|')
          .map((cell) => plain(cell.trim()));
        if (!cells.every((cell) => /^:?-+:?$/.test(cell))) rows.push(cells);
      }
      index--;
      doc.font('Helvetica').fontSize(9).fillColor('#283d39');
      doc.table({
        data: rows,
        defaultStyle: { padding: 5, border: 0.5, borderColor: '#d9d5c7' },
        rowStyles: (row) => (row === 0 ? { backgroundColor: '#e7eee7' } : {}),
      });
      doc.moveDown(0.5);
      continue;
    }
    if (/^\s*(```|\|?\s*:?-{3,})/.test(line)) continue;
    if (!line.trim()) {
      doc.moveDown(0.4);
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    doc
      .font(heading ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(heading ? (heading[1].length === 1 ? 20 : 13) : 10)
      .fillColor(heading ? '#173b36' : '#283d39');
    if (heading) doc.moveDown(0.35);
    doc.text(plain(heading ? heading[2] : line), { lineGap: 3 });
  }
  doc.end();
  await saved;
}
