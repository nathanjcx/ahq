# Google Workspace MCP

Google Workspace MCP is a Developer Preview as of September 11, 2026. Treat it as a controlled test integration. The provider's own guide says each Workspace product has a dedicated MCP server, and that access inherits the user's Google permissions. Read [Google's configuration guide](https://developers.google.com/workspace/guides/configure-mcp-servers) before registering a client.

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

Copy the client ID and secret into the web service's `MCP_OAUTH_CONFIG_JSON` under the `google-workspace` key. For a single sign-in across products, `scopes` must be the union of the scopes for every product the deployment enables:

```json
{
  "google-workspace": {
    "clientId": "GOOGLE_CLIENT_ID",
    "clientSecret": "GOOGLE_CLIENT_SECRET",
    "scopes": "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.file"
  }
}
```

Add the Docs, Sheets, Slides, and Calendar scopes to the same string when those products are enabled.

The app uses the MCP server's OAuth discovery when the authorization and token URLs are omitted. If the selected server requires fixed endpoints, add its documented `authorizationUrl`, `tokenUrl`, and `tokenAuthMethod`. Do not put access tokens in this variable. The callback seals the resulting credential before storing it.

## Use the product URLs

Put the exact URLs for the products that the organization has enabled in `MCP_SERVER_URLS_JSON` in Convex:

| Product  | MCP URL                                     |
| -------- | ------------------------------------------- |
| Gmail    | `https://gmailmcp.googleapis.com/mcp/v1`    |
| Drive    | `https://drivemcp.googleapis.com/mcp/v1`    |
| Docs     | `https://docsmcp.googleapis.com/mcp/v1`     |
| Sheets   | `https://sheetsmcp.googleapis.com/mcp/v1`   |
| Slides   | `https://slidesmcp.googleapis.com/mcp/v1`   |
| Calendar | `https://calendarmcp.googleapis.com/mcp/v1` |

The current provider registry shows Gmail as the default URL and lists the five other supported product URLs. Keep the exact trailing path. A URL in `MCP_SERVER_URLS_JSON` is an admission allowlist, not a grant to any tool.

In the UI the user picks which products to connect (Gmail, Drive, Docs, Sheets, Slides, Calendar) in one dialog and signs in once. After the callback, the app connects each remaining product with the same grant whenever Google accepts it. If one product's server rejects the token, the user is sent through consent again for that product, which is what happens when the client's scopes do not cover it.

Each connection's allowed tools are the intersection of the tools discovered on that product server and the non-blocked tools registered for `google-workspace` in `MCP_TOOL_REGISTRY_JSON`. Connecting a product fails when that intersection is empty. The owner can narrow tools and set a resource scope afterwards on the connection's Manage access panel. The employee capability and the per-connection tool grant must both allow a call.

## Gmail and write safety

The current integration exposes Gmail draft workflows. `gmail.create_draft` creates a draft for review in Gmail. There is no send operation in the supported registry, and a task must never tell a user that a draft was sent. Show the draft target, recipients, subject, body, and the provider result before a human sends it in Gmail.

Google warns that emails and documents can contain indirect prompt injection. Treat retrieved content as untrusted data. Keep external writes behind Astra HQ's action proposal and approval flow, use narrow scopes, and review every write. An OAuth grant does not remove provider-side restrictions, Workspace admin controls, or the employee's selected tool and resource permissions.

## Inbox and event visibility

An MCP connection does not register Google push events. To ingest Gmail, Drive, Calendar, or Chat events, configure the provider-side watch and Google Pub/Sub or an authorized relay separately. The relay must filter events to the connected account and permitted resources before sending them to Astra HQ's webhook endpoint. Use the HMAC protocol in [the deployment guide](deployment.md):

```text
POST /api/webhooks/inbox/<connectionId>
x-ahq-timestamp: <unix-seconds>
x-ahq-signature: HMAC_SHA256(secret, timestamp + "." + rawBody)
```

The endpoint accepts normalized items only, at most 100 per request, with an HTTPS source URL when present. It rejects missing or stale signatures. Never forward full message bodies when a title and short preview are sufficient, and never log the raw payload. Event visibility follows the relay's filtering, the Google account's permissions, Workspace admin policy, and the connection's visible user list. The app has no automatic provider subscription registration.

## Test plan

Use a test Workspace account and a non-sensitive document or calendar. Select the products, sign in once, and confirm one connection appears per selected product with the reviewed tools. Run one read-only search for each product you enable. For Gmail, run a draft request addressed to a test mailbox and verify that the message remains a draft. Confirm that the UI shows the provider account, allowed tools, and resource scope. Then test a signed relay fixture and resend it to verify deduplication.

If OAuth fails, inspect the Google OAuth logs and check the callback, consent audience, test-user list, enabled APIs, enabled MCP services, and requested scopes. If the user is asked to consent a second time for one product, the configured scopes do not cover that product. If discovery succeeds but a tool is missing, inspect `MCP_TOOL_REGISTRY_JSON`, the connection's allowed tools, and the employee capability. A successful Google login alone does not prove that a provider operation is authorized.

## References

- [Configure Google Workspace MCP servers](https://developers.google.com/workspace/guides/configure-mcp-servers)
- [Google Workspace event subscriptions](https://developers.google.com/workspace/events)
- [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy)

When a deployment wants separate scopes per product instead of one sign-in, use the product's full MCP URL as the key in `MCP_OAUTH_CONFIG_JSON`. Endpoint entries override the `google-workspace` default. For example, a Drive entry under `https://drivemcp.googleapis.com/mcp/v1` can request Drive scopes without adding Gmail scopes; the user then consents once per product. Set this configuration on web, gateway, and worker so refreshes use the same client.
