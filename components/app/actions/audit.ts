'use client';

import { useMutation } from 'convex/react';
import { asId, uiApi } from '@/lib/ui-api';

export type AuditActions = {
  /** Records that a finding has been dealt with. The next night's audit verifies it or reopens it. */
  markFindingAddressed: (findingId: string) => Promise<unknown>;
  /** Puts an ignored finding in the workspace channel and on the next meeting's agenda. */
  escalateFinding: (findingId: string) => Promise<unknown>;
};

const unavailable = async () => undefined;

export const offlineAuditActions: AuditActions = {
  markFindingAddressed: unavailable,
  escalateFinding: unavailable,
};

export function useAuditActions(): AuditActions {
  const markAddressed = useMutation(uiApi.markFindingAddressed);
  const escalate = useMutation(uiApi.escalateFinding);

  return {
    markFindingAddressed: (findingId) => markAddressed({ id: asId(findingId) }),
    escalateFinding: (findingId) => escalate({ id: asId(findingId) }),
  };
}
