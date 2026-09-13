import { strToU8, zipSync } from 'fflate';
import OpenAI from 'openai';
import type { TokenUsage } from 'openai/resources/beta/agents/agents';
import type { SessionCreateParamsNonStreaming } from 'openai/resources/beta/agents/sessions/sessions';
import type { TaskContext } from '../../services/types';
import type { EmployeeKind, ModelId, TaskKind } from '../contracts';
import {
  FLOOR_RULES,
  MEMORY_RULES,
  PACING_RULES,
  TRIAGE_RULES,
  composeInstructions,
  deliverableRules,
} from '../instructions';
import { query, mutate } from './backend';
import { compileWorkingMemory, type WorkingMemory, type WorkingMemoryInputs } from './memory';
import { requiredEnv } from './secrets';
import { toolPolicy } from './tool-policy';
import { untrustedBlock } from './untrusted';

let client: OpenAI | undefined;
export function agentsClient() {
  return (client ??= new OpenAI({ apiKey: requiredEnv('OPENAI_API_KEY'), maxRetries: 0, timeout: 60_000 }));
}

/** The internal tool servers the gateway serves, one path segment each under `/mcp/`. */
const INTERNAL_SERVERS = ['floor', 'memory', 'shift', 'studio', 'audit', 'triage', 'janitor'] as const;
export type InternalServer = (typeof INTERNAL_SERVERS)[number];

export function isInternalServer(value: string): value is InternalServer {
  return (INTERNAL_SERVERS as readonly string[]).includes(value);
}

const SERVER_LABELS: Record<InternalServer, string> = {
  floor: 'astra_floor',
  memory: 'astra_memory',
  shift: 'astra_shift',
  studio: 'astra_studio',
  audit: 'astra_audit',
  triage: 'astra_triage',
  janitor: 'astra_janitor',
};

/**
 * What each server advertises, so a session can name its tools without asking the gateway. The
 * gateway builds the same lists from `services/gateway/servers/*`; the runtime harness asserts the
 * two agree for every role, because a session that names a tool the gateway does not serve would
 * fail on the first call rather than at startup.
 */
const SERVER_TOOLS: Record<InternalServer, string[]> = {
  floor: ['floor_post', 'floor_handoff'],
  memory: ['remember', 'recall', 'read_memory', 'read_board'],
  shift: ['submit_report', 'submit_summary'],
  studio: ['generate_image'],
  audit: ['read_reports', 'read_journal', 'read_artifact', 'read_memory', 'read_channel', 'submit_findings'],
  triage: ['report_reproduction', 'resolve_alert', 'file_incident_report'],
  janitor: ['merge', 'contest', 'archive', 'promote', 'read_memory'],
};

export function internalServerLabel(server: InternalServer) {
  return SERVER_LABELS[server];
}

export function internalServerTools(server: InternalServer) {
  return SERVER_TOOLS[server];
}

/**
 * The role matrix, in one place, read by the worker when it builds a session and by the gateway when
 * it answers a request under the same run token. A worker never sees the audit, triage, or janitor
 * servers; an auditor sees only audit; the janitor sees only janitor and memory; triage sees triage,
 * memory, and its floor. The gateway is the enforcement point — the worker's copy only keeps it from
 * advertising a server the token would be refused for.
 */
export function serversFor(employeeKind: EmployeeKind, taskKind: TaskKind): InternalServer[] {
  if (employeeKind === 'auditor') return ['audit'];
  if (employeeKind === 'janitor') return ['janitor', 'memory'];
  if (employeeKind === 'triage') return ['triage', 'memory', 'floor'];
  // A worker's meeting and wrap-up turns are the same instance on a hidden session, so they keep the
  // same reach; `shift` is where a report and a task summary are filed, `studio` renders images.
  return taskKind === 'work' || taskKind === 'meeting'
    ? ['memory', 'floor', 'shift', 'studio']
    : ['memory', 'shift'];
}

/** Provider integrations are for hired employees. A reserved kind reaches a provider only through triage. */
function reachesProviders(employeeKind: EmployeeKind) {
  return employeeKind === 'worker';
}

export interface SessionOptions {
  /** Overrides the role matrix for one turn, for example a planner turn that needs no tools at all. */
  servers?: InternalServer[];
  /** The model the job asked for: an overnight shift runs on the instance's cheap model. */
  model?: ModelId;
  /** Replaces the employee's own instructions, for the turns the platform writes the brief for. */
  instructions?: string;
}

export function sessionConfiguration(
  context: TaskContext,
  options: SessionOptions = {},
): SessionCreateParamsNonStreaming {
  const { employeeVersion: version, task, employee } = context;
  const name = 'employee';
  const files: Record<string, Uint8Array> = {
    [`${name}/.codex-plugin/plugin.json`]: strToU8(
      JSON.stringify({ name, version: '1.0.0', description: 'Private employee skills' }),
    ),
  };
  version.skills.forEach((skill, index) => {
    const slug = `skill-${index + 1}`;
    files[`${name}/skills/${slug}/SKILL.md`] = strToU8(
      `---\nname: ${slug}\ndescription: ${JSON.stringify(skill.description || skill.name)}\n---\n\n${skill.content}`,
    );
  });
  const gateway = requiredEnv('MCP_GATEWAY_URL').replace(/\/$/, '');
  const workshop = version.workshop;
  const internal = (options.servers ?? serversFor(employee.kind, task.kind)).filter(
    (server) => (server !== 'floor' || context.floor) && (server !== 'studio' || workshop?.tools.length),
  );
  const mcpServer = (label: string, allowed: string[], target: string, required: boolean) => ({
    type: 'mcp' as const,
    server_label: label,
    allowed_tools: allowed,
    required,
    connection_origin: 'service' as const,
    transport: {
      type: 'http' as const,
      server_url: `${gateway}/mcp/${encodeURIComponent(target)}`,
      authorization: `Bearer ${context.runToken}`,
    },
  });
  const tools = reachesProviders(employee.kind)
    ? context.connections.flatMap((connection) => {
        const caps = version.capabilities.filter((cap) => cap.provider === connection.provider);
        const allowed = connection.allowedTools.filter(
          (tool) =>
            caps.some((cap) => cap.tools.includes(tool)) &&
            toolPolicy(context.policies, connection.provider, tool).mode !== 'blocked',
        );
        if (!allowed.length) return [];
        return [
          mcpServer(
            `${connection.provider.replaceAll('-', '_')}_${connection.id}`,
            allowed,
            connection.id,
            caps.some((cap) => !cap.optional),
          ),
        ];
      })
    : [];
  // Internal servers are ours: no provider, no policy row, no proposal.
  for (const server of internal)
    tools.push(
      mcpServer(
        SERVER_LABELS[server],
        server === 'studio' ? (workshop?.tools ?? []) : SERVER_TOOLS[server],
        server,
        false,
      ),
    );
  const roleRules = [
    PACING_RULES,
    ...(internal.includes('memory') ? [MEMORY_RULES] : []),
    ...(internal.includes('floor') ? [FLOOR_RULES] : []),
    ...deliverableRules(workshop),
    ...(internal.includes('triage') ? [TRIAGE_RULES] : []),
  ];
  return {
    agent: {
      model: options.model ?? task.model,
      instructions: composeInstructions({
        roleRules,
        persona: version.persona,
        instructions: options.instructions ?? version.instructions,
      }),
      multi_agent: { enabled: false },
      tools,
    },
    environment: {
      type: 'openai_hosted',
      network: { access: 'disabled' },
      ...(workshop?.libraries.length ? { packages: { python: workshop.libraries } } : {}),
      plugins: version.skills.length
        ? [
            {
              name,
              description: 'Private employee skills',
              type: 'inline',
              source: {
                type: 'base64',
                media_type: 'application/zip',
                data: Buffer.from(zipSync(files)).toString('base64'),
              },
            },
          ]
        : [],
    },
    metadata: { ahq_task_id: task.id, ahq_version_id: version.id },
    stream: false,
  };
}

/** Cumulative session token usage. The app records usage; it never prices it. */
export function sessionUsage(usage: TokenUsage) {
  return {
    input: usage.input_tokens,
    cached: Math.min(usage.input_tokens, usage.input_tokens_details.cached_tokens),
    output: usage.output_tokens,
  };
}

interface PacingRow {
  pacing: 'ahead' | 'on_track' | 'behind' | 'unknown';
  workingHoursLeft: number;
  deadlineAt?: number;
  reportedAt?: number;
}

interface MeetingRow {
  id: string;
  title: string;
  startsAt: number;
  agenda: string[];
  purpose: string;
}

interface ProjectContextRow {
  project?: { id: string; name: string; brief: string };
  milestone?: { id: string; title: string; description: string; deadlineAt?: number } | null;
  cadence: string;
  deadlineAt?: number;
  dependencies: { id: string; title: string; status: string }[];
}

const PACING_NOTES: Record<PacingRow['pacing'], string> = {
  ahead: 'Ahead of the deadline on your own last report.',
  on_track: 'On track on your own last report.',
  behind:
    'Behind on your own last report. Document what cannot be finished by the deadline and bring it to the next meeting.',
  unknown: 'No confidence reported yet; give one in this shift’s report.',
};

function when(at?: number) {
  return at ? new Date(at).toISOString().replace('T', ' ').slice(0, 16) : 'none';
}

/** The Schedule section every turn opens with: the clock, the plan, and the pace. */
function scheduleLines(
  pacing: PacingRow,
  meetings: MeetingRow[],
  project: ProjectContextRow,
): { heading: string; lines: string[] } {
  const lines = [
    `- Deadline: ${when(pacing.deadlineAt)}`,
    `- Working hours left before it: ${Math.max(0, Math.round(pacing.workingHoursLeft * 10) / 10)}`,
    `- Pacing: ${PACING_NOTES[pacing.pacing]}`,
  ];
  const next = meetings[0];
  if (next) {
    lines.push(`- Next meeting: ${next.title} at ${when(next.startsAt)}`);
    // The clock and the pace are this platform's own words; the agenda is not. Escalated audit
    // findings land on it verbatim, so it arrives as material inside a fence.
    if (next.agenda.length) lines.push('- Agenda:', untrustedBlock(next.agenda.join('\n')));
  }
  if (project.milestone)
    lines.push(
      `- Milestone: ${project.milestone.title} (due ${when(project.milestone.deadlineAt)})`,
      ...(project.milestone.description ? [`- Milestone brief: ${project.milestone.description}`] : []),
    );
  if (project.dependencies.length)
    lines.push(
      `- Depends on: ${project.dependencies.map((one) => `${one.title} (${one.status})`).join('; ')}`,
    );
  return { heading: 'Schedule', lines };
}

export interface TurnMemoryOptions {
  title?: string;
  /** Extra sections a caller adds after the schedule, such as a meeting agenda or a finding. */
  sections?: { heading: string; lines: string[] }[];
}

/**
 * The Working memory block a turn opens with: the compiled claims of every scope the task reads, the
 * floor's recent summaries, and the schedule the day is paced against. Reading is recorded after the
 * block is built, so the agent budget evicts on what actually reached a model rather than on what
 * was merely available.
 */
export async function workingMemory(taskId: string, options: TurnMemoryOptions = {}): Promise<WorkingMemory> {
  const inputs = await query<WorkingMemoryInputs & { workspaceId: string; employeeId: string }>(
    'services/memory:compileInputs',
    { taskId },
  );
  const [pacing, meetings, project] = await Promise.all([
    query<PacingRow>('services/schedule:pacing', { taskId }),
    query<MeetingRow[]>('services/calendar:upcoming', {
      workspaceId: inputs.workspaceId,
      employeeId: inputs.employeeId,
      limit: 1,
    }),
    query<ProjectContextRow>('services/projects:projectContext', { taskId }),
  ]);
  const compiled = compileWorkingMemory(inputs, {
    title: options.title,
    sections: [scheduleLines(pacing, meetings, project), ...(options.sections ?? [])],
  });
  if (compiled.usedIds.length) await mutate('services/memory:touch', { ids: compiled.usedIds });
  return compiled;
}
