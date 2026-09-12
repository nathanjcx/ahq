# Native inbox delivery

Astra HQ receives verified native webhook deliveries for GitHub, Linear, and Slack. There is one endpoint per provider, shared by every workspace and connection:

```text
POST https://your-web-origin.example.com/api/webhooks/native/github
POST https://your-web-origin.example.com/api/webhooks/native/linear
POST https://your-web-origin.example.com/api/webhooks/native/slack
```

The endpoint reads the raw request body, verifies the provider signature with the operator's app-level secret, normalizes the payload, and asks Convex to deliver the item to every connected connection of that provider that follows the resource the event came from. It does not execute an agent, call an MCP tool, or broaden a connection's visibility. Unsupported provider events return `202` and are ignored.

An unknown provider path segment, or a provider with no configured secret, returns `404`.

The separate signed normalized relay at `/api/webhooks/inbox/<connectionId>`, configured with `INBOX_WEBHOOK_SECRETS_JSON`, is unchanged and remains the integration path for Google Workspace and other provider relays.

## Operator configuration

Set `NATIVE_INBOX_SECRETS_JSON` on the web service with one secret per provider. These are app-level secrets, configured once:

```json
{
  "github": "the GitHub App webhook secret",
  "linear": "the Linear OAuth application webhook signing secret",
  "slack": "the Slack app signing secret"
}
```

Keep this variable sealed. Adding, removing, or re-scoping a user's connection requires no change to it and no redeploy. Include only the providers that are actually set up; a provider omitted here returns `404` and reports as unconfigured in the setup state.

## User configuration

Each user chooses which resources their connection receives, in the **Inbox** field on the connection in the Integrations page. Values are exact provider IDs, one per line:

| Provider | Value |
| -------- | ----- |
| GitHub   | repository full name `owner/name`, or the numeric repository ID |
| Linear   | team UUID |
| Slack    | channel ID such as `C01234567` |

A delivery goes only to connections whose provider matches the endpoint, whose status is `connected`, and whose inbox resources contain the resource on the event. An event for an unfollowed resource is acknowledged with `202` and creates nothing. Two users following the same repository each receive their own copy. A connection with an empty inbox list receives nothing.

## GitHub

Set the webhook URL and secret once in the GitHub App's settings, and subscribe to `Issues`, `Pull requests`, and `Issue comments`. GitHub signs the exact body with `X-Hub-Signature-256`; the endpoint also requires `X-GitHub-Delivery` and `X-GitHub-Event`. Both the numeric `repository.id` and `repository.full_name` from the payload are used as candidate keys, so either form works in a user's inbox list.

GitHub does not provide a delivery timestamp. The normalized external ID is derived from the signed body; the delivery header is used only for validation and diagnostics, so repeated deliveries deduplicate without trusting that unsigned header.

The endpoint normalizes issue, pull request, and issue comment deliveries into a title, a short preview, and the provider URL. It does not copy the full webhook payload.

## Linear

Set the webhook URL in the Linear OAuth application's settings and copy its signing secret into `NATIVE_INBOX_SECRETS_JSON`. Subscribe to `Issue` and `Comment` only. Linear signs the exact body with `Linear-Signature`, sends `Linear-Delivery`, and includes `webhookTimestamp` in milliseconds. The endpoint requires a timestamp within 60 seconds of now, and rejects a `Linear-Timestamp` header that disagrees with the signed body. The team ID on the payload is the routing key. See the current [webhook documentation](https://linear.app/developers/webhooks).

Other Linear event types are acknowledged and ignored. A deleted or updated provider record is an inbox event; it is never interpreted as an instruction to delete or mutate anything in Astra HQ.

## Slack

In the Slack app's Event Subscriptions screen, set the Request URL to the Slack endpoint above and subscribe only to the message events the app needs, beginning with `message.channels`. Add private-channel events only when the app is a member of those channels.

Slack sends a `url_verification` payload containing `type`, `token`, and `challenge` when the Request URL is saved. The endpoint verifies `X-Slack-Signature` first and then echoes the challenge, so URL verification succeeds before any user has connected Slack. Runtime events require `X-Slack-Request-Timestamp` within five minutes and the versioned `v0` HMAC signature. The channel ID on the message is the routing key.

The endpoint normalizes `message` events with an `event_id` and non-empty text. Deleted messages and unsupported subtypes are acknowledged and ignored. Slack payloads do not include a canonical permalink for every event, so the normalized item does not invent one.

## Delivery behavior and testing

The body limit is 1 MB. Signature verification happens before JSON normalization. Previews are capped at 5,000 characters, and only HTTPS provider URLs are retained. A bad signature, stale timestamp, malformed body, or missing delivery header is an error response so the provider retries or an operator corrects it. A valid but unsupported or unfollowed event returns `202`.

Convex deduplicates by `(connectionId, externalId)`, and the external ID is a hash of the signed body, so a replayed delivery produces one inbox record per connection. A successful response is `202 {"accepted": true, "delivered": n}`, where `n` counts the inbox records created across all matching connections; `delivered` is `0` when nobody follows the resource.

To test: save the Slack Request URL and confirm URL verification passes with no Slack connection present. Then add a repository, team, and channel to a connection's inbox list and trigger one non-sensitive event for each. Resend the same delivery and confirm one record. Trigger an event on an unfollowed resource and confirm `delivered` is `0`. Never place full provider bodies, webhook secrets, OAuth tokens, or message contents in logs.

Provider references: [GitHub webhook signatures](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries), [GitHub webhook events](https://docs.github.com/en/webhooks/webhook-events-and-payloads), [Linear webhooks](https://linear.app/developers/webhooks), and [Slack request verification](https://api.slack.com/authentication/verifying-requests-from-slack).
