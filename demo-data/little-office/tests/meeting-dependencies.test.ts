import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRuntime } from '../runtime/engine';
import type { TriageDecision } from '../runtime/triage';
import type { Snapshot, SourceItem, TriageRecord, WorkItem } from '../src/shared/types';

for (const hasReplacement of [false, true]) {
  test(`meeting context revisions retain prerequisites${hasReplacement ? ' using the supplied newer report' : ' for later corrections'}`, async (t) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'office-meeting-deps-'));
    const previous = process.env.CODEX_BIN;
    process.env.CODEX_BIN = path.join(directory, 'no-codex');
    const office = await createRuntime({ dataDir: directory, onSnapshot: () => undefined });
    t.after(async () => {
      await office.close();
      if (previous === undefined) delete process.env.CODEX_BIN;
      else process.env.CODEX_BIN = previous;
      await rm(directory, { recursive: true, force: true });
    });
    const runtime = office as unknown as {
      state: Snapshot;
      applyTriage(record: TriageRecord, source: SourceItem, decision: TriageDecision): void;
      refreshMeetingBriefs(work: WorkItem): void;
      refreshDependencies(): void;
    };
    const report = runtime.state.work[0];
    const qa: WorkItem = { ...report, id: 'qa', scenario: 'qa' };
    const revised: WorkItem = { ...report, id: 'report-revision', followUpOf: report.id };
    const source = runtime.state.sources[0];
    const meeting: WorkItem = { ...report, id: 'meeting', scenario: 'meeting', triggerSourceId: source.id, dependsOnWorkIds: [report.id, qa.id] };
    runtime.state.work.push(qa, revised, meeting);
    runtime.applyTriage({ id: 'triage-test', sourceId: source.id, status: 'running', createdAt: Date.now() }, source, {
      action: 'attach', reason: 'Add the requested context to the brief.', scenario: 'meeting', title: 'Updated meeting brief', goal: 'Include the additional context.',
      workId: meeting.id, sourceIds: [source.id], dependsOnWorkIds: hasReplacement ? [revised.id] : [],
      needsInformation: false, requiresFollowUp: true, calendarDraft: null,
    });
    const followUp = runtime.state.work.find((work) => work.followUpOf === meeting.id)!;
    assert.deepEqual(new Set(followUp.dependsOnWorkIds), new Set([meeting.id, qa.id, hasReplacement ? revised.id : report.id]));
    runtime.refreshMeetingBriefs(revised);
    runtime.refreshDependencies();
    assert.deepEqual(new Set(followUp.dependsOnWorkIds), new Set([meeting.id, qa.id, revised.id]));
    assert.equal(runtime.state.work.filter((work) => work.followUpOf === meeting.id).length, 1);
  });
}
