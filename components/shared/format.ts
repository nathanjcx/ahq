/** Domain labels: what a provider, a model, a status, or a file is called on screen. */
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
