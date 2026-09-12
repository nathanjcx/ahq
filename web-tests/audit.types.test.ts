import type { FunctionReturnType } from 'convex/server';
import { expectTypeOf, test } from 'vitest';
import { type api } from '../convex/_generated/api';
import type { AuditDocument, AuditFinding, WorkspaceSettings } from '../lib/contracts';

/** The Audit page and the Settings panel render these, so the Convex functions are asserted here. */
test('the audit and settings queries satisfy the contracts the interface renders', () => {
  expectTypeOf<FunctionReturnType<typeof api.audit.findings>>().toExtend<AuditFinding[]>();
  expectTypeOf<FunctionReturnType<typeof api.audit.documents>>().toExtend<AuditDocument[]>();
  expectTypeOf<FunctionReturnType<typeof api.schedule.settings>>().toExtend<WorkspaceSettings>();
});
