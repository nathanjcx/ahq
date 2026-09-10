import { readFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { LocalArtifact, LocalTaskInput } from '../shared/demo';

const columns = ['month', 'customers', 'price_usd', 'revenue_usd', 'cost_usd', 'marketing_spend_usd', 'operating_contribution_usd'];
export async function verifyLaunchForecast(workspace: string, task: LocalTaskInput, fixture: string): Promise<LocalArtifact> {
  const filePath = path.join(workspace, 'forecast.csv');
  if (!(await lstat(filePath)).isFile()) throw new Error('forecast.csv must be a regular file.');
  const content = await readFile(filePath, 'utf8');
  const rows = content.trim().split(/\r?\n/).map(row => row.split(',').map(cell => cell.trim()));
  if (rows.shift()?.join(',') !== columns.join(',')) throw new Error(`forecast.csv must use columns ${columns.join(',')}.`);
  const contract = JSON.parse(await readFile(path.join(fixture, 'forecast-contract.json'), 'utf8')) as { baseline: (string | number)[][]; revised: (string | number)[][] };
  const expected = task.launchStep === 'revision' ? contract.revised : contract.baseline;
  if (rows.length !== expected.length) throw new Error('The forecast must cover all six launch months.');
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].length !== columns.length || rows[i][0] !== expected[i][0]) throw new Error('Forecast months or columns do not match the launch contract.');
    for (let j = 1; j < columns.length; j++) {
      const value = Number(rows[i][j]);
      if (!rows[i][j] || !Number.isFinite(value) || Math.abs(value - Number(expected[i][j])) > 0.005) throw new Error(`Check ${rows[i][0]} ${columns[j]} against the supplied forecast formula and assumptions.`);
    }
  }
  if (task.launchStep === 'revision') {
    const original = task.files.find(file => file.name === 'original-forecast.csv');
    if (!original) throw new Error('The revised forecast must be based on the saved original forecast.');
    if (original.content.trim() === content.trim()) throw new Error('The competitor scenario did not revise the original forecast.');
  }
  return { id: randomUUID(), title: task.launchStep === 'revision' ? 'Revised forecast · verified CSV' : 'Baseline forecast · verified CSV', kind: 'report', filePath, content, simulated: false };
}
