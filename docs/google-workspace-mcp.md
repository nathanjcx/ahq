# Google Workspace MCP

Google Workspace MCP is a Developer Preview as of September 12, 2026. Treat it as a controlled test integration. The provider's own guide says each Workspace product has a dedicated MCP server, and that access inherits the user's Google permissions. Read [Google's configuration guide](https://developers.google.com/workspace/guides/configure-mcp-servers) before registering a client.

## Create the Google project

Create or choose a Google Cloud project owned by the organization that will test Astra HQ. Enable both the product APIs and their MCP services. The current Google list is:

```sh
gcloud services enable \
  gmail.googleapis.com drive.googleapis.com docs.googleapis.com \
  sheets.googleapis.com slides.googleapis.com calendar-json.googleapis.com \
  gmailmcp.googleapis.com drivemcp.googleapis.com docsmcp.googleapis.com \
  sheetsmcp.googleapis.com slidesmcp.googleapis.com calendarmcp.googleapis.com \
  --project=PROJECT_ID
```

Configure Google Auth Platform branding and consent. Use an internal audience when the Workspace is internal. Gmail and Drive scopes are restricted: an external audience requires Google OAuth verification and a security assessment. Until that completes, only listed test users can connect and they see an unverified-app warning. A Workspace administrator can also block third-party apps. Request only the product scopes required for the reviewed tools. Google lists the scope choices in its [MCP setup guide](https://developers.google.com/workspace/guides/configure-mcp-servers), including Gmail read and compose, Drive read and file, and product-specific Docs, Sheets, Slides, and Calendar scopes.

## Register the OAuth client

In Google Auth Platform, create an OAuth client with application type `Web application`. Register this callback URI exactly:

```text
https://your-web-origin.example.com/api/integrations/callback
```

As a platform administrator, open Operations, expand Google Workspace, and add an OAuth client. Leave its server URL empty to make it the provider default, which covers every enabled Google product server. Paste the client id and the client secret; the web service seals the secret before Convex stores it, and the page never shows it again.

For a single sign-in across products, the client's `scopes` field must be the union of the scopes for every product the deployment enables, space separated, for example:

```text
https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.file
```

Add the Docs, Sheets, Slides, and Calendar scopes to the same string when those products are enabled. A user who is asked to consent a second time for one product is telling you that string does not cover it.

The app uses the MCP server's OAuth discovery when the authorization and token URLs are left empty. If a server requires fixed endpoints, fill in its documented `authorizationUrl`, `tokenUrl`, and `tokenAuthMethod`. Never paste an access token into this form. The callback seals the resulting credential before Convex stores it.

## Enable the product servers

On the same Operations card, tick the product servers the organization has enabled. A user can only connect to a server ticked here.

| Product  | MCP URL                                     |
| -------- | ------------------------------------------- |
| Gmail    | `https://gmailmcp.googleapis.com/mcp/v1`    |
| Drive    | `https://drivemcp.googleapis.com/mcp/v1`    |
| Docs     | `https://docsmcp.googleapis.com/mcp/v1`     |
| Sheets   | `https://sheetsmcp.googleapis.com/mcp/v1`   |
| Slides   | `https://slidesmcp.googleapis.com/mcp/v1`   |
| Calendar | `https://calendarmcp.googleapis.com/mcp/v1` |

These are the only Google URLs the application accepts; they come from the built-in registry in `lib/providers.ts` and cannot be edited in the app. Gmail is the provider default. Enabling a server is an admission decision, not a grant to any tool.

In the UI the user picks which products to connect (Gmail, Drive, Docs, Sheets, Slides, Calendar) in one dialog and signs in once. After the callback, the app connects each remaining product with the same grant whenever Google accepts it. If one product's server rejects the token, the user is sent through consent again for that product, which is what happens when the client's scopes do not cover it.

Each connection's allowed tools are the intersection of the tools discovered on that product server and the non-blocked `google-workspace` rows in the tool registry on Operations. Connecting a product fails when that intersection is empty, so review tools before asking anyone to connect. The registry section can import the discovered tool names from an administrator's own Google connection as blocked rows to review. The owner can narrow tools and set a resource scope afterwards on the connection's Manage access panel. The employee capability and the per-connection tool grant must both allow a call.

## Gmail and write safety

The current integration exposes Gmail draft workflows. `gmail.create_draft` creates a draft for review in Gmail. There is no send operation in the supported registry, and a task must never tell a user that a draft was sent. Show the draft target, recipients, subject, body, and the provider result before a human sends it in Gmail.

Google warns that emails and documents can contain indirect prompt injection. Treat retrieved content as untrusted data. Keep external writes behind Astra HQ's action proposal and approval flow, use narrow scopes, and review every write. An OAuth grant does not remove provider-side restrictions, Workspace admin controls, or the employee's selected tool and resource permissions.

## Inbox and event visibility

An MCP connection does not register Google push events. To ingest Gmail, Drive, Calendar, or Chat events, configure the provider-side watch and Google Pub/Sub or an authorized relay separately. The relay must filter events to the connected account and permitted resources before sending them to Astra HQ's webhook endpoint. Use the normalized relay protocol in [inbox delivery](inbox-delivery.md), signed with the connection's own relay secret, which the owner reveals or rotates from Manage access:

```text
POST /api/webhooks/inbox/<connectionId>
x-ahq-timestamp: <unix-seconds>
x-ahq-signature: HMAC_SHA256(secret, timestamp + "." + rawBody)
```

The endpoint accepts normalized items only, at most 100 per request, with an HTTPS source URL when present. It rejects missing or stale signatures. Never forward full message bodies when a title and short preview are sufficient, and never log the raw payload. Event visibility follows the relay's filtering, the Google account's permissions, Workspace admin policy, and the connection's visible user list. The app has no automatic provider subscription registration.

## Test plan

Use a test Workspace account and a non-sensitive document or calendar. Select the products, sign in once, and confirm one connection appears per selected product with the reviewed tools. Run one read-only search for each product you enable. For Gmail, run a draft request addressed to a test mailbox and verify that the message remains a draft. Confirm that the UI shows the provider account, allowed tools, and resource scope. Then test a signed relay fixture and resend it to verify deduplication.

If OAuth fails, inspect the Google OAuth logs and check the callback, consent audience, test-user list, enabled APIs, enabled MCP services, and requested scopes. If the user is asked to consent a second time for one product, the configured scopes do not cover that product. If discovery succeeds but a tool is missing, inspect its registry row on Operations, the connection's allowed tools, and the employee capability. A successful Google login alone does not prove that a provider operation is authorized.

## References

- [Configure Google Workspace MCP servers](https://developers.google.com/workspace/guides/configure-mcp-servers)
- [Google Workspace event subscriptions](https://developers.google.com/workspace/events)
- [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy)

When a deployment wants separate scopes per product instead of one sign-in, add a second OAuth client on the same card and set its server URL to that product's exact MCP URL. A client with a server URL overrides the provider default for that server only. A Drive-only client can then request Drive scopes without Gmail scopes, and the user consents once per product. The configuration is Convex data, so web, worker, and gateway all read the same client and refreshes stay consistent.
