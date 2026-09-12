# Native inbox delivery

Astra HQ receives verified native webhook deliveries for GitHub, Linear, and Slack. There is one endpoint per provider, shared by every workspace and connection:

```text
POST https://your-web-origin.example.com/api/webhooks/native/github
POST https://your-web-origin.example.com/api/webhooks/native/linear
POST https://your-web-origin.example.com/api/webhooks/native/slack
```

The endpoint reads the raw request body, verifies the provider signature with the administrator's app-level secret, normalizes the payload, and asks Convex to deliver the item to every connected connection of that provider that follows the resource the event came from. It does not execute an agent, call an MCP tool, or broaden a connection's visibility. Unsupported provider events return `202` and are ignored.

An unknown provider path segment, or a provider with no configured secret, returns `404`.

The separate signed normalized relay at `/api/webhooks/inbox/<connectionId>` is the integration path for Google Workspace and any other provider relay. It is described under [the normalized relay](#the-normalized-relay) below.

## Administrator configuration

Native inbox secrets are Convex data, not environment variables. A platform administrator sets one per provider on the Operations page, under the provider's **Native inbox secret**. The card also shows the exact webhook URL to configure with the provider. The browser posts the secret once to the web service, which seals it before Convex stores it; afterwards the page shows only whether a secret is set and when it changed.

These are app-level secrets, configured once: the GitHub App webhook secret, the Linear OAuth application webhook signing secret, and the Slack app signing secret. Adding, removing, or re-scoping a user's connection requires no change to them and no redeploy. A provider with no secret set returns `404` and reports as unconfigured on the readiness card. Clearing a secret stops delivery for that provider immediately.

## User configuration

Each user chooses which resources their connection receives, in the **Inbox** field on the connection's Manage access panel. Values are exact provider IDs, comma separated, at most 100:

| Provider | Value                                                           |
| -------- | --------------------------------------------------------------- |
| GitHub   | repository full name `owner/name`, or the numeric repository ID |
| Linear   | team UUID                                                       |
| Slack    | channel ID such as `C01234567`                                  |

A delivery goes only to connections whose provider matches the endpoint, whose status is `connected`, and whose inbox resources contain the resource on the event. An event for an unfollowed resource is acknowledged with `202` and creates nothing. Two users following the same repository each receive their own copy. A connection with an empty inbox list receives nothing.

## GitHub

Set the webhook URL and secret once in the GitHub App's settings, and subscribe to `Issues`, `Pull requests`, and `Issue comments`. GitHub signs the exact body with `X-Hub-Signature-256`; the endpoint also requires `X-GitHub-Delivery` and `X-GitHub-Event`. Both the numeric `repository.id` and `repository.full_name` from the payload are used as candidate keys, so either form works in a user's inbox list.

GitHub does not provide a delivery timestamp. The normalized external ID is derived from the signed body; the delivery header is used only for validation and diagnostics, so repeated deliveries deduplicate without trusting that unsigned header.

The endpoint normalizes issue, pull request, and issue comment deliveries into a title, a short preview, and the provider URL. It does not copy the full webhook payload.

## Linear

Set the webhook URL in the Linear OAuth application's settings and copy its signing secret into the Linear card on Operations. Subscribe to `Issue` and `Comment` only. Linear signs the exact body with `Linear-Signature`, sends `Linear-Delivery`, and includes `webhookTimestamp` in milliseconds. The endpoint requires a timestamp within 60 seconds of now, and rejects a `Linear-Timestamp` header that disagrees with the signed body. The team ID on the payload is the routing key. See the current [webhook documentation](https://linear.app/developers/webhooks).

Other Linear event types are acknowledged and ignored. A deleted or updated provider record is an inbox event; it is never interpreted as an instruction to delete or mutate anything in Astra HQ.

## Slack

In the Slack app's Event Subscriptions screen, set the Request URL to the Slack endpoint above and subscribe only to the message events the app needs, beginning with `message.channels`. Add private-channel events only when the app is a member of those channels.

Slack sends a `url_verification` payload containing `type`, `token`, and `challenge` when the Request URL is saved. The endpoint verifies `X-Slack-Signature` first and then echoes the challenge, so URL verification succeeds before any user has connected Slack. Runtime events require `X-Slack-Request-Timestamp` within five minutes and the versioned `v0` HMAC signature. The channel ID on the message is the routing key.

The endpoint normalizes `message` events with an `event_id` and non-empty text. Deleted messages and unsupported subtypes are acknowledged and ignored. Slack payloads do not include a canonical permalink for every event, so the normalized item does not invent one.

## Delivery behavior and testing

The body limit is 1 MB. Signature verification happens before JSON normalization. Previews are capped at 5,000 characters, and only HTTPS provider URLs are retained. A bad signature, stale timestamp, malformed body, or missing delivery header is an error response so the provider retries or an operator corrects it. A valid but unsupported or unfollowed event returns `202`.

Convex deduplicates by `(connectionId, externalId)`, and the external ID is a hash of the signed body, so a replayed delivery produces one inbox record per connection. A successful response is `202 {"accepted": true, "delivered": n}`, where `n` counts the inbox records created across all matching connections; `delivered` is `0` when nobody follows the resource.

To test: save the Slack Request URL and confirm URL verification passes with no Slack connection present. Then add a repository, team, and channel to a connection's inbox list and trigger one non-sensitive event for each. Resend the same delivery and confirm one record. Trigger an event on an unfollowed resource and confirm `delivered` is `0`. Never place full provider bodies, webhook secrets, OAuth tokens, or message contents in logs.

## The normalized relay

Providers without a native endpoint deliver through `POST /api/webhooks/inbox/<connectionId>`. Each connection carries its own relay secret, generated and sealed when the connection is created. The owner reveals or rotates it from **Manage access** on the connection; rotation returns a new secret and the exact relay URL, and no one but the owner can read it.

Sign the exact raw body and send the digest with its timestamp:

```text
POST https://your-web-origin.example.com/api/webhooks/inbox/<connectionId>
x-ahq-timestamp: <unix-seconds>
x-ahq-signature: hex(HMAC_SHA256(secret, timestamp + "." + rawBody))
```

The timestamp must be within five minutes of receipt. The body is JSON with at most 100 normalized items and an optional cursor:

```json
{
  "items": [
    {
      "externalId": "provider-event-id",
      "title": "Short title",
      "preview": "Redacted preview",
      "sourceUrl": "https://provider.example/item/1",
      "createdAt": 1720000000000
    }
  ],
  "cursor": "provider-cursor"
}
```

`sourceUrl` must be HTTPS. Items deduplicate on `(connectionId, externalId)`, so a redelivery updates one record. A delivery marks the connection's inbox mode as push and clears its last error. A connection with no relay secret, or one that is not active, is rejected.

The relay is responsible for filtering: it must normalize only events the connection's owner may see, before signing. The application registers no provider subscription, watch, or Pub/Sub topic. To rotate, pause delivery, rotate from Manage access, give the relay the new secret, resume, and send one signed test item. A connection accepts one secret at a time.

Provider references: [GitHub webhook signatures](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries), [GitHub webhook events](https://docs.github.com/en/webhooks/webhook-events-and-payloads), [Linear webhooks](https://linear.app/developers/webhooks), and [Slack request verification](https://api.slack.com/authentication/verifying-requests-from-slack).
