import { getFunctionName } from 'convex/server';
import { qaFixture } from '../fixture';
import type { FixtureQueries } from '@/components/shared/use-ui-query';
import type { PlanProjection, Project, ProjectTask, RoadmapProposal } from '@/lib/contracts';
import { uiApi } from '@/lib/ui-api';

/**
 * Projects as the fixture route shows them: a launch that is running and behind, a migration waiting
 * on the answers its planner asked for, a project whose planner is still working, and the two that
 * are over. The floors and employees are the dashboard fixture's own, so the pages agree.
 */

const DAY = 86_400_000;
/** Today at ten in the morning, so a roadmap always sits sensibly around the day it is looked at. */
const noon = Math.floor(Date.now() / DAY) * DAY + 10 * 3_600_000;
const at = (days: number) => noon + days * DAY;

const LAUNCH_FLOORS = ['proj_launch', 'proj_support'];

const launch: Project = {
  id: 'pr_launch',
  name: 'Spring launch',
  brief: 'Ship the March release: changelog, migration notes, and the customer announcement.',
  floorIds: LAUNCH_FLOORS,
  status: 'active',
  createdBy: 'user_dana',
  createdByName: 'Dana Okoye',
  createdAt: at(-21),
  updatedAt: at(-1),
  openTasks: 4,
  behindMilestones: 1,
  channelId: 'chan_launch',
  milestones: [
    {
      id: 'ms_notes',
      projectId: 'pr_launch',
      order: 0,
      title: 'Changelog and migration notes',
      description: 'Everything a customer needs to read before the release lands.',
      deadlineAt: at(-10),
      dependsOn: [],
      status: 'done',
      taskIds: ['pt_changelog', 'pt_pulls'],
    },
    {
      id: 'ms_announce',
      projectId: 'pr_launch',
      order: 1,
      title: 'Customer announcement',
      description: 'Announcement written, reviewed, and published to the status page.',
      deadlineAt: at(-2),
      dependsOn: ['ms_notes'],
      status: 'active',
      taskIds: ['pt_announce', 'pt_review', 'pt_publish'],
    },
    {
      id: 'ms_review',
      projectId: 'pr_launch',
      order: 2,
      title: 'Post-launch review',
      description: 'What customers said in the first week, and what to fix next.',
      deadlineAt: at(9),
      dependsOn: ['ms_announce'],
      status: 'planned',
      taskIds: ['pt_feedback'],
    },
  ],
};

const launchTasks: ProjectTask[] = [
  {
    id: 'pt_changelog',
    title: 'Write the changelog',
    status: 'completed',
    employeeId: 'emp_bruno',
    employeeName: 'Bruno',
    floorId: 'proj_launch',
    milestoneId: 'ms_notes',
    cadence: 'daily',
    deadlineAt: at(-11),
    dependsOn: [],
    createdAt: at(-20),
    updatedAt: at(-11),
  },
  {
    id: 'pt_pulls',
    title: 'Collect the merged pull requests',
    status: 'completed',
    employeeId: 'emp_ada',
    employeeName: 'Ada',
    floorId: 'proj_launch',
    milestoneId: 'ms_notes',
    cadence: 'once',
    deadlineAt: at(-14),
    dependsOn: [],
    createdAt: at(-20),
    updatedAt: at(-14),
  },
  {
    id: 'pt_announce',
    title: 'Draft the customer announcement',
    status: 'running',
    employeeId: 'emp_bruno',
    employeeName: 'Bruno',
    floorId: 'proj_launch',
    milestoneId: 'ms_announce',
    cadence: 'daily',
    deadlineAt: at(-1),
    dependsOn: ['pt_changelog'],
    createdAt: at(-9),
    updatedAt: at(0),
  },
  {
    id: 'pt_review',
    title: 'Review the announcement copy',
    status: 'waiting',
    employeeId: 'emp_ada',
    employeeName: 'Ada',
    floorId: 'proj_launch',
    milestoneId: 'ms_announce',
    cadence: 'daily',
    deadlineAt: at(1),
    dependsOn: ['pt_announce'],
    createdAt: at(-9),
    updatedAt: at(-1),
  },
  {
    id: 'pt_publish',
    title: 'Publish to the status page',
    status: 'blocked',
    employeeId: 'emp_mina',
    employeeName: 'Mina',
    floorId: 'proj_support',
    milestoneId: 'ms_announce',
    cadence: 'once',
    deadlineAt: at(2),
    dependsOn: ['pt_review'],
    createdAt: at(-9),
    updatedAt: at(-1),
    error: 'Slack refused the last publish, so this cannot run until the connection is restored.',
  },
  {
    id: 'pt_feedback',
    title: 'Collect launch feedback',
    status: 'queued',
    employeeId: 'emp_mina',
    employeeName: 'Mina',
    floorId: 'proj_support',
    milestoneId: 'ms_review',
    cadence: 'daily',
    deadlineAt: at(9),
    dependsOn: ['pt_publish'],
    createdAt: at(-9),
    updatedAt: at(-9),
  },
];

const estimate = (workingHours: number, tokens: number) => ({
  workingHours,
  tokens,
  confidence: 0.45,
  model: 'gpt-5.6-terra' as const,
});

const billingProposal: RoadmapProposal = {
  staffing: [
    {
      floorId: 'proj_support',
      employeeIds: ['emp_mina'],
      suggestedHires: [
        {
          versionId: 'ver_bruno',
          count: 2,
          reason: 'Three write-ups fall in the same week and Bruno is the only writer on the floor.',
        },
      ],
    },
  ],
  milestones: [
    {
      key: 'audit',
      title: 'Audit the billing events',
      description: 'Know exactly which events the old system emits before anything moves.',
      deadlineAt: at(6),
      dependsOn: [],
      tasks: [
        {
          key: 'map-events',
          title: 'Map every billing event',
          prompt: 'List every billing event the old system emits, with its payload and its consumers.',
          employeeId: 'emp_mina',
          floorId: 'proj_support',
          dependsOn: [],
          deadlineAt: at(4),
          estimate: estimate(6, 120_000),
        },
        {
          key: 'sample-invoices',
          title: 'Sample a hundred invoices',
          prompt: 'Take a hundred invoices across plans and record what the totals should be.',
          employeeId: 'emp_mina',
          floorId: 'proj_support',
          dependsOn: [],
          deadlineAt: at(6),
          estimate: estimate(4, 80_000),
        },
      ],
    },
    {
      key: 'migrate',
      title: 'Move the invoices',
      description: 'Write the migration, run it against a copy, and check the totals still agree.',
      deadlineAt: at(13),
      dependsOn: ['audit'],
      tasks: [
        {
          key: 'write-migration',
          title: 'Write the migration',
          prompt: 'Write the migration from the old billing events to the new ledger.',
          employeeId: 'emp_mina',
          floorId: 'proj_support',
          dependsOn: ['map-events'],
          deadlineAt: at(11),
          estimate: estimate(10, 260_000),
        },
        {
          key: 'verify-totals',
          title: 'Verify the totals',
          prompt: 'Re-run the sampled invoices against the new ledger and report every difference.',
          employeeId: 'emp_mina',
          floorId: 'proj_support',
          dependsOn: ['write-migration', 'sample-invoices'],
          deadlineAt: at(13),
          estimate: estimate(5, 140_000),
        },
      ],
    },
  ],
  meetings: [
    {
      title: 'Billing migration kickoff',
      startsAt: at(1),
      purpose: 'Agree the cutover window and who signs off the totals.',
      milestoneKey: 'audit',
    },
  ],
  prompts: [
    {
      kind: 'capacity',
      text: 'Support backlog has 3 tasks due in the week of the 13th and 1 instance. Hire more or move the deadline.',
    },
    {
      kind: 'deadline',
      text: '"Verify the totals" is due the same day as "Write the migration", which it depends on. Move one of the deadlines.',
    },
  ],
  projectedTokens: 600_000,
};

const billing: Project = {
  id: 'pr_billing',
  name: 'Billing migration',
  brief: 'Move invoicing onto the new ledger without a customer noticing.\n\nDeadline: in two weeks.',
  floorIds: ['proj_support'],
  status: 'planning',
  createdBy: 'user_dana',
  createdByName: 'Dana Okoye',
  createdAt: at(-2),
  updatedAt: at(0),
  openTasks: 0,
  behindMilestones: 0,
  milestones: [],
};

const onboarding: Project = {
  id: 'pr_onboarding',
  name: 'Onboarding refresh',
  brief: 'Rewrite the first-run experience so a new workspace does something useful in ten minutes.',
  floorIds: ['proj_launch'],
  status: 'planning',
  createdBy: 'user_ivan',
  createdByName: 'Ivan Petrov',
  createdAt: at(0),
  updatedAt: at(0),
  openTasks: 0,
  behindMilestones: 0,
  milestones: [],
};

const atlas: Project = {
  id: 'pr_atlas',
  name: 'Atlas data import',
  brief: 'Bring the Atlas account history into the warehouse and reconcile it.',
  floorIds: ['proj_support'],
  status: 'done',
  createdBy: 'user_dana',
  createdByName: 'Dana Okoye',
  createdAt: at(-60),
  updatedAt: at(-24),
  openTasks: 0,
  behindMilestones: 0,
  channelId: 'chan_atlas',
  milestones: [
    {
      id: 'ms_atlas_import',
      projectId: 'pr_atlas',
      order: 0,
      title: 'Import the history',
      description: 'Every account, every month, loaded and checked.',
      deadlineAt: at(-30),
      dependsOn: [],
      status: 'done',
      taskIds: ['pt_atlas_load'],
    },
    {
      id: 'ms_atlas_reconcile',
      projectId: 'pr_atlas',
      order: 1,
      title: 'Reconcile the totals',
      description: 'Warehouse totals match the source to the cent.',
      deadlineAt: at(-25),
      dependsOn: ['ms_atlas_import'],
      status: 'done',
      taskIds: ['pt_atlas_check'],
    },
  ],
};

const atlasTasks: ProjectTask[] = [
  {
    id: 'pt_atlas_load',
    title: 'Load the account history',
    status: 'completed',
    employeeId: 'emp_cyrus',
    employeeName: 'Cyrus',
    floorId: 'proj_support',
    milestoneId: 'ms_atlas_import',
    cadence: 'daily',
    deadlineAt: at(-30),
    dependsOn: [],
    createdAt: at(-58),
    updatedAt: at(-30),
  },
  {
    id: 'pt_atlas_check',
    title: 'Reconcile the monthly totals',
    status: 'completed',
    employeeId: 'emp_cyrus',
    employeeName: 'Cyrus',
    floorId: 'proj_support',
    milestoneId: 'ms_atlas_reconcile',
    cadence: 'once',
    deadlineAt: at(-25),
    dependsOn: ['pt_atlas_load'],
    createdAt: at(-58),
    updatedAt: at(-26),
  },
];

const ledger: Project = {
  id: 'pr_ledger',
  name: 'Ledger prototype',
  brief: 'An experiment in double-entry bookkeeping that the billing migration replaced.',
  floorIds: ['proj_support'],
  status: 'archived',
  createdBy: 'user_ivan',
  createdByName: 'Ivan Petrov',
  createdAt: at(-120),
  updatedAt: at(-70),
  openTasks: 0,
  behindMilestones: 0,
  milestones: [],
};

const projects: Project[] = [launch, billing, onboarding, atlas, ledger];
const tasksByProject: Record<string, ProjectTask[]> = {
  pr_launch: launchTasks,
  pr_atlas: atlasTasks,
};
const proposalsByProject: Record<string, RoadmapProposal> = { pr_billing: billingProposal };

function projection(projectedTokens: number): PlanProjection {
  const usedTokens = 4_120_000;
  const monthlyAllowance = 8_000_000;
  return {
    plan: 'subscription',
    usedTokens,
    projectedTokens,
    monthlyAllowance,
    allowanceUsed: (usedTokens + projectedTokens) / monthlyAllowance,
    overAllowance: usedTokens + projectedTokens > monthlyAllowance,
    unpricedModels: [],
    capacity: { instances: 8, maxConcurrentInstances: 6, runningShifts: 2, freeSlots: 4 },
  };
}

/** Query answers for the projects pages under the fixture route. */
export const projectsQueries: FixtureQueries = {
  [getFunctionName(uiApi.projects)]: projects,
  [getFunctionName(uiApi.project)]: ({ projectId }: { projectId: string }) => {
    const project = projects.find((entry) => entry.id === projectId) ?? launch;
    return { ...project, proposal: proposalsByProject[project.id] };
  },
  [getFunctionName(uiApi.projectTasks)]: ({ projectId }: { projectId: string }) =>
    tasksByProject[projectId] ?? [],
  [getFunctionName(uiApi.planProjection)]: ({ projectedTokens }: { projectedTokens: number }) =>
    projection(projectedTokens),
  // The marketplace workstream owns this answer; this one stands in until it lands.
  [getFunctionName(uiApi.listings)]: qaFixture.listings,
};
