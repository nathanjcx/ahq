import type { ReplayEntry, SourceItem } from './types';

const archiveActions = [
  'CONTEXT - PROJECT SCOPE', 'CONTEXT - WEEKLY METRICS', 'CONTEXT - NAMED OWNERS',
  'CONTEXT - RECONCILED BUDGET', 'CONTEXT - ACCEPTED DECISIONS', 'IGNORE - RELEASE ALREADY SIGNED OFF',
  'CONTEXT - PREVIOUS MEETING AGENDA', 'CONTEXT - EVIDENCE INDEX',
];

export function messageDemoAction(item: SourceItem, entries: ReplayEntry[] = []): string | undefined {
  const arrival = entries.find(entry => entry.item?.id === item.id);
  if (arrival) return arrival.label.match(/^\[ACTION: [^\]]+\]/)?.[0];
  const archive = item.id.match(/^history-[a-z]+-(\d{2})$/);
  const action = archive && archiveActions[Number(archive[1]) - 1];
  return action ? `[ACTION: ${action}]` : undefined;
}
