# Native inbox delivery

Astra HQ can receive verified native webhook deliveries for GitHub, Linear, and Slack. The endpoint is:

```text
POST https://your-web-origin.example.com/api/webhooks/native/<connectionId>
```

The endpoint reads the raw request body, verifies the provider signature, checks the configured exact resource IDs, and forwards only a normalized inbox item to Convex. It does not execute an agent, call an MCP tool, or broaden a connection's visibility. Unsupported provider events return `202` and are ignored. The existing signed normalized relay at `/api/webhooks/inbox/<connectionId>` remains the integration path for Google Workspace, ServiceNow, Canva, or another provider relay.

## Configuration

Set `NATIVE_INBOX_CONFIG_JSON` on the web service. Each key is a real Convex connection ID. The secret must be the provider webhook secret, and `resourceIds` must contain the exact resources the operator approved:

```json
{
  "connection_id": {
    "provider": "github",
    "secret": "a-long-random-webhook-secret",
    "resourceIds": ["acme/repo", "123456789"]
  },
  "linear_connection_id": {
    "provider": "linear",
    "secret": "a-long-random-webhook-secret",
    "resourceIds": ["team-uuid"]
  },
  "slack_connection_id": {
    "provider": "slack",
    "secret": "a-long-random-signing-secret",
    "teamId": "T01234567",
    "resourceIds": ["C01234567"]
  }
}
```

Do not reuse one provider secret across connections. Keep this variable sealed in Railway. A connection must still exist, be `connected`, and have the same provider as the config entry. An empty resource list is invalid. Convex deduplicates by `(connectionId, externalId)`.

## GitHub

In the repository's Settings → Webhooks, add the endpoint above, choose `application/json`, set the secret to the configured value, and subscribe to `Issues`, `Pull requests`, and `Issue comments`. GitHub signs the exact body with `X-Hub-Signature-256`; the endpoint also requires `X-GitHub-Delivery` and `X-GitHub-Event`. Configure a repository full name such as `acme/repo` or its numeric repository ID. Events from other repositories are acknowledged and ignored. GitHub does not provide a delivery timestamp. The normalized external ID is derived from the signed body, while the delivery header is retained only for validation and diagnostics; Convex deduplicates repeated deliveries without trusting that unsigned header.

The endpoint normalizes issue, pull request, and issue comment deliveries. It stores the provider URL and a short preview. It does not copy the full webhook payload.

## Linear

Create a webhook in Linear API settings or with `webhookCreate`, using the endpoint above, the approved team ID, and the smallest resource set (`Issue` and/or `Comment`). Copy the webhook signing secret into the matching config entry. Linear signs the exact body with `Linear-Signature`, sends `Linear-Delivery`, and includes `webhookTimestamp` in milliseconds. The endpoint requires a fresh timestamp within 60 seconds and an exact configured team ID. Use the provider's current [webhook documentation](https://linear.app/developers/webhooks) when configuring the webhook.

The endpoint normalizes `Issue` and `Comment` deliveries. Other Linear event types are acknowledged and ignored. A deleted or updated provider record is an inbox event; it is never interpreted as an instruction to delete or mutate anything in Astra HQ.

## Slack

In the Slack app's Event Subscriptions screen, set the Request URL to the endpoint above and subscribe only to the message events the app needs, beginning with `message.channels`. Add private-channel events only when the app is explicitly a member of those channels. Slack sends a `url_verification` payload containing `type`, `token`, and `challenge` during setup; the endpoint verifies `X-Slack-Signature` first and returns the signed challenge even when Slack omits a team ID. Runtime events require `X-Slack-Request-Timestamp` within five minutes and the versioned `v0` HMAC signature. Configure exact channel IDs in `resourceIds`. An optional `teamId` adds a workspace check; it never grants access to channels by itself.

The endpoint normalizes human `message` events with an `event_id` and non-empty text. Deleted messages and unsupported event subtypes are acknowledged and ignored. Slack payloads do not include a canonical permalink for every event, so the normalized item does not invent one.

## Delivery behavior and testing

The body limit is 1 MB. Signature verification happens before JSON normalization. Previews are capped at 5,000 characters, and only HTTPS provider URLs are retained. A bad signature, stale timestamp, malformed body, missing delivery ID, inactive connection, or invalid configuration is an error response so the provider can retry or an operator can correct it. A valid but unsupported event returns `202`.

Test each connection with a non-sensitive issue, pull request, Linear team, Slack channel, and Slack URL verification request. Resend the same GitHub, Linear, or Slack delivery and confirm that the stable external ID produces one inbox record. Confirm an event from an unregistered repository, team, or channel is acknowledged without creating an item. Never place full provider bodies, webhook secrets, OAuth tokens, or message contents in logs.

Provider references: [GitHub webhook signatures](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries), [GitHub webhook events](https://docs.github.com/en/webhooks/webhook-events-and-payloads), [Linear webhooks](https://linear.app/developers/webhooks), and [Slack request verification](https://api.slack.com/authentication/verifying-requests-from-slack).
