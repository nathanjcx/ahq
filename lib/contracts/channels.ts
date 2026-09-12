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
/** What a post is beyond its kind, when its text would otherwise have to be parsed to know. */
export type PostFlag = 'contested' | 'incident' | 'missing';

export interface Post {
  id: string;
  channelId: string;
  kind: PostKind;
  flag?: PostFlag;
  authorName: string;
  authorSubject?: string;
  authorEmployeeId?: string;
  text: string;
  taskId?: string;
  /** The instance this post is addressed to, and the task accepting it started. */
  toEmployeeId?: string;
  acceptedTaskId?: string;
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
