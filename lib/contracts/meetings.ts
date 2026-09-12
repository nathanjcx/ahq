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
