import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { demoDataDirectory, projectEvidenceInventory } from '../runtime/evidence';
import { initialSnapshot } from '../runtime/fixtures';
import { demoEvents } from '../runtime/story';
import { triagePrompt } from '../runtime/triage';

test('triage lists actual executor project files without exposing future arrivals', () => {
  const inventory = projectEvidenceInventory();
  const directory = path.join(demoDataDirectory, 'projects');
  const files = readdirSync(directory, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile());
  assert.equal(inventory.length, files.length);
  assert.ok(inventory.includes('data/projects/harbor/hbr-owner-register.csv'));
  assert.ok(inventory.every((file) => file.startsWith('data/projects/')));

  const now = Date.parse('2026-09-10T14:00:00Z');
  const source = demoEvents(now).find((event) => event.id === 'arrival-gmail-deep-01')!.item;
  const state = initialSnapshot(now);
  // Prove the local inventory survives even when retrieval provides no source excerpts.
  state.sources = [source];
  const prompt = triagePrompt(source, state);
  assert.ok(prompt.includes('data/projects/harbor/hbr-owner-register.csv'));
  assert.ok(prompt.includes('Do not wait merely because a listed file has no excerpt.'));
  assert.ok(!prompt.includes('hbr-clinic-approval-notes.md'));
  assert.ok(!prompt.includes('pin-184-acceptance.test.js'));
  assert.ok(!prompt.includes('data/arrivals/'));
});
