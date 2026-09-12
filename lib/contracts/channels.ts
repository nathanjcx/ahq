export type ChannelKind = 'floor' | 'project' | 'workspace' | 'triage' | 'audit';
export type PostKind =
  'note' | 'report' | 'feedback' | 'alert' | 'finding' | 'decision' | 'handoff' | 'system';

export interface Channel {
  id: string;
  kind: ChannelKind;
  scopeId: string;
  name: string;
  unread: number;
}
export interface Post {
  id: string;
  channelId: string;
  kind: PostKind;
  authorName: string;
  authorSubject?: string;
  authorEmployeeId?: string;
  text: string;
  taskId?: string;
  toEmployeeId?: string;
  handoff?: {
    toEmployeeId: string;
    toEmployeeName: string;
    brief: string;
    status: 'pending' | 'accepted' | 'declined';
    taskId?: string;
    decidedBy?: string;
    decidedAt?: number;
  };
  createdAt: number;
}
