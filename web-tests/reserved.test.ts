import { describe, expect, it } from 'vitest';
import { api } from '../convex/_generated/api';
import { ensureReservedInstance, type ReservedKind } from '../convex/lib/reserved';
import { harness, identity as orgIdentity, publishEmployee } from './support';

const kinds: ReservedKind[] = ['janitor', 'auditor', 'triage'];

describe('reserved employees', () => {
  it('makes one instance per kind per workspace, whatever asks for it', async () => {
    const t = harness();
    const owner = t.withIdentity(orgIdentity('owner', 'acme', 'org:admin'));
    const { workspaceId } = await owner.mutation(api.workspace.bootstrap, { name: 'Acme' });
    const other = t.withIdentity(orgIdentity('other', 'globex', 'org:admin'));
    const second = await other.mutation(api.workspace.bootstrap, { name: 'Globex' });

    const ensure = (id: typeof workspaceId, kind: ReservedKind) =>
      t.run(async (ctx) => {
        const { installation, version } = await ensureReservedInstance(ctx, id, kind, `The ${kind}`, {
          voice: 'Terse.',
          traits: ['terse'],
        });
        return { employeeId: installation._id, versionId: version._id, name: installation.name };
      });

    const first = await Promise.all(kinds.map((kind) => ensure(workspaceId, kind)));
    const again = await Promise.all(kinds.map((kind) => ensure(workspaceId, kind)));
    expect(again).toEqual(first);
    // Each kind has its own version, and another workspace gets its own instances.
    expect(new Set(first.map((one) => one.versionId)).size).toBe(3);
    const elsewhere = await ensure(second.workspaceId, 'janitor');
    expect(elsewhere.employeeId).not.toBe(first[0].employeeId);

    const versions = await t.run(async (ctx) => ctx.db.query('employeeVersions').collect());
    expect(versions).toHaveLength(4);
    expect(versions.every((one) => one.category === 'Reserved' && one.publishedBy === 'system')).toBe(true);
    expect(versions.every((one) => one.capabilities.length === 0)).toBe(true);
  });

  it('keeps reserved versions out of the marketplace', async () => {
    const t = harness();
    const { versionId } = await publishEmployee(t);
    const owner = t.withIdentity(orgIdentity('owner', 'acme', 'org:admin'));
    const { workspaceId } = await owner.mutation(api.workspace.bootstrap, { name: 'Acme' });
    for (const kind of kinds)
      await t.run(async (ctx) =>
        ensureReservedInstance(ctx, workspaceId, kind, `The ${kind}`, { voice: 'Terse.', traits: ['terse'] }),
      );
    expect((await owner.query(api.marketplace.list, {})).map((listing) => listing.versionId)).toEqual([
      versionId,
    ]);
  });
});
