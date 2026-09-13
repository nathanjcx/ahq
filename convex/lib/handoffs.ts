import type { Doc } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { canSeeTask, untrustedBlock } from '../shared';
import { channelFor, insertPost } from './posts';
import { assertEmployeeReady, assertTokenCap, finalAssistantMessage, startTask } from './tasks';

/**
 * Accepting a handoff starts a floor task for the employee it names, carrying the source task's final
 * message. A person accepts from the board; a floor whose policy is `auto` accepts the moment an
 * employee requests one, in the name of the person who owns the source task. Both come through here.
 */
export async function acceptHandoff(
  ctx: MutationCtx,
  workspace: Doc<'workspaces'>,
  post: Doc<'posts'> & { handoff: NonNullable<Doc<'posts'>['handoff']> },
  floor: Doc<'floors'>,
  actor: { subject: string; name: string },
) {
  const now = Date.now();
  if (!floor.employeeIds.includes(post.handoff.toEmployeeId))
    throw new Error('Employee is not assigned to this floor');
  await assertTokenCap(ctx, workspace);
  const { version } = await assertEmployeeReady(ctx, workspace, actor.subject, post.handoff.toEmployeeId);
  // A handoff a person wrote is an instruction. One an agent requested through the floor tools has
  // no author subject, and it is the previous employee's words, so it is delimited as material.
  let prompt = post.authorSubject ? post.handoff.brief : untrustedBlock(post.handoff.brief);
  // The carried context is another employee's output. It travels only to someone who could already
  // read the source task, and it is delimited so this employee treats it as material, not orders.
  const source = post.taskId ? await ctx.db.get(post.taskId) : null;
  if (source && canSeeTask(source, actor.subject)) {
    const closing = await finalAssistantMessage(ctx, source._id);
    if (closing)
      prompt = `${prompt}\n\nContext carried from ${source.title}:\n${untrustedBlock(
        closing.slice(0, 20_000),
      )}`;
  }
  const taskId = await startTask(ctx, {
    workspace,
    createdBy: actor.subject,
    createdByName: actor.name,
    employeeId: post.handoff.toEmployeeId,
    version,
    title: post.handoff.brief.slice(0, 200),
    prompt,
    floor: { floorId: floor._id, floorContext: { name: floor.name, brief: floor.brief } },
    sourceTaskId: post.taskId,
  });
  await ctx.db.patch(post._id, {
    handoff: { ...post.handoff, status: 'accepted', decidedBy: actor.subject, decidedAt: now, taskId },
  });
  await insertPost(ctx, {
    channel: await channelFor(ctx, workspace._id, 'floor', floor._id),
    kind: 'system',
    authorEmployeeId: post.handoff.toEmployeeId,
    authorName: version.name,
    text: 'Accepted handoff → task created',
    taskId,
  });
  return taskId;
}
