import type { BoardPost, Snapshot } from '../src/shared/types';

// Scripted atmosphere only. These messages never enter intake or model prompts.
const conversations = [
  ['Has anyone seen the blue mug?', 'Next to the printer. It has become a pen holder.'],
  ['Coffee run. Does anyone want anything?', 'Tea, please. The kettle and I are taking a break.'],
  ['The plant by the window has a new leaf.', 'Finally, a growth metric I can explain.'],
  ['Who moved my chair down?', 'Check the lever. Mine slowly sinks during meetings.'],
  ['There are biscuits in the kitchen.', 'Leaving this here as my official acknowledgment.'],
  ['The printer made that noise again.', 'It is expressing an opinion about the paper tray.'],
  ['Window open or closed?', 'Open a little. The afternoon sun is winning.'],
  ['I found three identical charging cables.', 'And somehow none of them is mine.'],
  ['Lunch outside today?', 'Yes. Saving a spot away from the pigeons.'],
  ['Someone left a tiny drawing on the whiteboard.', 'Please leave the duck. It helps morale.'],
  ['Desk tidy complete. It will last about ten minutes.', 'That is nine more than my personal best.'],
  ['Quiet in here. Everyone doing okay?', 'All good. Just enjoying a moment without notifications.'],
];

function append(state: Snapshot, post: Omit<BoardPost, 'kind' | 'simulated'>): void {
  state.board.push({ ...post, kind: 'chatter', simulated: true });
  const chatter = state.board.filter(item => item.simulated && item.kind === 'chatter');
  const expired = new Set(chatter.slice(0, -60).map(item => item.id));
  state.board = state.board.filter(item => !expired.has(item.id));
}

export function advanceBoardChatter(state: Snapshot, now: number): boolean {
  const residents = state.agents.filter(agent => !agent.temporary && !agent.retiredAt);
  if (residents.length < 2) return false;
  const recent = [...state.board].reverse().find(post => post.kind === 'chatter');
  if (recent && now - recent.timestamp < 8_000) return false;

  const update = [...state.board].reverse().find(post =>
    !post.simulated && post.kind === 'complete' && post.artifactId
    && now - post.timestamp >= 5_000 && now - post.timestamp < 120_000
    && !state.board.some(reply => reply.id === `reaction-${post.id}`));
  if (update) {
    const colleague = residents.find(agent => agent.id !== update.agentId)!;
    const author = state.agents.find(agent => agent.id === update.agentId)?.name.split(' ')[0] || 'The team';
    const artifact = state.artifacts.find(item => item.id === update.artifactId);
    if (artifact) {
      append(state, { id: `reaction-${update.id}`, agentId: colleague.id, workId: update.workId,
        artifactId: artifact.id, replyTo: update.id, timestamp: now,
        text: `${author} just posted ${artifact.title}. ${{ report: 'Something to read with the next coffee. Leaving the link here.', brief: 'The meeting reading has arrived. Bookmarking this one.', patch: 'Patch is on the board. The QA handoff can take it from here.', qa: 'The QA write-up is here. Check the actual results in the link.', calendar: 'A little less calendar juggling. The details are in the link.' }[artifact.kind]}` });
      return true;
    }
  }

  const idle = residents.filter(agent => agent.activity === 'idle');
  if (idle.length < 2) return false;
  const slot = Math.floor(now / 45_000);
  const index = slot % conversations.length;
  const opening = [...state.board].reverse().find(post => /^chatter-\d+$/.test(post.id)
    && now - post.timestamp < 90_000 && !state.board.some(reply => reply.id === `${post.id}-reply`));
  if (opening) {
    const colleague = idle.find(agent => agent.id !== opening.agentId);
    if (!colleague) return false;
    append(state, { id: `${opening.id}-reply`, agentId: colleague.id, replyTo: opening.id,
      text: conversations[Number(opening.id.slice('chatter-'.length)) % conversations.length][1], timestamp: now });
  } else {
    if (state.board.some(post => post.id === `chatter-${slot}`) || (recent && now - recent.timestamp < 30_000)) return false;
    append(state, { id: `chatter-${slot}`, agentId: idle[index % idle.length].id,
      text: conversations[index][0], timestamp: now });
  }
  return true;
}
