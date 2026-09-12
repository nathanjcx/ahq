import type { TokenUsage } from './core';

export type MeetingStatus = 'preparing' | 'ready' | 'live' | 'closing' | 'closed';
export type MeetingTurnKind = 'report' | 'question' | 'answer' | 'outcome';
export type OutcomeKind = 'task' | 'deadline' | 'meeting' | 'note';

export interface MeetingTurn {
  id: string;
  kind: MeetingTurnKind;
  authorName: string;
  authorSubject?: string;
  employeeId?: string;
  addressedTo?: string[];
  inReplyTo?: string;
  text: string;
  /**
   * Tokens this turn cost. Set per turn once the runtime records it there; until then the meeting
   * carries the only total and a turn shows no price of its own.
   */
  usage?: TokenUsage;
  outcome?: { kind: OutcomeKind; payload: string; status: 'proposed' | 'confirmed' | 'dismissed' };
  createdAt: number;
}
export interface Meeting {
  id: string;
  calendarEntryId: string;
  status: MeetingStatus;
  openedBy?: string;
  openedAt?: number;
  closedAt?: number;
  usage?: TokenUsage;
  turns: MeetingTurn[];
}
