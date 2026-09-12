import type { ActionProposal, ModelId, ProviderId, Task } from '@/lib/contracts';
import { providers } from '@/lib/providers';

export function providerName(provider: ProviderId) {
  return providers.find((entry) => entry.id === provider)?.name ?? provider;
}
/** Two-letter mark used by provider badges. */
export function providerShort(provider: ProviderId) {
  if (provider === 'google-workspace') return 'GW';
  return providerName(provider).slice(0, 2).toUpperCase();
}
export function modelName(model: ModelId) {
  return { 'gpt-5.6-luna': 'Luna', 'gpt-5.6-terra': 'Terra', 'gpt-5.6-sol': 'Sol', 'gpt-6-astra': 'Astra' }[
    model
  ];
}
export function statusLabel(status: Task['status']) {
  return status.replace('_', ' ').replace(/^./, (letter) => letter.toUpperCase());
}
export function correctionLabel(kind: ActionProposal['correction']) {
  return {
    supported: 'Correction supported.',
    partial: 'Partial correction only.',
    manual: 'Manual correction.',
    irreversible: 'Cannot be reversed.',
    unknown: 'Correction is unverified.',
  }[kind];
}
export function timeGreeting() {
  const hour = new Date().getHours();
  return hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
}
export function relativeTime(timestamp: number) {
  const seconds = Math.max(1, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days < 7
    ? `${days}d ago`
    : new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
export function safeJson(value: string) {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}
export function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
export function safeHttpsUrl(value: unknown) {
  if (typeof value !== 'string' || !value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}
export function lines(value: string) {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}
