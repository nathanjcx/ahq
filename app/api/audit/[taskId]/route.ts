import { NextResponse } from 'next/server';
import { actor, failure } from '@/lib/server/http';
import { query } from '@/lib/server/backend';
import { unseal } from '@/lib/server/secrets';
import type { AuditEntry, AuditTimeline, CorrectionKind, ProviderId } from '@/lib/contracts';
export const runtime = 'nodejs';

interface SealedTimeline {
  task: AuditTimeline['task'];
  events: { id: string; at: number; type: string; text: string; gap?: boolean }[];
  messages: { id: string; at: number; role: 'user' | 'assistant' | 'system'; text: string; phase?: string }[];
  toolCalls: {
    id: string;
    at: number;
    operationId: string;
    connectionId: string;
    provider: ProviderId;
    tool: string;
    outcome: 'started' | 'succeeded' | 'failed' | 'denied';
    reason?: string;
    durationMs?: number;
    argumentsCiphertext: string;
    resultCiphertext?: string;
    sha256?: string;
    proposalId?: string;
  }[];
  proposals: {
    id: string;
    at: number;
    tool: string;
    provider: ProviderId;
    summary: string;
    status: Extract<AuditEntry, { kind: 'proposal' }>['status'];
    correction: CorrectionKind;
    arguments: string;
    beforeState?: string;
    afterState?: string;
    transitions: { from?: string; to: string; actor: string; at: number; detail?: string }[];
  }[];
}

function parse(value?: string) {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function open(ciphertext?: string) {
  if (!ciphertext) return undefined;
  try {
    return unseal<unknown>(ciphertext);
  } catch {
    return { unavailable: 'This entry could not be decrypted with the current key.' };
  }
}

/** Unseals the journal for a viewer who can see the task. Unsealed content is never logged. */
export async function GET(_request: Request, { params }: { params: Promise<{ taskId: string }> }) {
  try {
    const identity = await actor();
    const { taskId } = await params;
    const sealed = await query<SealedTimeline>('services/actions:auditTimeline', { ...identity, taskId });
    const entries: AuditEntry[] = [
      ...sealed.events.map((event): AuditEntry => ({
        kind: 'event',
        id: event.id,
        at: event.at,
        type: event.type,
        text: event.text,
        gap: event.gap,
      })),
      ...sealed.messages.map((message): AuditEntry => ({
        kind: 'message',
        id: message.id,
        at: message.at,
        role: message.role,
        text: message.text,
        phase: message.phase,
      })),
      ...sealed.toolCalls.map((call): AuditEntry => ({
        kind: 'tool_call',
        id: call.id,
        at: call.at,
        operationId: call.operationId,
        connectionId: call.connectionId,
        provider: call.provider,
        tool: call.tool,
        outcome: call.outcome,
        reason: call.reason,
        durationMs: call.durationMs,
        arguments: open(call.argumentsCiphertext),
        result: open(call.resultCiphertext),
        resultSha256: call.sha256,
        proposalId: call.proposalId,
      })),
      ...sealed.proposals.map((proposal): AuditEntry => ({
        kind: 'proposal',
        id: proposal.id,
        at: proposal.at,
        tool: proposal.tool,
        provider: proposal.provider,
        summary: proposal.summary,
        status: proposal.status,
        correction: proposal.correction,
        arguments: parse(proposal.arguments),
        beforeState: parse(proposal.beforeState),
        afterState: parse(proposal.afterState),
        transitions: proposal.transitions,
      })),
    ].sort((a, b) => a.at - b.at);
    const timeline: AuditTimeline = { task: sealed.task, entries };
    return NextResponse.json(timeline, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return failure(error);
  }
}
