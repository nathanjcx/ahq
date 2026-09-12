import { describe, expect, it } from 'vitest';
import { api } from '../convex/_generated/api';
import {
  harness,
  hireOne,
  identity as orgIdentity,
  linearWorkspace,
  publishEmployee,
  secret,
} from './support';

async function workspace() {
  const t = harness();
  await linearWorkspace(t);
  const { listingId } = await publishEmployee(t);
  const user = t.withIdentity(orgIdentity('owner', 'acme'));
  await user.mutation(api.workspace.bootstrap, { name: 'Acme' });
  const { employeeId } = await hireOne(user, listingId);
  return { t, user, employeeId };
}

describe('channels', () => {
  it('creates a floor channel on first use and tracks unread per viewer', async () => {
    const { t, user, employeeId } = await workspace();
    const colleague = t.withIdentity(orgIdentity('colleague', 'acme'));
    const outsider = t.withIdentity(orgIdentity('outsider', 'other'));
    await outsider.mutation(api.workspace.bootstrap, { name: 'Other' });
    const { floorId } = await user.mutation(api.floors.create, {
      name: 'Launch',
      brief: 'Prepare the launch.',
      employeeIds: [employeeId],
    });

    // Nothing has been posted, so the floor has no channel yet; opening it creates one.
    expect(await user.query(api.channels.list, {})).toEqual([]);
    const { channelId } = await user.mutation(api.channels.open, { kind: 'floor', scopeId: floorId });
    expect(await user.query(api.channels.list, {})).toEqual([
      { id: channelId, kind: 'floor', scopeId: floorId, name: 'Launch', unread: 0 },
    ]);
    expect(await user.mutation(api.channels.open, { kind: 'floor', scopeId: floorId })).toEqual({
      channelId,
    });

    await user.mutation(api.channels.post, { channelId, text: 'Kick-off is Monday.', kind: 'note' });
    await user.mutation(api.channels.post, { channelId, text: 'Ship on Friday.', kind: 'decision' });
    // Your own posts are never unread to you; a colleague sees both.
    expect((await user.query(api.channels.list, {}))[0].unread).toBe(0);
    expect((await colleague.query(api.channels.list, {}))[0].unread).toBe(2);
    await colleague.mutation(api.channels.markRead, { channelId });
    expect((await colleague.query(api.channels.list, {}))[0].unread).toBe(0);

    const posts = await colleague.query(api.channels.posts, { channelId });
    expect(posts.map((post) => [post.kind, post.text])).toEqual([
      ['note', 'Kick-off is Monday.'],
      ['decision', 'Ship on Friday.'],
    ]);
    expect(await colleague.query(api.channels.posts, { channelId, before: posts[1].createdAt })).toEqual(
      posts.slice(0, 1),
    );

    // The channel renames with its floor, and another workspace cannot reach it at all.
    await user.mutation(api.floors.update, {
      floorId,
      name: 'Product launch',
      brief: 'Prepare the product launch.',
      employeeIds: [employeeId],
    });
    expect((await user.query(api.channels.list, {}))[0].name).toBe('Product launch');
    expect(await outsider.query(api.channels.list, {})).toEqual([]);
    await expect(outsider.query(api.channels.posts, { channelId })).rejects.toThrow('Channel not found');
    await expect(outsider.mutation(api.channels.open, { kind: 'floor', scopeId: floorId })).rejects.toThrow(
      'Floor not found',
    );
    await expect(user.mutation(api.channels.open, { kind: 'workspace', scopeId: floorId })).rejects.toThrow(
      'covers the whole workspace',
    );
  });

  it('feeds an instance its own posts and turns an addressed note into a task', async () => {
    const { t, user, employeeId } = await workspace();
    const { floorId } = await user.mutation(api.floors.create, {
      name: 'Launch',
      brief: 'Prepare the launch.',
      employeeIds: [employeeId],
    });
    const { taskId } = await user.mutation(api.tasks.create, {
      floorId,
      employeeId,
      title: 'Analyse the launch',
      prompt: 'Analyse it.',
    });
    const { runToken } = await t.query(api.services.sessions.taskContext, { secret, taskId });
    await t.mutation(api.services.channels.postFromAgent, {
      secret,
      runToken,
      text: 'The pricing page is stale.',
    });

    // The feed is everything this instance posted anywhere: its start notice and its own note.
    expect((await user.query(api.channels.employeeFeed, { employeeId })).map((post) => post.text)).toEqual([
      'Operations analyst started: Analyse the launch',
      'The pricing page is stale.',
    ]);

    const { channelId } = await user.mutation(api.channels.open, { kind: 'floor', scopeId: floorId });
    const { postId } = await user.mutation(api.channels.post, {
      channelId,
      text: 'Refresh the pricing page.',
      kind: 'note',
      toEmployeeId: employeeId,
    });
    const { taskId: accepted } = await user.mutation(api.channels.acceptAddressed, { postId });
    // Accepting twice is the same task, and a person's words are instructions, not material.
    expect(await user.mutation(api.channels.acceptAddressed, { postId })).toEqual({ taskId: accepted });
    expect(await t.run((ctx) => ctx.db.get(accepted))).toMatchObject({
      employeeId,
      floorId,
      prompt: 'Refresh the pricing page.',
      title: 'Refresh the pricing page.',
    });
  });

  it('shows an agent its floor and workspace channels, and posts one report once', async () => {
    const { t, user, employeeId } = await workspace();
    const { floorId } = await user.mutation(api.floors.create, {
      name: 'Launch',
      brief: 'Prepare the launch.',
      employeeIds: [employeeId],
    });
    const { taskId } = await user.mutation(api.tasks.create, {
      floorId,
      employeeId,
      title: 'Analyse the launch',
      prompt: 'Analyse it.',
    });
    const { runToken } = await t.query(api.services.sessions.taskContext, { secret, taskId });
    const { channelId: workspaceChannel } = await user.mutation(api.channels.open, {
      kind: 'workspace',
      scopeId: '',
    });
    await user.mutation(api.channels.post, {
      channelId: workspaceChannel,
      text: 'Payroll runs Thursday.',
      kind: 'note',
    });

    const board = await t.query(api.services.channels.readBoard, { secret, runToken });
    expect(board.map((row) => row.channel.kind)).toEqual(['floor', 'workspace']);
    expect(board[0].posts.map((post) => post.text)).toEqual([
      'Operations analyst started: Analyse the launch',
    ]);
    expect(board[1].posts.map((post) => post.text)).toEqual(['Payroll runs Thursday.']);

    const reportId = await t.run(async (ctx) => {
      const task = await ctx.db.get(taskId);
      if (!task) throw new Error('Expected task');
      return ctx.db.insert('reports', {
        workspaceId: task.workspaceId,
        taskId,
        employeeId,
        done: ['Read the pricing page'],
        inProgress: [],
        blockedOn: ['Copy review'],
        next: ['Draft the note'],
        risks: [],
        inferred: false,
        createdAt: Date.now(),
      });
    });
    const first = await t.mutation(api.services.channels.postReport, { secret, taskId, reportId });
    expect(await t.mutation(api.services.channels.postReport, { secret, taskId, reportId })).toEqual(first);
    const { channelId } = await user.mutation(api.channels.open, { kind: 'floor', scopeId: floorId });
    const reports = (await user.query(api.channels.posts, { channelId })).filter(
      (post) => post.kind === 'report',
    );
    expect(reports).toHaveLength(1);
    expect(reports[0].text).toContain('Done: Read the pricing page');
    expect(reports[0].text).toContain('Blocked on: Copy review');
  });
});
