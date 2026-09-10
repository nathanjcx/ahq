import type { CloudSession } from './types';
import type { AgentArtifact, AgentMemory, MemoryInput, OfficeMessage } from '../desktop/agent-tools';
export type { AgentArtifact, AgentMemory, MemoryInput, OfficeMessage };
export interface AgentInspection {
  session: CloudSession | null;
  memories: AgentMemory[];
  messages: OfficeMessage[];
  artifacts: AgentArtifact[];
}
