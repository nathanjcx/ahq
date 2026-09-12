import { api } from '@/convex/_generated/api';

/** Convex references for the audit domain, under the names the UI uses. */
export const auditApi = {
  auditFindings: api.audit.findings,
  auditDocuments: api.audit.documents,
  markFindingAddressed: api.audit.markAddressed,
  escalateFinding: api.audit.escalate,
} as const;
