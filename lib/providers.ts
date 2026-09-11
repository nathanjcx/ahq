import type { ProviderId } from './contracts';
export interface ProviderDefinition {
  id: ProviderId;
  name: string;
  description: string;
  color: string;
  serverUrl: string;
  documentation: string;
  note: string;
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
    note: 'Connect your Linear account. Every external change is reviewed.',
  },
  {
    id: 'slack',
    name: 'Slack',
    description: 'Bring conversations and decisions into your work.',
    color: '#7b436c',
    serverUrl: 'https://mcp.slack.com/mcp',
    documentation: 'https://docs.slack.dev/ai/slack-mcp-server/',
    note: 'Requires an internal or marketplace-published Slack app. Unlisted apps cannot use Slack MCP.',
  },
  {
    id: 'google-workspace',
    name: 'Google Workspace',
    description: 'Mail, documents, spreadsheets, and your calendar.',
    color: '#4285f4',
    serverUrl: 'https://gmailmcp.googleapis.com/mcp/v1',
    documentation: 'https://developers.google.com/workspace/guides/configure-mcp-servers',
    note: 'Developer preview. Connect each product separately. Gmail prepares drafts; sending is unavailable.',
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
    note: 'Use a supported token restricted to the repositories this employee needs.',
  },
  {
    id: 'salesforce',
    name: 'Salesforce',
    description: 'Customer records and the relationships behind them.',
    color: '#129ed7',
    serverUrl: 'https://api.salesforce.com/platform/mcp/v1/platform/sobject-all',
    documentation:
      'https://developer.salesforce.com/docs/platform/hosted-mcp-servers/guide/hosted-mcp-servers-overview.html',
    note: 'Requires hosted MCP access in your organization. Restrict object and field permissions in Salesforce.',
  },
  {
    id: 'servicenow',
    name: 'ServiceNow',
    description: 'Service requests, incidents, and operational work.',
    color: '#4f7660',
    serverUrl: '',
    documentation: 'https://www.servicenow.com/docs/',
    note: 'Your administrator must approve the instance hostname and configure its MCP server.',
  },
  {
    id: 'canva',
    name: 'Canva',
    description: 'Create and refine visual work with your brand.',
    color: '#00a9ae',
    serverUrl: 'https://mcp.canva.com/mcp',
    documentation: 'https://www.canva.dev/docs/mcp/',
    note: 'Optional for creative employees. Canva must approve your application redirect URL. Available tools depend on the user account.',
  },
];
export const providerCatalog = providers;
export function getProvider(id: string) {
  const provider = providers.find((p) => p.id === id);
  if (!provider) throw new Error('Unknown integration');
  return provider;
}
export const modelOptions = [
  { id: 'gpt-5.6-luna', name: 'Luna', description: 'Small, focused tasks' },
  { id: 'gpt-5.6-terra', name: 'Terra', description: 'Everyday employee work' },
  { id: 'gpt-5.6-sol', name: 'Sol', description: 'Complex decisions' },
  { id: 'gpt-6-astra', name: 'Astra', description: 'The hardest assignments' },
] as const;
