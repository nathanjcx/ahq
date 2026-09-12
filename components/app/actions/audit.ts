'use client';

/** Audit actions. Filled by the audit UI workstream: type, offline stubs, and the hook, kept in step. */
export type AuditActions = Record<never, never>;

export const offlineAuditActions: AuditActions = {};

export function useAuditActions(): AuditActions {
  return {};
}
