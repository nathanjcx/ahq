import { useId } from 'react';
import {
  Brain,
  ChevronDown,
  ContactRound,
  Database,
  LockKeyhole,
  MessagesSquare,
  Settings2,
  Wrench,
} from 'lucide-react';
import type { ReactNode } from 'react';
import {
  AGENT_CONFIG_BOUNDS,
  ASTRA_MODEL,
  MEMORY_KINDS,
  MEMORY_SCOPES,
  REASONING_EFFORTS,
  type AgentConfig,
  type MemoryKind,
  type MemoryScope,
} from '../../shared/agent-config';
import type { Employee, Integration } from '../../shared/types';
import './agent-configuration.css';

interface AgentConfigurationProps {
  value: AgentConfig;
  onChange: (next: AgentConfig) => void;
  integrations: Integration[];
  employees: Employee[];
  employeeId?: string;
  disabled?: boolean;
}

const memoryLabels: Record<MemoryKind, [string, string]> = {
  working: ['Working context · scratchpad', 'Current task, progress, and next steps.'],
  episodic: ['Past work · work journal', 'What happened and what the employee learned.'],
  semantic: ['Facts and knowledge · fact cabinet', 'Useful facts, with their sources.'],
  procedural: ['Procedures · playbook shelf', 'Reusable instructions and ways of working.'],
  preference: ['Preferences · working agreement', 'Your stated choices and working preferences.'],
};
const scopeLabels: Record<MemoryScope, [string, string]> = {
  session: ['This session', 'Memory tied to the current session.'],
  employee: ['This employee', 'Private knowledge available across their sessions.'],
  workspace: ['Shared workspace', 'Knowledge shared with employees allowed this scope.'],
};
const reasoningLabels: Record<AgentConfig['reasoning'], string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Maximum',
};

function toggleItem<T>(items: T[], item: T, enabled: boolean): T[] {
  return enabled ? [...new Set([...items, item])] : items.filter((value) => value !== item);
}

function Section({
  title,
  summary,
  icon,
  children,
  open = false,
}: {
  title: string;
  summary: string;
  icon: ReactNode;
  children: ReactNode;
  open?: boolean;
}) {
  return (
    <details className="agent-config-section" open={open || undefined}>
      <summary tabIndex={0}>
        <span className="agent-config-section-icon" aria-hidden="true">
          {icon}
        </span>
        <span>
          <strong>{title}</strong>
          <small>{summary}</small>
        </span>
        <ChevronDown size={17} className="agent-config-chevron" aria-hidden="true" />
      </summary>
      <div className="agent-config-section-body">{children}</div>
    </details>
  );
}

function Choice({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="agent-config-choice">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        disabled={disabled}
      />
      <span>
        <strong>{label}</strong>
        <small>{hint}</small>
      </span>
    </label>
  );
}

function NumberSetting({
  label,
  hint,
  value,
  bounds,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  bounds: { min: number; max: number };
  onChange: (next: number) => void;
}) {
  const id = useId();
  return (
    <label className="agent-config-number" htmlFor={id}>
      <span>{label}</span>
      <input
        id={id}
        type="number"
        min={bounds.min}
        max={bounds.max}
        step={1}
        required
        value={value}
        aria-describedby={`${id}-hint`}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <small id={`${id}-hint`}>
        {hint} {bounds.min.toLocaleString()}–{bounds.max.toLocaleString()}.
      </small>
    </label>
  );
}

export function AgentConfiguration({
  value,
  onChange,
  integrations,
  employees,
  employeeId,
  disabled = false,
}: AgentConfigurationProps) {
  const id = useId();
  const teammates = employees.filter((employee) => employee.id !== employeeId);
  const missingIntegrations = value.tools.integrationIds.filter(
    (integrationId) => !integrations.some((integration) => integration.id === integrationId),
  );
  const missingTeammates = value.communication.teammateIds.filter(
    (teammateId) => !teammates.some((employee) => employee.id === teammateId),
  );
  const tools = (patch: Partial<AgentConfig['tools']>) =>
    onChange({ ...value, tools: { ...value.tools, ...patch } });
  const memory = (patch: Partial<AgentConfig['memory']>) =>
    onChange({ ...value, memory: { ...value.memory, ...patch } });
  const communication = (patch: Partial<AgentConfig['communication']>) =>
    onChange({ ...value, communication: { ...value.communication, ...patch } });
  const autonomy = (patch: Partial<AgentConfig['autonomy']>) =>
    onChange({ ...value, autonomy: { ...value.autonomy, ...patch } });
  const persona = (patch: Partial<AgentConfig['persona']>) =>
    onChange({ ...value, persona: { ...value.persona, ...patch } });
  const limitFields: { key: keyof AgentConfig['limits']; label: string; hint: string }[] = [
    {
      key: 'maxOutputTokens',
      label: 'Output tokens per response',
      hint: 'Includes reasoning and visible output.',
    },
    { key: 'maxRunTokens', label: 'Total tokens per run', hint: 'Input and output across the run.' },
    { key: 'maxToolCalls', label: 'Tool calls per run', hint: 'Zero disables tool execution.' },
    { key: 'maxTurns', label: 'Model turns per run', hint: 'Each continuation consumes a turn.' },
    {
      key: 'maxRuntimeMinutes',
      label: 'Run time in minutes',
      hint: 'Pause work when this limit is reached.',
    },
  ];
  return (
    <fieldset className="agent-configuration" disabled={disabled}>
      <legend>Agent configuration</legend>
      <div className="agent-config-intro">
        <div className="agent-config-model">
          <LockKeyhole size={16} aria-hidden="true" />
          <strong>Astra</strong>
          <code>{ASTRA_MODEL}</code>
        </div>
        <p>
          {value.reviewedAt
            ? `Configuration revision ${value.revision}. Changes apply when saved.`
            : 'Starter settings · review and change every choice below before running work.'}
        </p>
      </div>

      <Section
        title="Role charter and persona"
        summary={value.persona.purpose || 'Define their purpose, values, and working style'}
        icon={<ContactRound size={18} />}
        open
      >
        <p className="agent-config-hint">
          Their role charter sits beside the nameplate: a purpose, principles, and working style you choose.
        </p>
        <label htmlFor={`${id}-purpose`}>Purpose</label>
        <textarea
          id={`${id}-purpose`}
          rows={2}
          maxLength={2000}
          value={value.persona.purpose}
          onChange={(event) => persona({ purpose: event.target.value })}
          placeholder="What outcome does this employee own, and why does it matter?"
        />
        <h4>Values</h4>
        <p className="agent-config-hint">
          The principles they should use when making choices. Add, edit, or remove any value.
        </p>
        <div className="agent-persona-values">
          {value.persona.values.map((item, index) => (
            <div className="agent-persona-value" key={index}>
              <input
                aria-label={`Persona value ${index + 1}`}
                required
                maxLength={200}
                value={item}
                onChange={(event) =>
                  persona({
                    values: value.persona.values.map((entry, position) =>
                      position === index ? event.target.value : entry,
                    ),
                  })
                }
              />
              <button
                type="button"
                aria-label={`Remove persona value ${index + 1}`}
                onClick={() =>
                  persona({ values: value.persona.values.filter((_, position) => position !== index) })
                }
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="text-button agent-persona-add"
          disabled={value.persona.values.length >= 20}
          onClick={() => persona({ values: [...value.persona.values, ''] })}
        >
          Add a value
        </button>
        <div className="agent-persona-styles">
          <label htmlFor={`${id}-communication-style`}>
            Communication style
            <textarea
              id={`${id}-communication-style`}
              rows={3}
              maxLength={2000}
              value={value.persona.communicationStyle}
              onChange={(event) => persona({ communicationStyle: event.target.value })}
              placeholder="How should they explain results, uncertainty, and requests?"
            />
          </label>
          <label htmlFor={`${id}-collaboration-style`}>
            Collaboration style
            <textarea
              id={`${id}-collaboration-style`}
              rows={3}
              maxLength={2000}
              value={value.persona.collaborationStyle}
              onChange={(event) => persona({ collaborationStyle: event.target.value })}
              placeholder="How should they share context and coordinate with teammates?"
            />
          </label>
          <label htmlFor={`${id}-decision-style`}>
            Decision style
            <textarea
              id={`${id}-decision-style`}
              rows={3}
              maxLength={2000}
              value={value.persona.decisionStyle}
              onChange={(event) => persona({ decisionStyle: event.target.value })}
              placeholder="How should they compare options, weigh evidence, and escalate?"
            />
          </label>
        </div>
        <p className="agent-config-hint">
          These instructions shape the employee’s behavior. Tool access, approvals, memory scope, and limits
          remain the choices below.
        </p>
        <label htmlFor={`${id}-instructions`}>Working instructions</label>
        <textarea
          id={`${id}-instructions`}
          rows={4}
          maxLength={12_000}
          value={value.instructions}
          onChange={(event) => onChange({ ...value, instructions: event.target.value })}
          placeholder="Describe responsibilities, what good work looks like, and when to ask for your input."
        />
        <p className="agent-config-hint">
          The employee’s name, role, personality, and workspace goal are also included.{' '}
          {value.instructions.length.toLocaleString()}/12,000 characters.
        </p>
      </Section>

      <Section
        title="Thinking and limits"
        summary={`${reasoningLabels[value.reasoning]} reasoning · ${value.limits.maxTurns} turns · ${value.limits.maxRuntimeMinutes} min`}
        icon={<Brain size={18} />}
      >
        <label htmlFor={`${id}-reasoning`}>Reasoning effort</label>
        <select
          id={`${id}-reasoning`}
          value={value.reasoning}
          onChange={(event) =>
            onChange({ ...value, reasoning: event.target.value as AgentConfig['reasoning'] })
          }
        >
          {REASONING_EFFORTS.map((effort) => (
            <option value={effort} key={effort}>
              {reasoningLabels[effort]}
            </option>
          ))}
        </select>
        <p className="agent-config-hint">
          More effort gives the model more room to reason and can use more time and tokens. These are
          application limits, not a price estimate.
        </p>
        <div className="agent-config-grid">
          {limitFields.map(({ key, label, hint }) => (
            <NumberSetting
              key={key}
              label={label}
              hint={hint}
              value={value.limits[key]}
              bounds={AGENT_CONFIG_BOUNDS[key]}
              onChange={(next) => onChange({ ...value, limits: { ...value.limits, [key]: next } })}
            />
          ))}
        </div>
        {value.limits.maxRunTokens < value.limits.maxOutputTokens && (
          <p className="agent-config-error" role="alert">
            The run token budget must cover at least one response token limit.
          </p>
        )}
      </Section>

      <Section
        title="Tools and access"
        summary={`${[value.tools.webSearch, value.tools.dataAnalysis, value.tools.workspaceRead, value.tools.artifactWrite].filter(Boolean).length} built-in tools · ${value.tools.integrationIds.length} integrations`}
        icon={<Wrench size={18} />}
      >
        <div className="agent-config-choices">
          <Choice
            label="Web search"
            hint="Research terminal: search public web sources during a task."
            checked={value.tools.webSearch}
            onChange={(webSearch) => tools({ webSearch })}
          />
          <Choice
            label="Data analysis"
            hint="Analysis bench: use the hosted code interpreter for calculations and analysis."
            checked={value.tools.dataAnalysis}
            onChange={(dataAnalysis) => tools({ dataAnalysis })}
          />
          <Choice
            label="Read workspace context"
            hint="Library reading desk: read authorized workspace information and selected folder copies."
            checked={value.tools.workspaceRead}
            onChange={(workspaceRead) => tools({ workspaceRead })}
          />
          <Choice
            label="Create artifacts"
            hint="Drafting bench and out tray: save work as artifacts in this workspace."
            checked={value.tools.artifactWrite}
            onChange={(artifactWrite) => tools({ artifactWrite })}
          />
        </div>
        <h4>Connected integrations</h4>
        <p className="agent-config-hint">
          Choose services by connection. Descriptive skills do not grant access. Tool approval is configured
          under Autonomy.
        </p>
        {integrations.length === 0 && (
          <p className="agent-config-empty">
            No integrations are connected. Add connections in Workspace settings.
          </p>
        )}
        {integrations.map((integration) => (
          <Choice
            key={integration.id}
            label={integration.name}
            hint={
              integration.configured
                ? integration.url
                : 'Connection is unavailable; reconnect it in Settings.'
            }
            checked={value.tools.integrationIds.includes(integration.id)}
            disabled={!integration.configured && !value.tools.integrationIds.includes(integration.id)}
            onChange={(checked) =>
              tools({ integrationIds: toggleItem(value.tools.integrationIds, integration.id, checked) })
            }
          />
        ))}
        {missingIntegrations.map((integrationId) => (
          <Choice
            key={integrationId}
            label="Unavailable integration"
            hint={`Saved connection ${integrationId}. Clear it or reconnect it in Settings.`}
            checked
            onChange={() =>
              tools({ integrationIds: value.tools.integrationIds.filter((item) => item !== integrationId) })
            }
          />
        ))}
        <p className="agent-config-hint">
          Sharing selected folder copies with Astra is confirmed separately when starting the assignment.
        </p>
      </Section>

      <Section
        title="Memory"
        summary={
          value.memory.enabled
            ? `${value.memory.kinds.length} types · ${value.memory.scopes.length} scopes · ${value.memory.retentionDays} days`
            : 'Memory is off'
        }
        icon={<Database size={18} />}
      >
        <Choice
          label="Use memory"
          hint="Retrieve and maintain typed knowledge within the scopes selected below."
          checked={value.memory.enabled}
          onChange={(enabled) => memory({ enabled })}
        />
        <h4>Memory types</h4>
        {MEMORY_KINDS.map((kind) => (
          <Choice
            key={kind}
            label={memoryLabels[kind][0]}
            hint={memoryLabels[kind][1]}
            checked={value.memory.kinds.includes(kind)}
            onChange={(checked) => memory({ kinds: toggleItem(value.memory.kinds, kind, checked) })}
          />
        ))}
        <h4>Memory scope</h4>
        {MEMORY_SCOPES.map((scope) => (
          <Choice
            key={scope}
            label={scopeLabels[scope][0]}
            hint={scopeLabels[scope][1]}
            checked={value.memory.scopes.includes(scope)}
            onChange={(checked) => memory({ scopes: toggleItem(value.memory.scopes, scope, checked) })}
          />
        ))}
        <label htmlFor={`${id}-memory-write`}>Saving new memory</label>
        <select
          id={`${id}-memory-write`}
          value={value.memory.write}
          onChange={(event) => memory({ write: event.target.value as AgentConfig['memory']['write'] })}
        >
          <option value="off">Read only · do not save new memory</option>
          <option value="propose">Propose memory for review</option>
          <option value="automatic">Save memory automatically</option>
        </select>
        <div className="agent-config-grid">
          <NumberSetting
            label="Retention in days"
            hint="How long a memory remains available."
            value={value.memory.retentionDays}
            bounds={AGENT_CONFIG_BOUNDS.retentionDays}
            onChange={(retentionDays) => memory({ retentionDays })}
          />
          <NumberSetting
            label="Maximum memory entries"
            hint="The employee’s memory entry limit."
            value={value.memory.maxEntries}
            bounds={AGENT_CONFIG_BOUNDS.maxEntries}
            onChange={(maxEntries) => memory({ maxEntries })}
          />
          <NumberSetting
            label="Memory context characters"
            hint="Maximum recalled text per context."
            value={value.memory.maxContextChars}
            bounds={AGENT_CONFIG_BOUNDS.maxContextChars}
            onChange={(maxContextChars) => memory({ maxContextChars })}
          />
        </div>
        <p className="agent-config-hint">
          Turning memory off keeps these choices for later. Existing records can be reviewed and removed in
          the employee’s Memory view.
        </p>
        {value.memory.enabled && (!value.memory.kinds.length || !value.memory.scopes.length) && (
          <p className="agent-config-empty">
            No memory will be available until at least one type and one scope are selected.
          </p>
        )}
      </Section>

      <Section
        title="Communication"
        summary={`${value.communication.sendMessages ? 'Can send' : 'Cannot send'} · ${value.communication.receiveMessages ? 'can receive' : 'cannot receive'} · ${value.communication.teammateIds.length ? `${value.communication.teammateIds.length} selected teammates` : 'all teammates'}`}
        icon={<MessagesSquare size={18} />}
      >
        <Choice
          label="Receive announcements"
          hint="Include announcements from you in the employee’s context."
          checked={value.communication.receiveAnnouncements}
          onChange={(receiveAnnouncements) => communication({ receiveAnnouncements })}
        />
        <Choice
          label="Receive messages"
          hint="Accept direct messages and teammate handoffs."
          checked={value.communication.receiveMessages}
          onChange={(receiveMessages) => communication({ receiveMessages })}
        />
        <Choice
          label="Send teammate messages"
          hint="Ask coworkers for context, share findings, and hand off work inside AHQ."
          checked={value.communication.sendMessages}
          onChange={(sendMessages) => communication({ sendMessages })}
        />
        <h4>Teammate access</h4>
        <p className="agent-config-hint">
          No selections means all current and future teammates. Select names to restrict access; turn
          messaging off to block it entirely.
        </p>
        {teammates.map((employee) => (
          <Choice
            key={employee.id}
            label={employee.name}
            hint={employee.jobTitle}
            checked={value.communication.teammateIds.includes(employee.id)}
            onChange={(checked) =>
              communication({
                teammateIds: toggleItem(value.communication.teammateIds, employee.id, checked),
              })
            }
          />
        ))}
        {missingTeammates.map((teammateId) => (
          <Choice
            key={teammateId}
            label="Unavailable teammate"
            hint={`Saved employee ${teammateId}. Clear this selection to remove it.`}
            checked
            onChange={() =>
              communication({
                teammateIds: value.communication.teammateIds.filter((item) => item !== teammateId),
              })
            }
          />
        ))}
        {!teammates.length && (
          <p className="agent-config-empty">Other employees will appear here when they join the workspace.</p>
        )}
        <Choice
          label="Respond automatically"
          hint="Allow incoming messages to trigger work when Autonomy is also set to Start on message."
          checked={value.communication.autoRespond}
          onChange={(autoRespond) => communication({ autoRespond })}
        />
        <NumberSetting
          label="Maximum message handoffs"
          hint="Bounds a conversation’s automatic handoffs. Zero prevents handoffs."
          value={value.communication.maxHandoffs}
          bounds={AGENT_CONFIG_BOUNDS.maxHandoffs}
          onChange={(maxHandoffs) => communication({ maxHandoffs })}
        />
      </Section>

      <Section
        title="Autonomy and review"
        summary={`${value.autonomy.initiative === 'assigned-only' ? 'Work when assigned' : 'Start on message'} · ${value.autonomy.completionReview ? 'review finished work' : 'finish without review'}`}
        icon={<Settings2 size={18} />}
      >
        <label htmlFor={`${id}-initiative`}>When to start work</label>
        <select
          id={`${id}-initiative`}
          value={value.autonomy.initiative}
          onChange={(event) =>
            autonomy({ initiative: event.target.value as AgentConfig['autonomy']['initiative'] })
          }
        >
          <option value="assigned-only">When you assign work</option>
          <option value="on-message">Start on message</option>
        </select>
        <p className="agent-config-hint">
          Starting from a message also requires Receive messages and Respond automatically. Each run uses the
          limits above.
        </p>
        <label htmlFor={`${id}-tool-approval`}>Tool action approval</label>
        <select
          id={`${id}-tool-approval`}
          value={value.autonomy.toolApproval}
          onChange={(event) =>
            autonomy({ toolApproval: event.target.value as AgentConfig['autonomy']['toolApproval'] })
          }
        >
          <option value="ask">Ask before tool actions</option>
          <option value="allow">Allow permitted tool actions</option>
        </select>
        <p className="agent-config-hint">
          This applies to creating artifacts, sending teammate messages, saving memory automatically, and
          using integrations. Allow authorizes actions within your selected tools and permissions, including
          external changes exposed by those integrations.
        </p>
        <Choice
          label="Review finished work"
          hint="Bring completed work to Needs you before marking it complete."
          checked={value.autonomy.completionReview}
          onChange={(completionReview) => autonomy({ completionReview })}
        />
      </Section>
    </fieldset>
  );
}

export default AgentConfiguration;
