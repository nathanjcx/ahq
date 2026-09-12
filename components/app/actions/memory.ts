'use client';

import { useMutation } from 'convex/react';
import type { MemoryBudgets, MemoryKind, MemoryScope } from '@/lib/contracts';
import { asId, uiApi } from '@/lib/ui-api';

/** A claim a person files themselves. Person claims activate at once, except in workspace scope. */
export type ClaimDraft = {
  scope: MemoryScope;
  scopeId: string;
  kind: MemoryKind;
  text: string;
  tags: string[];
  confidence: number;
  expiresAt?: number;
};

export type MemoryActions = {
  proposeMemory: (draft: ClaimDraft) => Promise<unknown>;
  approveMemory: (memoryId: string) => Promise<unknown>;
  archiveMemory: (memoryId: string) => Promise<unknown>;
  /** Settles a contested pair: keep this claim, keep the one it conflicts with, or neither. */
  resolveMemoryContest: (memoryId: string, keep: 'this' | 'other' | 'neither') => Promise<unknown>;
  setMemoryBudgets: (budgets: MemoryBudgets) => Promise<unknown>;
};

const unavailable = async () => undefined;

export const offlineMemoryActions: MemoryActions = {
  proposeMemory: unavailable,
  approveMemory: unavailable,
  archiveMemory: unavailable,
  resolveMemoryContest: unavailable,
  setMemoryBudgets: unavailable,
};

export function useMemoryActions(): MemoryActions {
  const propose = useMutation(uiApi.proposeMemory);
  const approve = useMutation(uiApi.approveMemory);
  const archive = useMutation(uiApi.archiveMemory);
  const resolveContest = useMutation(uiApi.resolveMemoryContest);
  const setBudgets = useMutation(uiApi.setMemoryBudgets);

  return {
    proposeMemory: (draft) => propose(draft),
    approveMemory: (memoryId) => approve({ id: asId(memoryId) }),
    archiveMemory: (memoryId) => archive({ id: asId(memoryId) }),
    resolveMemoryContest: (memoryId, keep) => resolveContest({ id: asId(memoryId), keep }),
    setMemoryBudgets: (budgets) => setBudgets({ budgets }),
  };
}
