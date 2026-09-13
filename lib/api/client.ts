import type { z } from 'zod';
import { REQUESTED_WITH, webApi } from './routes';
import {
  acknowledgedResponse,
  auditResponse,
  connectResponse,
  errorResponse,
  membersResponse,
  notificationsResponse,
  organizationsResponse,
  organizationSchema,
  relaySecretResponse,
  removedResponse,
  savedResponse,
  subscribedResponse,
  type AlertSecretRequest,
  type ClearInboxSecretRequest,
  type ConnectRequest,
  type CreateOrganizationRequest,
  type InboxSecretRequest,
  type OAuthClientRequest,
  type PushSubscribeRequest,
  type PushUnsubscribeRequest,
  type RemoveOAuthClientRequest,
} from './schemas';

/** A route refused the request. `status` is the HTTP status, `code` the route's stable reason. */
export class WebApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'WebApiError';
  }
}

type Request<Response> = {
  path: string;
  schema: z.ZodType<Response>;
  method?: 'GET' | 'POST' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
};

/**
 * Every call the browser makes to this application's own routes. Same-origin with the header the
 * routes require, JSON in and out, and the shared error envelope turned into a `WebApiError`.
 * Responses are parsed against the schema on every call: the payloads are small and a silently
 * wrong shape is worse than the microseconds it costs.
 */
async function request<Response>({ path, schema, method = 'GET', body, signal }: Request<Response>) {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    signal,
    headers: {
      [REQUESTED_WITH.header]: REQUESTED_WITH.value,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const envelope = errorResponse.safeParse(payload);
    throw new WebApiError(
      response.status,
      envelope.success ? envelope.data.error : 'The request failed.',
      envelope.success ? envelope.data.code : undefined,
    );
  }
  const parsed = schema.safeParse(payload);
  if (!parsed.success) throw new WebApiError(response.status, 'The server returned an unexpected response.');
  return parsed.data;
}

export const webClient = {
  connect: (input: ConnectRequest) =>
    request({ path: webApi.connect, schema: connectResponse, method: 'POST', body: input }),
  members: (signal?: AbortSignal) => request({ path: webApi.members, schema: membersResponse, signal }),
  organizations: {
    list: (signal?: AbortSignal) =>
      request({ path: webApi.organizations, schema: organizationsResponse, signal }),
    create: (input: CreateOrganizationRequest) =>
      request({ path: webApi.organizations, schema: organizationSchema, method: 'POST', body: input }),
  },
  audit: (taskId: string, signal?: AbortSignal) =>
    request({ path: webApi.audit(taskId), schema: auditResponse, signal }),
  relaySecret: {
    reveal: (connectionId: string) =>
      request({ path: webApi.relaySecret(connectionId), schema: relaySecretResponse }),
    rotate: (connectionId: string) =>
      request({ path: webApi.relaySecret(connectionId), schema: relaySecretResponse, method: 'POST' }),
  },
  notifications: {
    list: (signal?: AbortSignal) =>
      request({ path: webApi.notifications, schema: notificationsResponse, signal }),
    acknowledge: (id: string) =>
      request({ path: webApi.acknowledgeNotification(id), schema: acknowledgedResponse, method: 'POST' }),
  },
  push: {
    subscribe: (input: PushSubscribeRequest) =>
      request({ path: webApi.pushSubscribe, schema: subscribedResponse, method: 'POST', body: input }),
    unsubscribe: (input: PushUnsubscribeRequest) =>
      request({ path: webApi.pushSubscribe, schema: removedResponse, method: 'DELETE', body: input }),
  },
  admin: {
    setAlertSecret: (input: AlertSecretRequest) =>
      request({ path: webApi.adminAlertSecret, schema: savedResponse, method: 'POST', body: input }),
    clearAlertSecret: () =>
      request({ path: webApi.adminAlertSecret, schema: removedResponse, method: 'DELETE', body: {} }),
    setOAuthClient: (input: OAuthClientRequest) =>
      request({ path: webApi.adminOAuthClient, schema: savedResponse, method: 'POST', body: input }),
    removeOAuthClient: (input: RemoveOAuthClientRequest) =>
      request({ path: webApi.adminOAuthClient, schema: removedResponse, method: 'DELETE', body: input }),
    setInboxSecret: (input: InboxSecretRequest) =>
      request({ path: webApi.adminInboxSecret, schema: savedResponse, method: 'POST', body: input }),
    clearInboxSecret: (input: ClearInboxSecretRequest) =>
      request({ path: webApi.adminInboxSecret, schema: removedResponse, method: 'DELETE', body: input }),
  },
};
