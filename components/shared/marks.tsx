'use client';

import {
  Bot,
  Building2,
  Check,
  Command,
  GitBranch,
  Mail,
  MessageSquareText,
  MoreHorizontal,
  ShieldCheck,
  X,
} from 'lucide-react';
import type { CSSProperties } from 'react';
import type { Employee, ProviderId, Task } from '@/lib/contracts';
import { providers, type ProviderDefinition } from '@/lib/providers';
import { providerShort } from './format';

export function Avatar({ employee, large = false }: { employee: Employee; large?: boolean }) {
  return (
    <span
      className={`avatar employee-avatar ${large ? 'avatar-large' : ''}`}
      style={{ '--employee-color': employee.color } as CSSProperties}
    >
      <Bot size={large ? 22 : 16} />
    </span>
  );
}

export function StatusMark({ status }: { status: Task['status'] }) {
  return (
    <span className={`status-mark status-${status}`}>
      {status === 'completed' ? (
        <Check size={12} />
      ) : status === 'awaiting_approval' ? (
        <ShieldCheck size={12} />
      ) : status === 'failed' || status === 'cancelled' ? (
        <X size={12} />
      ) : status === 'uncertain' ? (
        <MoreHorizontal size={12} />
      ) : (
        <i />
      )}
    </span>
  );
}

export function ProviderMark({ provider, small = false }: { provider: ProviderId; small?: boolean }) {
  const match = providers.find((item) => item.id === provider);
  return (
    <span
      className={`provider-mark ${small ? 'provider-small' : ''}`}
      style={{ '--provider-color': match?.color || '#607565' } as CSSProperties}
    >
      {providerShort(provider)}
    </span>
  );
}

export function ProviderLogo({ provider }: { provider: ProviderDefinition }) {
  if (provider.id === 'github')
    return (
      <span className="provider-logo" style={{ background: provider.color }}>
        <GitBranch size={22} />
      </span>
    );
  if (provider.id === 'google-workspace')
    return (
      <span className="provider-logo google-logo">
        <Mail size={21} />
      </span>
    );
  if (provider.id === 'slack')
    return (
      <span className="provider-logo" style={{ background: provider.color }}>
        <MessageSquareText size={21} />
      </span>
    );
  if (provider.id === 'linear')
    return (
      <span className="provider-logo" style={{ background: provider.color }}>
        <Command size={21} />
      </span>
    );
  return (
    <span className="provider-logo" style={{ background: provider.color }}>
      <Building2 size={21} />
    </span>
  );
}
