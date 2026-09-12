import type { FunctionReturnType } from 'convex/server';
import { expectTypeOf, test } from 'vitest';
import { type api } from '../convex/_generated/api';
import type { AuditResponse } from '../lib/api/schemas';
import type {
  AuditTimeline,
  Dashboard,
  Listing,
  Message,
  FloorPost,
  ProviderConfig,
  ProviderReadiness,
  RegistryTool,
} from '../lib/contracts';

/**
 * lib/contracts.ts is the shape the interface renders. These assertions fail the build the moment a
 * Convex function stops producing it, so drift is caught at compile time rather than in the browser.
 * Convex returns branded `Id` values where the contracts say `string`; an `Id` is a string subtype,
 * so it satisfies the contract while the interface keeps treating ids as opaque.
 */
test('every Convex query the interface reads satisfies its UI contract', () => {
  expectTypeOf<FunctionReturnType<typeof api.workspace.dashboard>>().toExtend<Dashboard>();
  expectTypeOf<FunctionReturnType<typeof api.marketplace.list>>().toExtend<Listing[]>();
  expectTypeOf<FunctionReturnType<typeof api.floors.board>>().toExtend<FloorPost[]>();
  expectTypeOf<FunctionReturnType<typeof api.integrations.readiness>>().toExtend<ProviderReadiness[]>();
  expectTypeOf<FunctionReturnType<typeof api.admin.providerConfigs>>().toExtend<ProviderConfig[]>();
  expectTypeOf<FunctionReturnType<typeof api.admin.registryTools>>().toExtend<RegistryTool[]>();
  expectTypeOf<FunctionReturnType<typeof api.tasks.messages>>().toExtend<Message[]>();
});

/** The audit route unseals the Convex journal into the contract shape, plus its truncation flag. */
test('the audit route response satisfies the audit timeline contract', () => {
  expectTypeOf<Omit<AuditResponse, 'truncated'>>().toExtend<AuditTimeline>();
});
