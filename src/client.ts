import type { Command, OfficeBridge, Snapshot } from './shared/types';

const previewToken = document.querySelector<HTMLMetaElement>('meta[name="office-token"]')?.content;
async function command(command: Command): Promise<Snapshot> {
  const response = await fetch('/api/command', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Office-Token': previewToken || '' },
    body: JSON.stringify(command),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'The local runtime is unavailable.');
  if (command.type === 'auth.login' && result.auth?.loginUrl) window.open(result.auth.loginUrl, '_blank', 'noopener,noreferrer');
  return result;
}
export const bridge: OfficeBridge = window.office || {
  platform: 'browser-preview', command,
  subscribe(listener) {
    const events = new EventSource('/api/events');
    events.onmessage = (event) => listener(JSON.parse(event.data));
    return () => events.close();
  },
  async openArtifact(id) {
    const response = await fetch(`/api/artifact/${encodeURIComponent(id)}`, { headers: { 'X-Office-Token': previewToken || '' } });
    if (!response.ok) throw new Error('Artifact could not be downloaded.');
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = response.headers.get('X-Artifact-Name') || 'artifact.md';
    a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
  async openExternal(raw) {
    const url = new URL(raw);
    if (url.protocol !== 'https:') throw new Error('Only HTTPS links can be opened.');
    window.open(url.href, '_blank', 'noopener,noreferrer');
  },
};
