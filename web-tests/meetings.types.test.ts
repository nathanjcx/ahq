import type { FunctionReturnType } from 'convex/server';
import { expectTypeOf, test } from 'vitest';
import { type api } from '../convex/_generated/api';
import type { AuditDocument, AuditFinding, Meeting } from '../lib/contracts';

/**
 * The boardroom and the audit pages render the contract shapes. These assertions fail the build the
 * moment a Convex function stops producing them.
 */
test('the meeting and audit queries satisfy their UI contracts', () => {
  expectTypeOf<FunctionReturnType<typeof api.meetings.get>>().toExtend<Meeting | null>();
  expectTypeOf<FunctionReturnType<typeof api.audit.findings>>().toExtend<AuditFinding[]>();
  expectTypeOf<FunctionReturnType<typeof api.audit.documents>>().toExtend<AuditDocument[]>();
});
