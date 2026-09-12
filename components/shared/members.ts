'use client';

import { useEffect, useState } from 'react';
import { webClient } from '@/lib/api/client';
import type { Member } from '@/lib/contracts';

/** Workspace members from Clerk, for sharing pickers. */
export function useMembers() {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    webClient
      .members(controller.signal)
      .then(setMembers)
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : 'Could not load members.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);
  return { members, loading, error };
}
