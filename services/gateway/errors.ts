import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { safeError } from '../../lib/server/secrets';

/**
 * The gateway failure taxonomy from docs/architecture.md. The first six reasons are the documented
 * agent-visible contract; the last three are request rejections the gateway makes before any policy
 * or provider is involved, and they reuse the reserved JSON-RPC codes.
 */
export type GatewayReason =
  | 'unauthorized'
  | 'revoked'
  | 'policy_denied'
  | 'provider_error'
  | 'approval_required'
  | 'provider_timeout'
  | 'malformed_request'
  | 'request_too_large'
  | 'invalid_arguments';

const failures: Record<GatewayReason, { code: number; status: number; retryable: boolean }> = {
  unauthorized: { code: -32001, status: 401, retryable: false },
  revoked: { code: -32002, status: 403, retryable: false },
  policy_denied: { code: -32003, status: 403, retryable: false },
  provider_error: { code: -32004, status: 502, retryable: true },
  approval_required: { code: -32005, status: 200, retryable: false },
  provider_timeout: { code: -32006, status: 504, retryable: true },
  malformed_request: { code: -32700, status: 400, retryable: false },
  request_too_large: { code: -32600, status: 413, retryable: false },
  invalid_arguments: { code: -32602, status: 400, retryable: false },
};

export class GatewayError extends Error {
  constructor(
    readonly reason: GatewayReason,
    message: string,
  ) {
    super(message);
    this.name = 'GatewayError';
  }
  get code() {
    return failures[this.reason].code;
  }
  get status() {
    return failures[this.reason].status;
  }
  get retryable() {
    return failures[this.reason].retryable;
  }
}

/** An upstream MCP failure is a timeout or a provider error; nothing else is inferable from it. */
export function upstreamFailure(error: unknown, message: string): GatewayError {
  const timedOut =
    (error instanceof McpError && error.code === ErrorCode.RequestTimeout) ||
    (error instanceof Error && error.name === 'TimeoutError');
  return new GatewayError(timedOut ? 'provider_timeout' : 'provider_error', message);
}

function asGatewayError(error: unknown): GatewayError {
  return error instanceof GatewayError
    ? error
    : new GatewayError('provider_error', safeError(error) || 'The request could not be completed.');
}

/** A protocol failure: an HTTP status and a JSON-RPC error object the agent runtime can read. */
export function protocolFailure(error: unknown, requestId: string) {
  const failure = asGatewayError(error);
  return {
    status: failure.status,
    body: {
      jsonrpc: '2.0' as const,
      id: null,
      error: {
        code: failure.code,
        message: failure.message,
        data: { reason: failure.reason, requestId },
      },
    },
  };
}

/**
 * A tool failure. The model has to reason about it, so it comes back as a normal MCP result with
 * `isError` and structured content rather than a transport error.
 */
export function toolFailure(error: unknown, requestId: string) {
  const failure = asGatewayError(error);
  const structuredContent = {
    code: failure.code,
    reason: failure.reason,
    message: failure.message,
    retryable: failure.retryable,
    requestId,
  };
  return {
    isError: true,
    structuredContent,
    content: [{ type: 'text' as const, text: JSON.stringify(structuredContent) }],
  };
}
