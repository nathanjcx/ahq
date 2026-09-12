import type { ModelId } from './core';

export type ProjectStatus = 'planning' | 'active' | 'done' | 'archived';
export type MilestoneStatus = 'planned' | 'active' | 'done';

export interface Milestone {
  id: string;
  projectId: string;
  order: number;
  title: string;
  description: string;
  deadlineAt?: number;
  dependsOn: string[];
  status: MilestoneStatus;
  taskIds: string[];
}
export interface Project {
  id: string;
  name: string;
  brief: string;
  floorIds: string[];
  status: ProjectStatus;
  createdBy: string;
  createdByName: string;
  createdAt: number;
  updatedAt: number;
  milestones: Milestone[];
  /** Counts the project page shows without loading tasks. */
  openTasks: number;
  behindMilestones: number;
}
/** A planner turn's proposal for a project. Nothing in it exists until a person confirms it. */
export interface RoadmapProposal {
  staffing: {
    floorId: string;
    employeeIds: string[];
    suggestedHires: { versionId: string; count: number; reason: string }[];
  }[];
  milestones: {
    key: string;
    title: string;
    description: string;
    deadlineAt?: number;
    dependsOn: string[];
    tasks: {
      key: string;
      title: string;
      prompt: string;
      employeeId?: string;
      floorId: string;
      dependsOn: string[];
      deadlineAt?: number;
      estimate: { workingHours: number; tokens: number; confidence: number; model: ModelId };
    }[];
  }[];
  meetings: { title: string; startsAt: number; purpose: string; milestoneKey?: string }[];
  prompts: { kind: 'capacity' | 'deadline' | 'order' | 'cost'; text: string }[];
  projectedTokens: number;
}
