import { api } from '@/convex/_generated/api';

/** Convex references for the memory domain, under the names the UI uses. */
export const memoryApi = {
  memories: api.memory.list,
  memorySummaries: api.memory.summaries,
  taskSummary: api.memory.taskSummary,
  proposeMemory: api.memory.propose,
  approveMemory: api.memory.approve,
  archiveMemory: api.memory.archive,
  resolveMemoryContest: api.memory.resolveContest,
  setMemoryBudgets: api.memory.setBudgets,
} as const;
