import { cp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Agent, Artifact, BoardPost, Snapshot } from '../src/shared/types';

import { demoEvents, initialCalendar, initialSources } from './story';

const HOUR = 60 * 60 * 1_000;

export function initialSnapshot(now = Date.now()): Snapshot {
  const agents: Agent[] = [
    { id: 'agent-maya', name: 'Maya Chen', role: 'Chief of staff', color: '#e8795f', hair: '#241c1a', skin: '#c98562', accessory: 'glasses', persistent: false, activity: 'idle', statusText: 'Available for triage', home: 0 },
    { id: 'agent-eli', name: 'Eli Navarro', role: 'Research analyst', color: '#5b8def', hair: '#33251f', skin: '#a96748', accessory: 'headphones', persistent: true, activity: 'idle', statusText: 'Available for research', home: 1 },
    { id: 'agent-priya', name: 'Priya Shah', role: 'Software engineer', color: '#8b6fd6', hair: '#17131a', skin: '#9f624b', accessory: 'none', persistent: false, activity: 'idle', statusText: 'Available for engineering work', home: 2 },
    { id: 'agent-jonah', name: 'Jonah Brooks', role: 'Coordinator', color: '#3fae8c', hair: '#9a633c', skin: '#d69a76', accessory: 'cap', persistent: false, activity: 'idle', statusText: 'Available for coordination', home: 3 },
    { id: 'agent-lena', name: 'Lena Ortiz', role: 'QA lead', color: '#d5993f', hair: '#40271d', skin: '#b87350', accessory: 'glasses', persistent: true, activity: 'idle', statusText: 'Available for QA', home: 4 },
    { id: 'agent-sam', name: 'Sam Okafor', role: 'Operations', color: '#4f9fb5', hair: '#17120f', skin: '#68412f', accessory: 'headphones', persistent: false, activity: 'idle', statusText: 'Available for operations work', home: 5 },
  ];

  const sources = initialSources(now);

  const artifacts: Artifact[] = [
    { id: 'artifact-welcome-brief', workId: 'work-welcome', title: 'Monday source digest', kind: 'brief', content: '# Previous office source digest\n\nFictional historical artifact.\n\nThe Pinecone Commerce archive records 170 activated merchants of 250 eligible, or 68%. Support questions declined from 31 to 18 in the archived period. Seven merchant migrations still await confirmation. Nora Feld owns the launch decision, Eli Navarro owns reporting, and Mina Park owns engineering. The decision is to keep the staged rollout at 68% until migration checks are complete.\n\nThe seven migration owners are Nora Feld for Birch Books, Eli Navarro for Copper Coffee, Mina Park for Poppy Goods, Sam Okafor for Juniper Bikes, Jonah Brooks for Fern Market, Lena Ortiz for Oak Paper, and Maya Chen for Willow Studio.\n\nHarbor Health is a separate project: 84 of 120 reminders delivered, front desk questions down from 24 to 11, and translated reminder copy awaiting clinic approval. Its counts must not be mixed into the Pinecone report.\n\nSources: history-pinecone-02, pin-weekly-metrics.csv; history-pinecone-03, pin-owner-register.csv; history-harbor-02, hbr-weekly-metrics.csv. New arrivals may correct this archived baseline.', createdAt: now - 22 * HOUR, simulated: true },
    { id: 'artifact-welcome-qa', workId: 'work-welcome', title: 'Previous checkout QA notes', kind: 'qa', content: '# Previous checkout QA scope\n\nFictional historical artifact.\n\nThe previous release verified a full-price checkout: $100 subtotal plus 8% tax equals $108. PIN-172, the narrow-screen receipt footer issue, was fixed and its reporter confirmed the result.\n\nThat check did not exercise a fixed-value coupon. It cannot establish that a later coupon change is correct. If a new checkout issue arrives, QA must use that issue\'s reproduction, run against its completed patch, and record both coupon and full-price results.\n\nSource: history-pinecone-06 and pin-release-notes.md. The full-price baseline is historical; the coupon result requires fresh verification.', createdAt: now - 20 * HOUR, simulated: true },
  ];
  const board: BoardPost[] = [
    { id: 'board-welcome-1', agentId: 'agent-maya', workId: 'work-welcome', artifactId: 'artifact-welcome-brief', kind: 'complete', text: 'Simulated history: Monday source digest is ready.', timestamp: now - 22 * HOUR },
    { id: 'board-welcome-2', agentId: 'agent-lena', workId: 'work-welcome', artifactId: 'artifact-welcome-qa', kind: 'finding', text: 'Simulated history: baseline checkout notes are pinned for comparison.', timestamp: now - 20 * HOUR },
  ];

  return {
    revision: 1, sources, agents, triage: [], work: [{
      id: 'work-welcome', title: 'Prepare the office source digest', goal: 'Summarize the fictional office sources and prior checkout QA.',
      sourceIds: ['history-pinecone-02', 'history-pinecone-03', 'history-pinecone-06', 'history-harbor-02'], agentId: 'agent-maya', status: 'completed', scenario: 'report',
      createdAt: now - 23 * HOUR, completedAt: now - 20 * HOUR, mode: 'demo',
    }], runs: [], activity: [
      { id: 'event-1', sequence: 1, timestamp: now - HOUR, kind: 'system', text: 'Sample inbox ready. Deliver a message to give the office work.' },
    ], artifacts, board, routines: [
      { id: 'routine-1', agentId: 'agent-eli', name: 'Morning launch readout', instructions: 'Summarize the launch evidence and list open decisions.', enabled: false, schedule: 'daily', intervalMinutes: 60, dailyTime: '09:00', nextRunAt: now + 24 * HOUR, notes: 'Keep the readout concise. Enable this routine when ready.' },
      { id: 'routine-2', agentId: 'agent-lena', name: 'Checkout verification', instructions: 'Run focused checkout QA and report any failures.', enabled: false, schedule: 'daily', intervalMinutes: 60, dailyTime: '10:00', nextRunAt: now + 25 * HOUR, notes: 'Check full-price and coupon totals after a live fix.' },
    ], calendar: initialCalendar(now),
    auth: { status: 'checking' },
    settings: { mode: 'live', reducedMotion: false, sound: true, model: '' },
    demo: { playing: false, nextIndex: 0, speed: 1, events: demoEvents(now).map(event => ({ id: event.id, label: event.label, source: event.item.source, item: event.item, delivered: false })) },
  };
}

export async function writeInitialArtifacts(dataDir: string, snapshot: Snapshot): Promise<void> {
  const directory = path.join(dataDir, 'artifacts');
  await mkdir(directory, { recursive: true });
  for (const artifact of snapshot.artifacts) {
    const filePath = path.join(directory, `${artifact.id}.md`);
    await writeFile(filePath, artifact.content, 'utf8');
    artifact.filePath = filePath;
  }
}

export async function createBugFixture(dataDir: string): Promise<string> {
  const template = path.join(dataDir, 'fixture-template');
  await mkdir(path.join(template, 'test'), { recursive: true });
  await writeFile(path.join(template, 'package.json'), JSON.stringify({ name: 'checkout-fixture', private: true, scripts: { test: 'node --test' } }, null, 2));
  await writeFile(path.join(template, 'checkout.js'), `export function checkoutTotal(subtotal, taxRate, coupon = 0) {\n  const discounted = subtotal - coupon;\n  const tax = discounted * taxRate;\n  return discounted + tax + (coupon > 0 ? tax : 0);\n}\n`);
  await writeFile(path.join(template, 'test', 'checkout.test.js'), `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { checkoutTotal } from '../checkout.js';\n\ntest('full-price checkout applies tax once', () => {\n  assert.equal(checkoutTotal(100, 0.08), 108);\n});\n\ntest('coupon checkout taxes the discounted subtotal once', () => {\n  assert.equal(checkoutTotal(100, 0.08, 10), 97.2);\n});\n`);
  return template;
}

export async function copyBugFixture(template: string, workspace: string): Promise<void> {
  await mkdir(workspace, { recursive: true });
  await cp(template, workspace, { recursive: true });
}
