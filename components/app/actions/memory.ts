'use client';

import { useMutation } from 'convex/react';
import { asId, uiApi } from '@/lib/ui-api';

/**
 * Memory actions. The records workstream owns the rest of this file; the floor page's memory binder
 * needs approval, which is the one claim decision a person makes outside the Records room.
 */
export type MemoryActions = {
  approveMemory: (id: string) => Promise<unknown>;
};

export const offlineMemoryActions: MemoryActions = {
  approveMemory: async () => undefined,
};

export function useMemoryActions(): MemoryActions {
  const approveMemory = useMutation(uiApi.approveMemory);
  return { approveMemory: (id) => approveMemory({ id: asId(id) }) };
}
