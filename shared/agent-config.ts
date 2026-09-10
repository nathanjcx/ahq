import { z } from 'zod';

export const ASTRA_MODEL = 'gpt-6-astra' as const;
export const AstraModelSchema = z.literal(ASTRA_MODEL);
export const REASONING_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export const MEMORY_KINDS = ['working', 'episodic', 'semantic', 'procedural', 'preference'] as const;
export const MEMORY_SCOPES = ['session', 'employee', 'workspace'] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];
export type MemoryKind = (typeof MEMORY_KINDS)[number];
export type MemoryScope = (typeof MEMORY_SCOPES)[number];

export const AgentPersonaSchema = z.strictObject({
  purpose: z.string().max(2_000),
  values: z.array(z.string().trim().min(1).max(200)).max(20),
  communicationStyle: z.string().max(2_000),
  collaborationStyle: z.string().max(2_000),
  decisionStyle: z.string().max(2_000),
});
export type AgentPersona = z.infer<typeof AgentPersonaSchema>;
export function defaultAgentPersona(): AgentPersona {
  return {
    purpose: 'Own the assigned outcome, make useful progress, and bring back results supported by evidence.',
    values: ['Accuracy', 'Initiative', 'Accountability', 'Respect for user choices'],
    communicationStyle:
      'Be plain, concise, and candid. Lead with the result, explain uncertainty, and make requests specific.',
    collaborationStyle:
      'Share relevant context, ask teammates for expertise, and make clear handoffs with ownership and success criteria.',
    decisionStyle:
      'Compare realistic options, state assumptions, prefer reversible progress, and escalate consequential choices.',
  };
}

// These are application limits, shared by validation, the editor, and execution.
export const AGENT_CONFIG_BOUNDS = {
  maxOutputTokens: { min: 256, max: 64_000 },
  maxRunTokens: { min: 1_024, max: 1_000_000 },
  maxToolCalls: { min: 0, max: 200 },
  maxTurns: { min: 1, max: 100 },
  maxRuntimeMinutes: { min: 1, max: 240 },
  retentionDays: { min: 1, max: 3_650 },
  maxEntries: { min: 1, max: 10_000 },
  maxContextChars: { min: 1_000, max: 200_000 },
  maxHandoffs: { min: 0, max: 50 },
} as const;
const boundedInteger = (bounds: { min: number; max: number }) =>
  z.number().int().min(bounds.min).max(bounds.max);
const ids = (maximum: number) =>
  z
    .array(z.string().trim().min(1).max(100))
    .max(maximum)
    .refine((value) => new Set(value).size === value.length, 'Choose each item only once.');

export const AgentConfigSchema = z.strictObject({
  version: z.literal(1),
  revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  reviewedAt: z.string().datetime().optional(),
  model: AstraModelSchema,
  instructions: z.string().max(12_000),
  persona: AgentPersonaSchema.default(defaultAgentPersona),
  reasoning: z.enum(REASONING_EFFORTS),
  limits: z
    .strictObject({
      maxOutputTokens: boundedInteger(AGENT_CONFIG_BOUNDS.maxOutputTokens),
      maxRunTokens: boundedInteger(AGENT_CONFIG_BOUNDS.maxRunTokens),
      maxToolCalls: boundedInteger(AGENT_CONFIG_BOUNDS.maxToolCalls),
      maxTurns: boundedInteger(AGENT_CONFIG_BOUNDS.maxTurns),
      maxRuntimeMinutes: boundedInteger(AGENT_CONFIG_BOUNDS.maxRuntimeMinutes),
    })
    .refine((value) => value.maxRunTokens >= value.maxOutputTokens, {
      path: ['maxRunTokens'],
      message: 'The run token budget must cover at least one response token limit.',
    }),
  tools: z.strictObject({
    webSearch: z.boolean(),
    dataAnalysis: z.boolean(),
    workspaceRead: z.boolean(),
    artifactWrite: z.boolean(),
    integrationIds: ids(100),
  }),
  memory: z.strictObject({
    enabled: z.boolean(),
    kinds: z
      .array(z.enum(MEMORY_KINDS))
      .max(MEMORY_KINDS.length)
      .refine((value) => new Set(value).size === value.length, 'Choose each memory type only once.'),
    scopes: z
      .array(z.enum(MEMORY_SCOPES))
      .max(MEMORY_SCOPES.length)
      .refine((value) => new Set(value).size === value.length, 'Choose each memory scope only once.'),
    write: z.enum(['off', 'propose', 'automatic']),
    retentionDays: boundedInteger(AGENT_CONFIG_BOUNDS.retentionDays),
    maxEntries: boundedInteger(AGENT_CONFIG_BOUNDS.maxEntries),
    maxContextChars: boundedInteger(AGENT_CONFIG_BOUNDS.maxContextChars),
  }),
  communication: z.strictObject({
    receiveAnnouncements: z.boolean(),
    receiveMessages: z.boolean(),
    sendMessages: z.boolean(),
    teammateIds: ids(50),
    autoRespond: z.boolean(),
    maxHandoffs: boundedInteger(AGENT_CONFIG_BOUNDS.maxHandoffs),
  }),
  autonomy: z.strictObject({
    completionReview: z.boolean(),
    toolApproval: z.enum(['ask', 'allow']),
    initiative: z.enum(['assigned-only', 'on-message']),
  }),
});
export type AgentConfig = z.infer<typeof AgentConfigSchema>;

export function defaultAgentConfig(): AgentConfig {
  return {
    version: 1,
    revision: 1,
    model: ASTRA_MODEL,
    instructions: '',
    persona: defaultAgentPersona(),
    reasoning: 'high',
    limits: {
      maxOutputTokens: 12_000,
      maxRunTokens: 120_000,
      maxToolCalls: 40,
      maxTurns: 12,
      maxRuntimeMinutes: 30,
    },
    tools: {
      webSearch: false,
      dataAnalysis: false,
      workspaceRead: true,
      artifactWrite: true,
      integrationIds: [],
    },
    memory: {
      enabled: true,
      kinds: [...MEMORY_KINDS],
      scopes: ['employee'],
      write: 'propose',
      retentionDays: 90,
      maxEntries: 1_000,
      maxContextChars: 24_000,
    },
    communication: {
      receiveAnnouncements: true,
      receiveMessages: true,
      sendMessages: true,
      teammateIds: [],
      autoRespond: false,
      maxHandoffs: 8,
    },
    autonomy: {
      completionReview: true,
      toolApproval: 'ask',
      initiative: 'assigned-only',
    },
  };
}

// Only a missing configuration receives defaults. Invalid saved settings must fail visibly.
export function resolveAgentConfig(input?: unknown): AgentConfig {
  return AgentConfigSchema.parse(input === undefined ? defaultAgentConfig() : input);
}

export function formatAgentPersona(config: AgentConfig): string {
  const persona = AgentPersonaSchema.parse(config.persona ?? defaultAgentPersona());
  return [
    'Configured employee persona',
    `Purpose: ${persona.purpose || 'Use the employee role and current assignment.'}`,
    `Values: ${persona.values.length ? persona.values.join('; ') : 'Follow the user’s instructions and configured permissions.'}`,
    `Communication style: ${persona.communicationStyle || 'Use clear, direct language.'}`,
    `Collaboration style: ${persona.collaborationStyle || 'Coordinate through permitted teammate tools when useful.'}`,
    `Decision style: ${persona.decisionStyle || 'State assumptions and respect configured approval requirements.'}`,
    'Persona shapes how you work; it does not expand tool permissions, memory access, or run limits.',
  ].join('\n');
}
