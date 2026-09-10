import { cp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Agent, Artifact, BoardPost, Snapshot, SourceItem } from '../src/shared/types';

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

  const sources: SourceItem[] = [
    { id: 'src-gmail-report', source: 'gmail', externalId: 'gmail-8841', threadId: 'quarterly-readout', author: 'Nora Feld', title: 'Friday leadership readout', content: 'Could you turn the launch notes into a one-page brief before Friday?', timestamp: now - 4 * HOUR, scenario: 'report', disposition: 'pending' },
    { id: 'src-gmail-dinner', source: 'gmail', externalId: 'gmail-8840', threadId: 'client-dinner', author: 'Avery Ross', title: 'Dinner after the workshop', content: 'Six people, quiet enough to talk, vegetarian options, around 7:30 Thursday.', timestamp: now - 7 * HOUR, scenario: 'dinner', disposition: 'pending' },
    { id: 'src-calendar-planning', source: 'calendar', externalId: 'cal-220', threadId: 'leadership-meeting', author: 'Team calendar', title: 'Friday leadership meeting', content: 'Prepare Nora for Friday: launch readout, checkout fix status, decisions, and open risks.', timestamp: now - 3 * HOUR, scenario: 'meeting', disposition: 'pending' },
    { id: 'src-calendar-focus', source: 'calendar', externalId: 'cal-219', threadId: 'focus-block', author: 'Team calendar', title: 'Engineering focus block', content: 'Wednesday 9:00–11:00 AM is reserved for release work.', timestamp: now - 21 * HOUR, disposition: 'ignored', reason: 'No action requested' },
    { id: 'src-imessage-dinner', source: 'imessage', externalId: 'msg-601', threadId: 'client-dinner', author: 'Avery', title: 'Re: dinner', content: 'Patio would be nice if the weather holds. Somewhere near Union Square.', timestamp: now - 2 * HOUR, scenario: 'dinner', disposition: 'pending' },
    { id: 'src-imessage-travel', source: 'imessage', externalId: 'msg-598', threadId: 'train-note', author: 'Dad', title: 'Train update', content: 'Made the earlier train. No need to change anything.', timestamp: now - 11 * HOUR, disposition: 'ignored', reason: 'Informational message' },
    { id: 'src-slack-bug', source: 'slack', externalId: 'slack-442', threadId: 'checkout-total', author: 'Mina Park', channel: '#release-room', title: 'Checkout total regression', content: 'Tax is counted twice when a percentage coupon is present. Repro is in the fixture.', timestamp: now - 96 * 60_000, scenario: 'bug', disposition: 'pending' },
    { id: 'src-slack-qa', source: 'slack', externalId: 'slack-438', threadId: 'release-qa', author: 'Owen Price', channel: '#release-room', title: 'QA pass requested', content: 'Please run a focused checkout test after the tax fix lands.', timestamp: now - 5 * HOUR, scenario: 'qa', disposition: 'pending' },
    { id: 'src-discord-bug', source: 'discord', externalId: 'discord-901', threadId: 'checkout-total', author: 'pixelpilot', channel: '#beta-feedback', title: 'Coupon total looks wrong', content: 'My $10 coupon checkout adds tax twice. Screenshot values: subtotal 100, total 107.60.', timestamp: now - 73 * 60_000, scenario: 'bug', disposition: 'pending' },
    { id: 'src-discord-note', source: 'discord', externalId: 'discord-897', threadId: 'theme-chat', author: 'nightowl', channel: '#lounge', title: 'Office theme', content: 'The little plants in the office mockup are delightful.', timestamp: now - 9 * HOUR, disposition: 'ignored', reason: 'Social conversation' },
    { id: 'src-linear-bug', source: 'linear', externalId: 'LIN-184', threadId: 'checkout-total', author: 'Mina Park', title: 'LIN-184: correct discounted tax calculation', content: 'Expected tax to apply once to the discounted subtotal. Priority: high.', timestamp: now - 60 * 60_000, scenario: 'bug', disposition: 'pending' },
    { id: 'src-linear-qa', source: 'linear', externalId: 'LIN-182', threadId: 'release-qa', author: 'Lena Ortiz', title: 'LIN-182: checkout smoke test', content: 'Verify fixed totals and unchanged full-price totals.', timestamp: now - 6 * HOUR, scenario: 'qa', disposition: 'pending' },
    { id: 'src-asana-report', source: 'asana', externalId: 'asana-310', threadId: 'quarterly-readout', author: 'Nora Feld', title: 'Draft launch readout', content: 'Summarize adoption, support volume, and the two open launch decisions.', timestamp: now - 3.5 * HOUR, scenario: 'report', disposition: 'pending' },
    { id: 'src-asana-meeting', source: 'asana', externalId: 'asana-307', threadId: 'leadership-meeting', author: 'Jonah Brooks', title: 'Prepare Friday leadership meeting', content: 'Bring the launch summary, checkout patch status, decisions, and unresolved risks.', timestamp: now - 2.5 * HOUR, scenario: 'meeting', disposition: 'pending' },
  ];

  const artifacts: Artifact[] = [
    { id: 'artifact-welcome-brief', workId: 'work-welcome', title: 'Monday source digest', kind: 'brief', content: 'SIMULATED DEMO ARTIFACT\n\nA short digest of messages already waiting in the office.', createdAt: now - 22 * HOUR, simulated: true },
    { id: 'artifact-welcome-qa', workId: 'work-welcome', title: 'Previous checkout QA notes', kind: 'qa', content: 'SIMULATED DEMO ARTIFACT\n\nBaseline checkout passed before the reported percentage-coupon regression.', createdAt: now - 20 * HOUR, simulated: true },
  ];
  const board: BoardPost[] = [
    { id: 'board-welcome-1', agentId: 'agent-maya', workId: 'work-welcome', artifactId: 'artifact-welcome-brief', kind: 'complete', text: 'Simulated history: Monday source digest is ready.', timestamp: now - 22 * HOUR },
    { id: 'board-welcome-2', agentId: 'agent-lena', workId: 'work-welcome', artifactId: 'artifact-welcome-qa', kind: 'finding', text: 'Simulated history: baseline checkout notes are pinned for comparison.', timestamp: now - 20 * HOUR },
  ];

  return {
    revision: 1, sources, agents, work: [], runs: [], activity: [
      { id: 'event-1', sequence: 1, timestamp: now - HOUR, kind: 'system', text: 'Demo office loaded. New output is marked as simulated.' },
    ], artifacts, board, routines: [], calendar: [],
    auth: { status: 'checking' },
    settings: { mode: 'demo', reducedMotion: false, sound: true, model: 'gpt-5.1-codex-mini' },
    demo: { playing: false, nextIndex: 0, speed: 1 },
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
