import type { ProviderId } from './contracts';
export interface ProviderDefinition {
  id: ProviderId;
  name: string;
  description: string;
  color: string;
  serverUrl: string;
  documentation: string;
  note: string;
  /** Provider resources a user can follow in the inbox: label and example ID. */
  inbox?: { label: string; example: string };
  products?: { name: string; url: string }[];
}
export const providers: ProviderDefinition[] = [
  {
    id: 'linear',
    name: 'Linear',
    description: 'Issues, projects, and the work moving your team forward.',
    color: '#6864d9',
    serverUrl: 'https://mcp.linear.app/mcp',
    documentation: 'https://linear.app/docs/mcp',
    note: 'Sign in with Linear. Every external change is reviewed before it happens.',
    inbox: { label: 'Linear team IDs', example: 'a1b2c3d4-…' },
  },
  {
    id: 'slack',
    name: 'Slack',
    description: 'Bring conversations and decisions into your work.',
    color: '#7b436c',
    serverUrl: 'https://mcp.slack.com/mcp',
    documentation: 'https://docs.slack.dev/ai/slack-mcp-server/',
    note: 'Sign in with Slack. Your workspace administrator may need to approve the app first.',
    inbox: { label: 'Slack channel IDs', example: 'C0123ABCD' },
  },
  {
    id: 'google-workspace',
    name: 'Google Workspace',
    description: 'Mail, documents, spreadsheets, and your calendar.',
    color: '#4285f4',
    serverUrl: 'https://gmailmcp.googleapis.com/mcp/v1',
    documentation: 'https://developers.google.com/workspace/guides/configure-mcp-servers',
    note: 'Developer preview. Choose the products to connect, then sign in with Google. Gmail prepares drafts; sending is unavailable.',
    products: [
      { name: 'Gmail', url: 'https://gmailmcp.googleapis.com/mcp/v1' },
      { name: 'Drive', url: 'https://drivemcp.googleapis.com/mcp/v1' },
      { name: 'Docs', url: 'https://docsmcp.googleapis.com/mcp/v1' },
      { name: 'Sheets', url: 'https://sheetsmcp.googleapis.com/mcp/v1' },
      { name: 'Slides', url: 'https://slidesmcp.googleapis.com/mcp/v1' },
      { name: 'Calendar', url: 'https://calendarmcp.googleapis.com/mcp/v1' },
    ],
  },
  {
    id: 'github',
    name: 'GitHub',
    description: 'Repositories, pull requests, and engineering context.',
    color: '#333b43',
    serverUrl: 'https://api.githubcopilot.com/mcp/',
    documentation: 'https://github.com/github/github-mcp-server',
    note: 'Sign in with GitHub. Organization repositories need the app installed by an organization owner.',
    inbox: { label: 'Repositories', example: 'acme/repo' },
  },
  {
    id: 'canva',
    name: 'Canva',
    description: 'Create and refine visual work with your brand.',
    color: '#00a9ae',
    serverUrl: 'https://mcp.canva.com/mcp',
    documentation: 'https://www.canva.dev/docs/mcp/',
    note: 'Sign in with Canva. Available tools depend on your Canva account.',
  },
];
export const providerCatalog = providers;
export function getProvider(id: string) {
  const provider = providers.find((p) => p.id === id);
  if (!provider) throw new Error('Unknown integration');
  return provider;
}
export function providerServerUrls(provider: ProviderDefinition) {
  return provider.products?.map((product) => product.url) ?? [provider.serverUrl];
}
export const modelOptions = [
  { id: 'gpt-5.6-luna', name: 'Luna', description: 'Small, focused tasks' },
  { id: 'gpt-5.6-terra', name: 'Terra', description: 'Everyday employee work' },
  { id: 'gpt-5.6-sol', name: 'Sol', description: 'Complex decisions' },
  { id: 'gpt-6-astra', name: 'Astra', description: 'The hardest assignments' },
] as const;
