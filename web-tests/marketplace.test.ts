import { describe, expect, it } from 'vitest';
import { api } from '../convex/_generated/api';
import type { Id } from '../convex/_generated/dataModel';
import { ensureReservedInstance } from '../convex/lib/reserved';
import { defaultWorkspaceSettings, type Capability, type WorkspaceSettings } from '../lib/contracts';
import { FLOOR_RULES, MEMORY_PLACEHOLDER, OPERATING_RULES, composeInstructions } from '../lib/instructions';
import {
  adminIdentity,
  connectLinear,
  harness,
  hireOne,
  identity,
  linearWorkspace,
  secret,
  type Harness,
} from './support';

const ownerIdentity = identity('owner', 'acme', 'org:admin');
const memberIdentity = identity('member', 'acme', 'org:member');
const persona = { voice: 'Writes in short declaratives.', traits: ['terse'] };

type DraftInput = {
  draftId?: Id<'employeeDrafts'>;
  name?: string;
  description?: string;
  instructions?: string;
  capabilities?: Capability[];
};

/** Saves and publishes a draft, keeping the draft id the studio queries need. */
async function publishVersion(t: Harness, input: DraftInput = {}) {
  const admin = t.withIdentity(adminIdentity);
  const { draftId } = await admin.mutation(api.marketplace.saveDraft, {
    draftId: input.draftId,
    name: input.name ?? 'Ada',
    role: 'Analyst',
    description: input.description ?? 'Reviews operating work and prepares updates.',
    category: 'Operations',
    strengths: ['Careful review'],
    limitations: ['External writes require approval'],
    capabilities: input.capabilities ?? [],
    model: 'gpt-5.6-terra',
    color: '#6757d9',
    media: [],
    instructions: input.instructions ?? 'Follow the approved task and cite the records used.',
    skills: [],
    persona,
  });
  const published = await admin.mutation(api.marketplace.publish, { draftId });
  return { draftId, ...published };
}

async function marketplace(t: Harness, input: DraftInput = {}) {
  await linearWorkspace(t);
  const published = await publishVersion(t, input);
  const owner = t.withIdentity(ownerIdentity);
  await owner.mutation(api.workspace.bootstrap, { name: 'Acme' });
  return {
    owner,
    member: t.withIdentity(memberIdentity),
    admin: t.withIdentity(adminIdentity),
    ...published,
  };
}

type Caller = ReturnType<Harness['withIdentity']>;

function saveSettings(owner: Caller, values: Partial<Omit<WorkspaceSettings, 'updatedAt'>> = {}) {
  return owner.mutation(api.schedule.updateSettings, {
    ...defaultWorkspaceSettings,
    timezone: 'UTC',
    ...values,
  });
}

/** Runs a task's start command through the queue and reports the session as completed. */
async function completeTask(t: Harness, taskId: Id<'tasks'>) {
  const jobs = await t.mutation(api.services.queue.claimJobs, { secret, workerId: 'worker-1', limit: 10 });
  const start = jobs.find((job) => job.taskId === taskId && job.kind === 'start_task');
  if (!start) throw new Error('Expected a start command for this task');
  await t.mutation(api.services.queue.completeJob, { secret, jobId: start.id, leaseToken: start.leaseToken });
  const session = await t.query(api.services.sessions.sessionContext, { secret, taskId });
  await t.mutation(api.services.sessions.recordEvents, {
    secret,
    taskId,
    events: [],
    status: 'completed',
    inputRevision: session.inputRevision,
  });
}

describe('listings', () => {
  it('shows published listings with their evidence and usage counts, and hides the rest', async () => {
    const t = harness();
    const { owner, admin, listingId } = await marketplace(t);
    const other = await publishVersion(t, { name: 'Bruno' });

    await admin.mutation(api.marketplace.setEvidence, {
      listingId,
      evidence: {
        sampleTask: 'Summarise the release queue.',
        sampleOutput: 'Three issues are blocked on review.',
        link: 'https://example.com/sample',
      },
    });
    await hireOne(owner, listingId);
    const { employeeId } = await hireOne(owner, listingId);
    const { taskId } = await owner.mutation(api.tasks.create, {
      employeeId,
      title: 'Review the queue',
      prompt: 'Review the new work.',
    });
    await completeTask(t, taskId);

    const listed = await owner.query(api.marketplace.list, {});
    expect(listed.map((listing) => listing.name).sort()).toEqual(['Ada', 'Bruno']);
    expect(listed.find((listing) => listing.listingId === listingId)).toMatchObject({
      currentVersion: 1,
      visibility: 'published',
      hires: 2,
      completedTasks: 1,
      evidence: { sampleTask: 'Summarise the release queue.', link: 'https://example.com/sample' },
    });

    await admin.mutation(api.marketplace.setVisibility, { listingId: other.listingId, visibility: 'hidden' });
    expect((await owner.query(api.marketplace.list, {})).map((listing) => listing.name)).toEqual(['Ada']);
    await expect(hireOne(owner, other.listingId)).rejects.toThrow('Listing is unavailable');
  });

  it('refuses evidence links that are not plain HTTPS', async () => {
    const t = harness();
    const { admin, listingId } = await marketplace(t);
    await expect(
      admin.mutation(api.marketplace.setEvidence, {
        listingId,
        evidence: { sampleTask: 'A task', sampleOutput: 'An output', link: 'http://example.com' },
      }),
    ).rejects.toThrow('HTTPS');
  });

  it('keeps one listing per draft and moves it to the newest version', async () => {
    const t = harness();
    const { owner, draftId, listingId } = await marketplace(t);
    const second = await publishVersion(t, { draftId, description: 'Reviews work and writes the update.' });
    expect(second.listingId).toBe(listingId);
    expect(await owner.query(api.marketplace.list, {})).toMatchObject([
      { listingId, versionId: second.versionId, currentVersion: 2 },
    ]);
  });
});

describe('instances', () => {
  it('hires a count onto a floor with numbered names and staffs the floor', async () => {
    const t = harness();
    const { owner, listingId } = await marketplace(t);
    const { floorId } = await owner.mutation(api.floors.create, {
      name: 'Launch',
      brief: 'Prepare the launch.',
      employeeIds: [],
    });

    const { employeeIds } = await owner.mutation(api.marketplace.hire, { listingId, floorId, count: 3 });
    expect(employeeIds).toHaveLength(3);
    const dashboard = await owner.query(api.workspace.dashboard, {});
    expect(dashboard.employees.map((employee) => employee.name)).toEqual(['Ada', 'Ada 2', 'Ada 3']);
    expect(dashboard.employees[0]).toMatchObject({
      listingId,
      floorId,
      kind: 'worker',
      version: 1,
      updateAvailable: false,
      instanceOf: 'Ada',
    });
    expect(dashboard.floors[0]?.employeeIds).toEqual(employeeIds);

    // A given name is numbered the same way, and never collides with the names already there.
    const { employeeIds: named } = await owner.mutation(api.marketplace.hire, {
      listingId,
      floorId,
      name: 'Ada',
    });
    expect((await owner.query(api.workspace.dashboard, {})).employees.at(-1)?.name).toBe('Ada 4');
    expect(named).toHaveLength(1);
  });

  it('refuses to hire past the workspace concurrency cap', async () => {
    const t = harness();
    const { owner, listingId } = await marketplace(t);
    await saveSettings(owner, { maxConcurrentInstances: 2 });
    await owner.mutation(api.marketplace.hire, { listingId, count: 2 });
    await expect(owner.mutation(api.marketplace.hire, { listingId })).rejects.toThrow(
      'runs at most 2 instances and already has 2',
    );
  });

  it('renames, moves between floors, and retires an instance that is free', async () => {
    const t = harness();
    const { owner, listingId } = await marketplace(t);
    const { floorId } = await owner.mutation(api.floors.create, {
      name: 'Launch',
      brief: 'Prepare the launch.',
      employeeIds: [],
    });
    const { employeeIds } = await owner.mutation(api.marketplace.hire, { listingId, count: 2 });
    const [first, second] = employeeIds;

    await owner.mutation(api.marketplace.rename, { employeeId: first, name: 'Nova' });
    await expect(
      owner.mutation(api.marketplace.rename, { employeeId: second, name: 'Nova' }),
    ).rejects.toThrow('already called Nova');

    await owner.mutation(api.marketplace.move, { employeeId: first, floorId });
    expect((await owner.query(api.workspace.dashboard, {})).floors[0]?.employeeIds).toEqual([first]);
    await owner.mutation(api.marketplace.move, { employeeId: first });
    expect((await owner.query(api.workspace.dashboard, {})).floors[0]?.employeeIds).toEqual([]);

    const { taskId } = await owner.mutation(api.tasks.create, {
      employeeId: second,
      title: 'Review the queue',
      prompt: 'Review the new work.',
    });
    await expect(owner.mutation(api.marketplace.retireInstance, { employeeId: second })).rejects.toThrow(
      'active work',
    );
    await owner.mutation(api.tasks.cancel, { taskId });
    await owner.mutation(api.marketplace.retireInstance, { employeeId: second });
    // A retired instance stays listed, so past work still resolves a name, but reads as retired.
    expect(
      (await owner.query(api.workspace.dashboard, {})).employees.map((one) => [one.id, one.status]),
    ).toEqual([
      [first, 'ready'],
      [second, 'retired'],
    ]);
  });

  it('numbers a moved instance again when its name is taken on the destination floor', async () => {
    const t = harness();
    const { owner, listingId } = await marketplace(t);
    const { floorId } = await owner.mutation(api.floors.create, {
      name: 'Launch',
      brief: 'Prepare the launch.',
      employeeIds: [],
    });
    await owner.mutation(api.marketplace.hire, { listingId, floorId });
    const { employeeIds } = await owner.mutation(api.marketplace.hire, { listingId });
    const [lobbyInstance] = employeeIds;

    expect(await owner.mutation(api.marketplace.move, { employeeId: lobbyInstance, floorId })).toMatchObject({
      name: 'Ada 2',
    });
  });
});

describe('hiring policy', () => {
  it('lets only owners and admins hire under the admins policy', async () => {
    const t = harness();
    const { owner, member, listingId } = await marketplace(t);
    await saveSettings(owner, { hiringPolicy: 'admins' });
    await expect(member.mutation(api.marketplace.hire, { listingId })).rejects.toThrow(
      'Only workspace owners and admins can hire',
    );
    expect((await owner.mutation(api.marketplace.hire, { listingId })).employeeIds).toHaveLength(1);
  });

  it('files a member request under the approval policy and hires it when an admin approves', async () => {
    const t = harness();
    const { owner, member, listingId } = await marketplace(t);
    const { floorId } = await owner.mutation(api.floors.create, {
      name: 'Launch',
      brief: 'Prepare the launch.',
      employeeIds: [],
    });
    await saveSettings(owner, { hiringPolicy: 'approval' });

    const requested = await member.mutation(api.marketplace.hire, { listingId, floorId, count: 2 });
    expect(requested.employeeIds).toEqual([]);
    expect(await owner.query(api.workspace.dashboard, {})).toMatchObject({ employees: [] });
    expect(await member.query(api.marketplace.hireRequests, {})).toMatchObject([
      { listingName: 'Ada', count: 2, status: 'pending', requestedBy: 'member', floorId },
    ]);
    const [request] = await owner.query(api.marketplace.hireRequests, {});
    await expect(
      member.mutation(api.marketplace.decideHire, { requestId: request.id, approved: true }),
    ).rejects.toThrow('owner or administrator');

    const decided = await owner.mutation(api.marketplace.decideHire, {
      requestId: request.id,
      approved: true,
    });
    expect(decided.employeeIds).toHaveLength(2);
    expect((await owner.query(api.workspace.dashboard, {})).floors[0]?.employeeIds).toEqual(
      decided.employeeIds,
    );
    await expect(
      owner.mutation(api.marketplace.decideHire, { requestId: request.id, approved: false }),
    ).rejects.toThrow('already decided');
  });

  it('declines a request without hiring', async () => {
    const t = harness();
    const { owner, member, listingId } = await marketplace(t);
    await saveSettings(owner, { hiringPolicy: 'approval' });
    const { requestId } = await member.mutation(api.marketplace.hire, { listingId });
    if (!requestId) throw new Error('Expected a hire request');
    await owner.mutation(api.marketplace.decideHire, { requestId, approved: false });
    expect(await owner.query(api.marketplace.hireRequests, {})).toMatchObject([
      { status: 'declined', decidedBy: 'owner' },
    ]);
    expect((await owner.query(api.workspace.dashboard, {})).employees).toEqual([]);
  });
});

describe('upgrade', () => {
  it('re-pins an instance to the current version and names what changed', async () => {
    const t = harness();
    const { owner, draftId, listingId } = await marketplace(t);
    const { employeeId } = await hireOne(owner, listingId);
    await publishVersion(t, {
      draftId,
      description: 'Reviews operating work and writes the weekly update.',
      instructions: 'Follow the approved task, cite the records used, and note what is unverified.',
    });

    expect((await owner.query(api.workspace.dashboard, {})).employees[0]).toMatchObject({
      version: 1,
      updateAvailable: true,
    });
    expect(await owner.mutation(api.marketplace.upgrade, { employeeId })).toEqual({
      version: 2,
      changed: ['description', 'instructions'],
    });
    expect((await owner.query(api.workspace.dashboard, {})).employees[0]).toMatchObject({
      version: 2,
      updateAvailable: false,
    });
    // Nothing left to move to, so the upgrade is a no-op rather than an error.
    expect(await owner.mutation(api.marketplace.upgrade, { employeeId })).toEqual({
      version: 2,
      changed: [],
    });
  });

  it('refuses an upgrade whose new version needs a connection the workspace cannot reach', async () => {
    const t = harness();
    const { owner, draftId, listingId } = await marketplace(t);
    const { employeeId } = await hireOne(owner, listingId);
    await publishVersion(t, {
      draftId,
      capabilities: [{ provider: 'linear', tools: ['update_issue'], optional: false }],
    });

    await expect(owner.mutation(api.marketplace.upgrade, { employeeId })).rejects.toThrow('Connect linear');
    expect((await owner.query(api.workspace.dashboard, {})).employees[0]).toMatchObject({ version: 1 });

    await connectLinear(t, { subject: 'owner', orgId: 'acme' });
    expect(await owner.mutation(api.marketplace.upgrade, { employeeId })).toMatchObject({ version: 2 });
  });
});

describe('studio', () => {
  it('previews the instruction block a session would receive', async () => {
    const t = harness();
    const { admin, draftId } = await marketplace(t);
    const preview = await admin.query(api.marketplace.previewInstructions, { draftId });
    expect(preview).toBe(
      composeInstructions({
        operatingRules: OPERATING_RULES,
        floorRules: FLOOR_RULES,
        memoryPlaceholder: MEMORY_PLACEHOLDER,
        persona,
        instructions: 'Follow the approved task and cite the records used.',
      }),
    );
    expect(preview).toContain('Writes in short declaratives.');
  });

  it('diffs the draft against the published version, and calls every field new before publishing', async () => {
    const t = harness();
    const { admin, draftId } = await marketplace(t);
    expect(await admin.query(api.marketplace.versionDiff, { draftId })).toMatchObject({
      currentVersion: 1,
      fields: [],
    });

    await admin.mutation(api.marketplace.saveDraft, {
      draftId,
      name: 'Ada',
      role: 'Analyst',
      description: 'Reviews operating work and writes the weekly update.',
      category: 'Operations',
      strengths: ['Careful review', 'Traces a change across tools'],
      limitations: ['External writes require approval'],
      capabilities: [],
      model: 'gpt-5.6-terra',
      color: '#6757d9',
      media: [],
      instructions: 'Follow the approved task and cite the records used.',
      skills: [],
      persona,
    });
    expect(await admin.query(api.marketplace.versionDiff, { draftId })).toMatchObject({
      currentVersion: 1,
      fields: [
        {
          field: 'description',
          before: 'Reviews operating work and prepares updates.',
          after: 'Reviews operating work and writes the weekly update.',
        },
        {
          field: 'strengths',
          before: 'Careful review',
          after: 'Careful review\nTraces a change across tools',
        },
      ],
    });

    const unpublished = await t.withIdentity(adminIdentity).mutation(api.marketplace.saveDraft, {
      name: 'Bruno',
      role: 'Writer',
      description: 'Writes the release notes.',
      category: 'Operations',
      strengths: [],
      limitations: [],
      capabilities: [],
      model: 'gpt-5.6-terra',
      color: '#6757d9',
      media: [],
      instructions: 'Write the notes.',
      skills: [],
    });
    const fresh = await admin.query(api.marketplace.versionDiff, { draftId: unpublished.draftId });
    expect(fresh.currentVersion).toBeUndefined();
    expect(fresh.fields.map((field) => field.field)).toContain('instructions');
    expect(fresh.fields.every((field) => field.before === '')).toBe(true);
  });

  it('keeps the studio queries to platform administrators', async () => {
    const t = harness();
    const { owner, draftId } = await marketplace(t);
    await expect(owner.query(api.marketplace.previewInstructions, { draftId })).rejects.toThrow(
      'Platform administrator',
    );
    await expect(owner.query(api.marketplace.versionDiff, { draftId })).rejects.toThrow(
      'Platform administrator',
    );
  });
});

describe('instance status and versions', () => {
  it('hires with chosen names and an overnight model, and refuses a name already on the floor', async () => {
    const t = harness();
    const { owner, listingId } = await marketplace(t);
    const { floorId } = await owner.mutation(api.floors.create, {
      name: 'Launch',
      brief: 'Prepare the launch.',
      employeeIds: [],
    });

    const { employeeIds } = await owner.mutation(api.marketplace.hire, {
      listingId,
      floorId,
      count: 2,
      names: ['Ada', 'Grace'],
      overnightModel: 'gpt-5.6-luna',
    });
    const dashboard = await owner.query(api.workspace.dashboard, {});
    expect(dashboard.employees.map((employee) => employee.name)).toEqual(['Ada', 'Grace']);

    const status = await owner.query(api.marketplace.instanceStatus, {});
    expect(status).toHaveLength(2);
    expect(status[0]).toMatchObject({
      employeeId: employeeIds[0],
      overnightModel: 'gpt-5.6-luna',
      shift: { state: 'off' },
      shiftsToday: 0,
      tokensToday: 0,
    });

    await expect(
      owner.mutation(api.marketplace.hire, { listingId, floorId, names: ['Grace'] }),
    ).rejects.toThrow('already called Grace');
    await expect(
      owner.mutation(api.marketplace.hire, { listingId, floorId, count: 2, names: ['Hopper'] }),
    ).rejects.toThrow('one name per instance');

    await owner.mutation(api.marketplace.setOvernightModel, { employeeId: employeeIds[0] });
    expect((await owner.query(api.marketplace.instanceStatus, {}))[0].overnightModel).toBeUndefined();
  });

  it('previews an upgrade before it happens and lists every published version', async () => {
    const t = harness();
    const { owner, draftId, listingId } = await marketplace(t);
    const { employeeId } = await hireOne(owner, listingId);
    expect(await owner.query(api.marketplace.instanceUpgrade, { employeeId })).toBeNull();

    await publishVersion(t, { draftId, description: 'Reviews work and writes the weekly update.' });
    expect(await owner.query(api.marketplace.instanceUpgrade, { employeeId })).toMatchObject({
      fromVersion: 1,
      toVersion: 2,
      changed: ['description'],
    });

    const versions = await owner.query(api.marketplace.listingVersions, { listingId });
    expect(versions.map((version) => version.version)).toEqual([2, 1]);
    expect(versions[0].changed).toEqual(['description']);
    // Nothing came before the first version, so all of it is new.
    expect(versions[1].changed).toContain('instructions');

    // The preview named what the upgrade then reports, and nothing is left to upgrade after it.
    expect(await owner.mutation(api.marketplace.upgrade, { employeeId })).toEqual({
      version: 2,
      changed: ['description'],
    });
    expect(await owner.query(api.marketplace.instanceUpgrade, { employeeId })).toBeNull();
  });

  it('projects capacity against workers only, as the hiring cap counts them', async () => {
    const t = harness();
    const { owner, listingId } = await marketplace(t);
    const { workspaceId } = await owner.mutation(api.workspace.bootstrap, { name: 'Acme' });
    await saveSettings(owner, { maxConcurrentInstances: 4 });
    await owner.mutation(api.marketplace.hire, { listingId, count: 2 });
    await t.run(async (ctx) =>
      ensureReservedInstance(ctx, workspaceId, 'janitor', 'The janitor', {
        voice: 'Terse.',
        traits: ['terse'],
      }),
    );

    const projection = await owner.query(api.plan.projection, { projectedTokens: 0 });
    expect(projection.capacity).toMatchObject({ instances: 2, maxConcurrentInstances: 4 });
    // The cap agrees: two more workers fit, and the janitor does not take one of those places.
    await owner.mutation(api.marketplace.hire, { listingId, count: 2 });
    expect((await owner.query(api.plan.projection, { projectedTokens: 0 })).capacity.instances).toBe(4);
  });
});
