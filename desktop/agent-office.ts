import { randomUUID } from 'node:crypto';
import type { AppState, CloudSession, Employee } from '../shared/types';
import { resolveAgentConfig } from '../shared/agent-config';
import type { EmployeeTools, OfficeMessage } from './agent-tools';
import type { HostedEmployees } from './hosted';

export type Delivery = { employeeId: string; session?: CloudSession; error?: string };
type SessionRuntime = Pick<HostedEmployees, 'owns' | 'peek' | 'start' | 'continue' | 'sessionFor'>;

/** Coordinates real sessions; workspace writes are short and serialized by the host. */
export class AgentOffice {
  private deliveringEmployees = new Set<string>();
  private employeeQueues = new Map<string, Promise<unknown>>();
  constructor(
    private load: () => Promise<AppState | null>,
    private mutate: (change: (state: AppState) => AppState, reason?: string) => Promise<void>,
    private persist: (employeeId: string, session: CloudSession) => Promise<void>,
    private hosted: SessionRuntime,
    private tools: EmployeeTools,
  ) {}

  async message(channel: string, text: string): Promise<Delivery[]> {
    const state = await this.load();
    if (!state) throw new Error('Open your workspace first.');
    const broadcast = channel === 'announce' || channel === 'team';
    const recipients = state.employees.filter((employee) => {
      const config = resolveAgentConfig(employee.agent);
      return (broadcast || employee.id === channel) && (channel === 'announce'
        ? config.communication.receiveAnnouncements : config.communication.receiveMessages);
    });
    if (!recipients.length) throw new Error('No employee can receive this message. Review their communication settings.');
    await this.mutate((latest) => ({ ...latest, messages: [...latest.messages, {
      id: randomUUID(), authorId: 'you', channel, text, time: new Date().toISOString(),
    }] }), 'Manager message');
    return Promise.all(recipients.map(async (employee) => {
      try {
        const session = await this.invoke(employee.id, `${channel === 'announce' ? 'Announcement' : 'Message'} from your manager:\n${text}`);
        return { employeeId: employee.id, session };
      } catch (error) {
        return { employeeId: employee.id, error: error instanceof Error ? error.message : 'Delivery failed.' };
      }
    }));
  }

  async invoke(employeeId: string, text: string, depth = 0): Promise<CloudSession> {
    return this.enqueue(employeeId, async () => {
      const state = await this.load();
      const employee = state?.employees.find((item) => item.id === employeeId);
      if (!state || !employee) throw new Error('This employee is no longer in the office.');
      return this.run(employee, state, text, depth);
    });
  }

  private enqueue<T>(employeeId: string, action: () => Promise<T>): Promise<T> {
    const previous = this.employeeQueues.get(employeeId) ?? Promise.resolve();
    const work = previous.catch(() => undefined).then(action);
    this.employeeQueues.set(employeeId, work);
    void work.finally(() => {
      if (this.employeeQueues.get(employeeId) === work) this.employeeQueues.delete(employeeId);
    }).catch(() => undefined);
    return work;
  }

  private async run(employee: Employee, state: AppState, text: string, depth: number): Promise<CloudSession> {
    const config = resolveAgentConfig(employee.agent);
    if (!Number.isInteger(depth) || depth < 0 || depth > config.communication.maxHandoffs) throw new Error('The configured employee handoff limit was reached.');
    try {
      const result = employee.sessionId && this.hosted.owns(employee.sessionId)
        ? await this.hosted.continue(employee.sessionId, text, true, { employee, state, depth })
        : await this.hosted.start(employee, text, state, [], { depth });
      await this.persist(employee.id, result);
      return result;
    } catch (error) {
      const saved = this.hosted.sessionFor(employee.id);
      if (saved) await this.persist(employee.id, saved);
      throw error;
    }
  }

  private permitsDelivery(message: OfficeMessage, employee: Employee, state: AppState): boolean {
    const config = resolveAgentConfig(employee.agent);
    const sender = state.employees.find((item) => item.id === message.fromEmployeeId);
    if (!sender || sender.id === employee.id) return false;
    const senderConfig = resolveAgentConfig(sender.agent);
    return config.communication.receiveMessages && config.communication.autoRespond &&
      config.autonomy.initiative === 'on-message' && message.depth <= config.communication.maxHandoffs &&
      (!config.communication.teammateIds.length || config.communication.teammateIds.includes(sender.id)) &&
      senderConfig.communication.sendMessages &&
      (!senderConfig.communication.teammateIds.length || senderConfig.communication.teammateIds.includes(employee.id));
  }

  async deliverPending(): Promise<void> {
    const recipients = [...new Set((await this.tools.pendingMessages()).map((message) => message.toEmployeeId))];
    await Promise.allSettled(recipients.map(async (employeeId) => {
      if (this.deliveringEmployees.has(employeeId)) return;
      this.deliveringEmployees.add(employeeId);
      try {
        await this.enqueue(employeeId, async () => {
          const state = await this.load();
          const employee = state?.employees.find((item) => item.id === employeeId);
          if (!state || !employee) return;
          // Recheck policies after waiting for this employee's queue, before exposing any text.
          const messages = (await this.tools.pendingMessages(employeeId)).filter((message) => this.permitsDelivery(message, employee, state)).slice(0, 10);
          if (!messages.length) return;
          if (employee.sessionId && this.hosted.owns(employee.sessionId) &&
              ['queued', 'running', 'waiting_for_approval'].includes(this.hosted.peek(employee.sessionId).status)) return;
          const text = messages.map((message) => `Internal message ${message.id} from ${state.employees.find((item) => item.id === message.fromEmployeeId)!.name}:\n${message.text}`).join('\n\n');
          const session = await this.run(employee, state, `${text}\nRead your inbox and acknowledge these messages explicitly. Reply only when a useful response is needed.`, Math.max(...messages.map((message) => message.depth)));
          if (!['failed', 'cancelled'].includes(session.status))
            for (const message of messages) await this.tools.deliverMessage(message.id, employee.id, session.id);
        });
      } finally { this.deliveringEmployees.delete(employeeId); }
    }));
  }
}
