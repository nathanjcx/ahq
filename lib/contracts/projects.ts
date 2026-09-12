import type { ModelId, TaskStatus } from './core';

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
  /** The project's channel, once anything has been posted to it. */
  channelId?: string;
}
/** One task of a project, as the project page lists it. */
export interface ProjectTask {
  id: string;
  title: string;
  status: TaskStatus;
  employeeId: string;
  employeeName: string;
  floorId?: string;
  milestoneId?: string;
  cadence: 'once' | 'daily';
  deadlineAt?: number;
  dependsOn: string[];
  createdAt: number;
  updatedAt: number;
  /** Why the task stopped, for a blocked or failed one. */
  error?: string;
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
