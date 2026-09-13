'use client';

import { useMemo } from 'react';
import { memoryShelves, type MemoryFill, type ShelfSpec } from './office-layout';
import { notebookFills, summaryFill } from '@/components/shared/memory';
import { useUiQuery } from '@/components/shared/use-ui-query';
import { defaultWorkspaceSettings } from '@/lib/contracts';
import { uiApi } from '@/lib/ui-api';

/**
 * How full this floor's memory is: the binder on the meeting table, the notebook
 * on each desk, and the claims in dispute. The binder and the count come from the
 * floor's own summary; notebooks have no summary of their own, so they are counted
 * off the claims in the agent scope against the workspace's notebook budget.
 */
export function useFloorMemory(floorId?: string): MemoryFill | undefined {
  const floors = useUiQuery(uiApi.memorySummaries, floorId ? { scope: 'floor' } : 'skip');
  const notebooks = useUiQuery(uiApi.memories, floorId ? { scope: 'agent' } : 'skip');
  const settings = useUiQuery(uiApi.workspaceSettings, floorId ? {} : 'skip');
  const budget = settings?.memoryBudgets.agent ?? defaultWorkspaceSettings.memoryBudgets.agent;
  return useMemo(() => {
    const floor = floorId ? floors?.find((summary) => summary.scopeId === floorId) : undefined;
    if (!floor) return undefined;
    return {
      floorFill: summaryFill(floor),
      agentFills: notebookFills(notebooks ?? [], budget),
      contested: floor.contested,
    };
  }, [floorId, floors, notebooks, budget]);
}

/**
 * The basement's shelves: one run of casework per scope the workspace keeps
 * memory in, named and filled from the same summaries Records lists.
 */
export function useRecordsShelves(): ShelfSpec[] | undefined {
  const workspace = useUiQuery(uiApi.memorySummaries, { scope: 'workspace' });
  const floors = useUiQuery(uiApi.memorySummaries, { scope: 'floor' });
  const projects = useUiQuery(uiApi.memorySummaries, { scope: 'project' });
  return useMemo(() => {
    if (!workspace || !floors || !projects) return undefined;
    return memoryShelves([...workspace, ...floors, ...projects]);
  }, [workspace, floors, projects]);
}
