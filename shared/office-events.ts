import { z } from 'zod';
import type { AppState, CloudSession, Employee, OfficeFrame } from './types';
import { MEMORY_KINDS, MEMORY_SCOPES, type MemoryKind, type MemoryScope } from './agent-config';

export const OFFICE_EVENT_KINDS = [
  'session.started',
  'session.status',
  'session.completed',
  'session.failed',
  'session.cancelled',
  'tool.started',
  'tool.completed',
  'tool.failed',
  'reasoning.summary',
  'message.queued',
  'message.delivered',
  'message.acknowledged',
  'artifact.created',
  'memory.proposed',
  'memory.saved',
  'memory.updated',
  'memory.forgotten',
  'approval.requested',
  'approval.decided',
  'employee.configured',
  'checkpoint.saved',
  'system',
] as const;
export type OfficeEventKind = (typeof OFFICE_EVENT_KINDS)[number];
export interface OfficeEventInput {
  id: string;
  kind: OfficeEventKind;
  summary: string;
  source: 'user' | 'provider' | 'tool' | 'system';
  occurredAt?: string;
  employeeId?: string;
  sessionId?: string;
  targetEmployeeId?: string;
  toolName?: string;
  messageId?: string;
  artifactId?: string;
  memoryId?: string;
  memoryKind?: MemoryKind;
  memoryScope?: MemoryScope;
  targetSessionId?: string;
  toolCallId?: string;
  inputHash?: string;
  resultHash?: string;
  contentHash?: string;
  status?: CloudSession['status'];
  location?: Employee['location'];
  configRevision?: number;
  responseId?: string;
  runId?: string;
  checkpointId?: number;
  checkpointHash?: string;
}
export interface OfficeEvent extends OfficeEventInput {
  version: 1;
  sequence: number;
  occurredAt: string;
  recordedAt: string;
  previousHash: string | null;
  hash: string;
}
const identifier = z.string().min(1).max(500);
export const OfficeEventInputSchema = z.strictObject({
  id: identifier,
  kind: z.enum(OFFICE_EVENT_KINDS),
  summary: z.string().min(1).max(12000),
  source: z.enum(['user', 'provider', 'tool', 'system']),
  occurredAt: z.string().datetime().optional(),
  employeeId: identifier.optional(),
  sessionId: identifier.optional(),
  targetEmployeeId: identifier.optional(),
  toolName: identifier.optional(),
  messageId: identifier.optional(),
  artifactId: identifier.optional(),
  memoryId: identifier.optional(),
  memoryKind: z.enum(MEMORY_KINDS).optional(),
  memoryScope: z.enum(MEMORY_SCOPES).optional(),
  targetSessionId: identifier.optional(),
  toolCallId: identifier.optional(),
  inputHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  resultHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  contentHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  status: z
    .enum(['queued', 'running', 'waiting_for_approval', 'completed', 'failed', 'cancelled'])
    .optional(),
  location: z.enum(['desk', 'library', 'meeting', 'board']).optional(),
  configRevision: z.number().int().positive().optional(),
  responseId: identifier.optional(),
  runId: identifier.optional(),
  checkpointId: z.number().int().positive().optional(),
  checkpointHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
});
export interface OfficeRange {
  firstAt: number | null;
  lastAt: number | null;
  count: number;
}
export interface OfficeRecordingBounds {
  firstAt: number | null;
  lastAt: number | null;
  checkpoints: OfficeRange;
  frames: OfficeRange;
  events: OfficeRange;
}
export interface OfficeCheckpointRecord {
  version: 1;
  id: number;
  time: number;
  reason: string;
  state: AppState;
  recordedAt: string | null;
  stateHash: string | null;
  previousHash: string | null;
  hash: string | null;
}
export interface OfficeFrameRecord {
  version: 1;
  sequence: number | null;
  frame: OfficeFrame;
  recordedAt: string | null;
  previousHash: string | null;
  hash: string | null;
}
export interface OfficeAuditVerification {
  verified: boolean;
  integrityScope: 'local-hash-consistency';
  ledger: { count: number; headHash: string | null; valid: boolean };
  checkpoints: { verified: number; legacy: number; invalid: number };
  frames: { verified: number; legacy: number; invalid: number };
  issues: string[];
  legacyUnverified: boolean;
}
export interface OfficeAuditExport {
  version: 1;
  algorithm: 'SHA-256';
  createdAt: string;
  recordingStartedAt: string;
  ledger: OfficeEvent[];
  checkpoints: OfficeCheckpointRecord[];
  frames: OfficeFrameRecord[];
  legacyActivityCount: number;
  anchor: {
    ledgerCount: number;
    ledgerHeadHash: string | null;
    frameCount: number;
    frameHeadHash: string | null;
    checkpointCount: number;
    checkpointHeadHash: string | null;
  };
  verification: OfficeAuditVerification;
}
export interface OfficeReplayBundle {
  requestedAt: number;
  state: AppState | null;
  checkpoint: { id: number; time: number; reason: string; hash: string | null; verified: boolean } | null;
  frame: OfficeFrame | null;
  events: OfficeEvent[];
  bounds: OfficeRecordingBounds;
  coverage: {
    status: 'verified' | 'partial' | 'unavailable';
    from: number | null;
    through: number | null;
    gaps: string[];
    legacyUnverified: boolean;
    eventsTruncated: boolean;
  };
  audit: OfficeAuditVerification;
}
