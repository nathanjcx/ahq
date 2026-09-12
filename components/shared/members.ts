'use client';

import { useEffect, useState } from 'react';
import type { Member } from '@/lib/contracts';
import { webApi } from '@/lib/ui-api';

/** Workspace members from Clerk, for sharing pickers. */
export function useMembers() {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const response = await fetch(webApi.members);
        const body = (await response.json()) as Member[] | { error?: string };
        if (!response.ok || !Array.isArray(body))
          throw new Error(('error' in body && body.error) || 'Could not load members.');
        if (active) setMembers(body);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'Could not load members.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);
  return { members, loading, error };
}
