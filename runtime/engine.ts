import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  ActivityKind,
  Artifact,
  CalendarEvent,
  Command,
  Routine,
  Scenario,
  Snapshot,
  WorkItem,
} from '../src/shared/types';
import { CodexAppServer } from './codex';
import { copyBugFixture, createBugFixture, initialSnapshot, writeInitialArtifacts } from './fixtures';
import { SnapshotStore } from './store';

const ACTIVITY_LIMIT = 150;
const DEMO_ORDER: Scenario[] = ['report', 'bug', 'meeting', 'dinner', 'qa'];
const AGENT_FOR: Record<Scenario, string> = {
  report: 'agent-eli', bug: 'agent-priya', meeting: 'agent-jonah', dinner: 'agent-sam', qa: 'agent-lena',
};

export interface RuntimeOptions {
  dataDir: string;
  onSnapshot(snapshot: Snapshot): void;
}

export interface OfficeRuntime {
  command(command: Command): Promise<Snapshot>;
  snapshot(): Snapshot;
  close(): Promise<void>;
  getArtifactPath(id: string): string | undefined;
}

interface ActiveJob {
  workId: string;
  abort: AbortController;
  generation: number;
  threadId?: string;
  turnId?: string;
}

export async function createRuntime(options: RuntimeOptions): Promise<OfficeRuntime> {
  const runtime = await Runtime.create(options);
  return runtime;
}

class Runtime implements OfficeRuntime {
  private state: Snapshot;
  private readonly active = new Map<string, ActiveJob>();
  private readonly jobs = new Set<Promise<void>>();
  private serial: Promise<unknown> = Promise.resolve();
  private routineTimer?: NodeJS.Timeout;
  private demoTimer?: NodeJS.Timeout;
  private loginId?: string;
  private closed = false;
  private generation = 0;

  private constructor(
    private readonly options: RuntimeOptions,
    private readonly store: SnapshotStore,
    state: Snapshot,
    private readonly codex: CodexAppServer,
    private readonly bugTemplate: string,
  ) {
    this.state = state;
  }

  static async create(options: RuntimeOptions): Promise<Runtime> {
    const dataDir = path.resolve(options.dataDir);
    const store = await SnapshotStore.open(dataDir);
    let state = store.load();
    if (!state) {
      state = initialSnapshot();
      await writeInitialArtifacts(dataDir, state);
    } else {
      const now = Date.now();
      for (const work of state.work) {
        if (work.status === 'running' || work.status === 'waiting') {
          work.status = 'failed';
          work.error = 'The app closed before this work finished. Retry to run it again.';
          work.completedAt = now;
        }
      }
      for (const run of state.runs) {
        if (run.status === 'running' || run.status === 'waiting') {
          run.status = 'failed';
          run.completedAt = now;
        }
      }
      for (const agent of state.agents) {
        agent.activity = 'idle';
        agent.statusText = 'Ready';
        delete agent.workId;
      }
      state.demo.playing = false;
    }
    const bugTemplate = await createBugFixture(dataDir);
    const codex = new CodexAppServer();
    const runtime = new Runtime({ ...options, dataDir }, store, state, codex, bugTemplate);
    codex.onNotification((method, params) => runtime.handleCodexNotification(method, params));
    try {
      await codex.start();
      await runtime.refreshAuth(false);
    } catch (error) {
      runtime.state.auth = { status: 'unavailable', error: safeError(error) };
    }
    await runtime.persistAndEmit();
    runtime.routineTimer = setInterval(() => void runtime.checkRoutines(), 1_000);
    runtime.routineTimer.unref();
    runtime.drainQueue();
    return runtime;
  }

  snapshot(): Snapshot {
    return structuredClone(this.state);
  }

  command(command: Command): Promise<Snapshot> {
    return this.exclusive(async () => {
      if (this.closed) throw new Error('Runtime is closed');
      if (command.type === 'snapshot') return this.snapshot();
      switch (command.type) {
        case 'auth.refresh': await this.refreshAuth(true); break;
        case 'auth.login': await this.login(); break;
        case 'auth.cancel': await this.cancelLogin(); break;
        case 'auth.logout': await this.logout(); break;
        case 'demo.play': this.playDemo(); break;
        case 'demo.pause': this.pauseDemo(); break;
        case 'demo.next': this.advanceDemo(); break;
        case 'demo.reset': await this.resetDemo(); break;
        case 'demo.speed': this.state.demo.speed = clamp(command.speed, 0.25, 4); this.rescheduleDemo(); break;
        case 'scenario.run': this.startScenario(command.scenario); break;
        case 'source.evaluate': this.evaluateSource(command.id); break;
        case 'work.cancel': await this.cancelWork(command.id); break;
        case 'work.retry': this.retryWork(command.id); break;
        case 'work.steer': await this.steerWork(command.id, command.text); break;
        case 'routine.save': this.saveRoutine(command.routine); break;
        case 'routine.toggle': this.toggleRoutine(command.id); break;
        case 'routine.run': this.runRoutine(command.id); break;
        case 'routine.delete': this.deleteRoutine(command.id); break;
        case 'board.post': this.addManualPost(command.text, command.workId); break;
        case 'settings.update': this.updateSettings(command.settings); break;
        default: throw new Error(`Unknown command: ${(command as { type: string }).type}`);
      }
      await this.persistAndEmit();
      this.drainQueue();
      return this.snapshot();
    });
  }

  getArtifactPath(id: string): string | undefined {
    const artifact = this.state.artifacts.find((item) => item.id === id);
    if (!artifact?.filePath) return undefined;
    const resolved = path.resolve(artifact.filePath);
    const dataDir = `${path.resolve(this.options.dataDir)}${path.sep}`;
    return resolved.startsWith(dataDir) ? resolved : undefined;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    if (this.routineTimer) clearInterval(this.routineTimer);
    if (this.demoTimer) clearTimeout(this.demoTimer);
    for (const job of this.active.values()) {
      job.abort.abort();
      if (job.threadId && job.turnId) void this.codex.interrupt(job.threadId, job.turnId).catch(() => undefined);
    }
    this.closed = true;
    await this.codex.close();
    await Promise.allSettled([...this.jobs]);
    await this.store.save(this.state);
    this.store.close();
  }

  private exclusive<T>(operation: () => Promise<T> | T): Promise<T> {
    const next = this.serial.then(operation, operation);
    this.serial = next.catch(() => undefined);
    return next;
  }

  private async mutate(operation: () => void): Promise<void> {
    await this.exclusive(async () => {
      if (this.closed) return;
      operation();
      await this.persistAndEmit();
    });
  }

  private async persistAndEmit(): Promise<void> {
    this.state.revision += 1;
    await this.store.save(this.state);
    try {
      this.options.onSnapshot(this.snapshot());
    } catch {
      // A renderer listener must not stop durable runtime work.
    }
  }

  private async refreshAuth(refreshToken: boolean): Promise<void> {
    this.state.auth = { status: 'checking' };
    try {
      await this.codex.start();
      const account = await this.codex.readAccount(refreshToken);
      if (account.unsupportedMethod) {
        this.state.auth = { status: 'error', error: `Little Office requires a ChatGPT subscription login. Codex is using ${account.unsupportedMethod}.` };
      } else if (account.signedIn) {
        this.state.auth = { status: 'signed-in', email: account.email, plan: account.plan, method: account.method };
      } else {
        this.state.auth = { status: 'signed-out' };
      }
    } catch (error) {
      this.state.auth = { status: 'unavailable', error: safeError(error) };
    }
  }

  private async login(): Promise<void> {
    if (this.state.auth.status === 'signing-in' && this.state.auth.loginUrl) return;
    await this.codex.start();
    const login = await this.codex.login();
    this.loginId = login.loginId;
    this.state.auth = { status: 'signing-in', method: 'ChatGPT subscription', loginUrl: login.authUrl };
  }

  private async cancelLogin(): Promise<void> {
    if (this.loginId) await this.codex.cancelLogin(this.loginId).catch(() => undefined);
    this.loginId = undefined;
    this.state.auth = { status: 'signed-out' };
  }

  private async logout(): Promise<void> {
    await this.codex.logout();
    this.loginId = undefined;
    this.state.auth = { status: 'signed-out' };
  }

  private handleCodexNotification(method: string, params: Record<string, unknown>): void {
    if (method === 'account/login/completed') {
      if (params.loginId && params.loginId !== this.loginId) return;
      if (params.success === true) {
        this.loginId = undefined;
        void this.exclusive(async () => {
          await this.refreshAuth(true);
          await this.persistAndEmit();
        });
      } else {
        this.loginId = undefined;
        void this.mutate(() => {
          this.state.auth = { status: 'error', error: typeof params.error === 'string' ? params.error : 'ChatGPT login failed' };
        });
      }
    } else if (method === 'account/updated' && this.state.auth.status !== 'signing-in') {
      void this.exclusive(async () => {
        await this.refreshAuth(false);
        await this.persistAndEmit();
      });
    }
  }

  private playDemo(): void {
    this.state.demo.playing = true;
    this.scheduleDemo();
  }

  private pauseDemo(): void {
    this.state.demo.playing = false;
    if (this.demoTimer) clearTimeout(this.demoTimer);
    this.demoTimer = undefined;
  }

  private advanceDemo(): void {
    const scenario = DEMO_ORDER[this.state.demo.nextIndex];
    if (!scenario) {
      this.pauseDemo();
      this.event('system', 'The demo sequence is complete. Reset it to play again.');
      return;
    }
    this.state.demo.nextIndex += 1;
    const incoming = this.state.sources.find((source) => source.scenario === scenario);
    if (incoming) {
      incoming.timestamp = Date.now();
      incoming.disposition = 'pending';
      delete incoming.reason;
      this.event('system', `New ${incoming.source} item: ${incoming.title}`);
    }
    this.startScenario(scenario);
    if (this.state.demo.nextIndex >= DEMO_ORDER.length) this.pauseDemo();
  }

  private scheduleDemo(): void {
    if (!this.state.demo.playing || this.demoTimer || this.closed) return;
    this.demoTimer = setTimeout(() => {
      this.demoTimer = undefined;
      void this.exclusive(async () => {
        if (!this.state.demo.playing) return;
        this.advanceDemo();
        await this.persistAndEmit();
        this.drainQueue();
        this.scheduleDemo();
      });
    }, visibleDelay(2_500, this.state.demo.speed));
    this.demoTimer.unref();
  }

  private rescheduleDemo(): void {
    if (this.demoTimer) clearTimeout(this.demoTimer);
    this.demoTimer = undefined;
    this.scheduleDemo();
  }

  private async resetDemo(): Promise<void> {
    const revision = this.state.revision;
    this.generation += 1;
    for (const job of this.active.values()) job.abort.abort();
    this.active.clear();
    const auth = this.state.auth;
    const settings = this.state.settings;
    const replacement = initialSnapshot();
    replacement.auth = auth;
    replacement.settings = settings;
    replacement.revision = revision;
    await writeInitialArtifacts(this.options.dataDir, replacement);
    this.state = replacement;
    this.pauseDemo();
  }

  private startScenario(scenario: Scenario, routineId?: string): WorkItem {
    const existing = this.state.work.find((work) => work.scenario === scenario && work.routineId === routineId && activeStatus(work.status));
    if (existing) return existing;
    const id = `work-${scenario}-${nextNumber(this.state.work.map((item) => item.id))}`;
    const sources = this.state.sources.filter((source) => source.scenario === scenario && source.disposition !== 'ignored');
    const work: WorkItem = {
      id,
      title: scenarioTitle(scenario),
      goal: scenarioGoal(scenario),
      sourceIds: sources.map((source) => source.id),
      agentId: AGENT_FOR[scenario],
      status: 'queued', scenario, createdAt: Date.now(), mode: this.state.settings.mode, routineId,
    };
    this.state.work.push(work);
    for (const source of sources) source.disposition = 'work';
    this.event('status', `${agentName(this.state, work.agentId)} queued “${work.title}”.`, work.id, work.agentId);
    return work;
  }

  private evaluateSource(id: string): void {
    const source = this.state.sources.find((item) => item.id === id);
    if (!source) throw new Error('Source item not found');
    if (!source.scenario || source.disposition === 'ignored') return;
    const related = [...this.state.work].reverse().find((work) => work.sourceIds.some((sourceId) => {
      const linked = this.state.sources.find((item) => item.id === sourceId);
      return linked?.threadId === source.threadId;
    }));
    if (related) {
      if (!related.sourceIds.includes(source.id)) related.sourceIds.push(source.id);
      source.disposition = 'attached';
      source.reason = `${related.status === 'completed' ? 'Already handled by' : 'Attached to'} ${related.title}`;
      this.event('system', `${related.status === 'completed' ? 'Matched' : 'Attached'} ${source.source} item to existing work.`, related.id, related.agentId);
      return;
    }
    this.startScenario(source.scenario);
  }

  private drainQueue(): void {
    if (this.closed) return;
    while (this.active.size < 2) {
      const busyAgents = new Set([...this.active.keys()].map((id) => this.state.work.find((item) => item.id === id)?.agentId));
      const work = this.state.work.find((item) => item.status === 'queued' && !this.active.has(item.id) && !busyAgents.has(item.agentId));
      if (!work) break;
      const active: ActiveJob = { workId: work.id, abort: new AbortController(), generation: this.generation };
      this.active.set(work.id, active);
      const job = (work.mode === 'live' ? this.runLive(work, active) : this.runDemo(work, active))
        .catch((error) => active.generation === this.generation ? this.failJob(work.id, error) : undefined)
        .finally(() => {
          if (this.active.get(work.id) === active) this.active.delete(work.id);
          this.jobs.delete(job);
          this.drainQueue();
        });
      this.jobs.add(job);
    }
  }

  private async beginJob(workId: string): Promise<void> {
    await this.mutate(() => {
      const work = requiredWork(this.state, workId);
      if (work.status !== 'queued') return;
      work.status = 'running';
      delete work.error;
      const run = {
        id: `run-${nextNumber(this.state.runs.map((item) => item.id))}`,
        workId, status: 'running' as const, startedAt: Date.now(),
      };
      this.state.runs.push(run);
      this.setAgent(work.agentId, scenarioActivity(work.scenario, 0), `Starting ${work.title}`, work.id);
      this.event('status', `${agentName(this.state, work.agentId)} started ${work.title}.`, work.id, work.agentId);
    });
  }

  private async runDemo(work: WorkItem, active: ActiveJob): Promise<void> {
    await this.beginJob(work.id);
    const stages = work.routineId ? routineStages(work) : demoStages(work.scenario);
    for (let index = 0; index < stages.length; index += 1) {
      await abortableDelay(visibleDelay([1_600, 2_000, 1_800][index], this.state.demo.speed), active.abort.signal);
      await this.mutate(() => {
        const current = requiredWork(this.state, work.id);
        if (current.status !== 'running') return;
        const text = `Simulated demo: ${stages[index]}`;
        this.setAgent(current.agentId, scenarioActivity(current.scenario, index + 1), text, current.id);
        this.event(index === 1 ? 'tool' : 'status', text, current.id, current.agentId);
        if (index === 1) this.addBoard(current.agentId, current.id, 'handoff', text);
      });
    }
    const calendar = work.scenario === 'dinner' ? demoDinnerCalendar(work.sourceIds, this.state.calendar) : undefined;
    const artifact = await this.createDemoArtifact(work, calendar);
    await this.completeJob(work.id, artifact, calendar);
  }

  private async createDemoArtifact(work: WorkItem, calendar?: CalendarEvent): Promise<Artifact> {
    const id = `artifact-${work.scenario}-${nextNumber(this.state.artifacts.map((item) => item.id))}`;
    const spec = demoArtifact(work.scenario, work.goal, Boolean(work.routineId), calendar);
    const directory = path.join(this.options.dataDir, 'artifacts');
    await mkdir(directory, { recursive: true });
    const filePath = path.join(directory, `${id}.${spec.extension}`);
    await writeFile(filePath, spec.content, 'utf8');
    return { id, workId: work.id, title: spec.title, kind: spec.kind, content: spec.content, createdAt: Date.now(), filePath, simulated: true };
  }

  private async completeJob(workId: string, artifact: Artifact, calendar?: CalendarEvent): Promise<void> {
    await this.mutate(() => {
      const work = requiredWork(this.state, workId);
      if (work.status !== 'running') return;
      work.status = 'completed';
      work.completedAt = Date.now();
      const run = latestRun(this.state, workId);
      if (run) { run.status = 'completed'; run.completedAt = work.completedAt; }
      this.state.artifacts.push(artifact);
      if (calendar) {
        const existing = this.state.calendar.findIndex((item) => item.sourceIds.some((id) => calendar.sourceIds.includes(id)));
        if (existing >= 0) this.state.calendar.splice(existing, 1, calendar);
        else this.state.calendar.push(calendar);
      }
      this.setAgent(work.agentId, 'celebrating', `${work.title} complete`, work.id);
      this.event('artifact', `${artifact.title} is ready${artifact.simulated ? ' (simulated)' : ''}.`, work.id, work.agentId);
      this.addBoard(work.agentId, work.id, 'complete', `${artifact.title} is ready${artifact.simulated ? ' in the simulated demo' : ''}.`, artifact.id);
      const routine = work.routineId ? this.state.routines.find((item) => item.id === work.routineId) : undefined;
      if (routine) routine.lastRunAt = work.completedAt;
    });
    const generation = this.generation;
    const timer = setTimeout(() => void this.mutate(() => {
      if (generation !== this.generation) return;
      const work = this.state.work.find((item) => item.id === workId);
      const agent = work && this.state.agents.find((item) => item.id === work.agentId);
      if (work && agent?.workId === workId && !this.active.has(workId)) {
        agent.activity = 'idle';
        agent.statusText = `${work.title} complete`;
      }
    }), 2_000);
    timer.unref();
  }

  private async failJob(workId: string, error: unknown): Promise<void> {
    await this.mutate(() => {
      const work = this.state.work.find((item) => item.id === workId);
      if (!work || work.status === 'cancelled') return;
      work.status = 'failed';
      work.error = safeError(error);
      work.completedAt = Date.now();
      const run = latestRun(this.state, workId);
      if (run) { run.status = 'failed'; run.completedAt = work.completedAt; }
      this.setAgent(work.agentId, 'idle', `${work.title} needs attention`);
      this.event('error', `${work.title} failed: ${work.error}`, work.id, work.agentId);
    });
  }

  private async runLive(work: WorkItem, active: ActiveJob): Promise<void> {
    if (this.state.auth.status !== 'signed-in') throw new Error('Sign in with a ChatGPT subscription before running live work');
    await this.beginJob(work.id);
    const run = latestRun(this.state, work.id);
    if (!run) throw new Error('Live run record is missing');
    const workspace = path.join(this.options.dataDir, 'workspaces', run.id);
    if (work.scenario === 'bug' || work.scenario === 'qa') await copyBugFixture(this.bugTemplate, workspace);
    else await mkdir(workspace, { recursive: true });
    await writeLiveEvidence(work.scenario, workspace, this.state);
    await this.mutate(() => {
      const currentRun = latestRun(this.state, work.id);
      if (currentRun) currentRun.workspace = workspace;
      this.event('tool', `Prepared an isolated workspace for ${work.title}.`, work.id, work.agentId);
    });

    const result = await this.codex.runTurn({
      cwd: workspace,
      model: this.state.settings.model,
      prompt: livePrompt(work),
      outputSchema: work.scenario === 'dinner' ? calendarSchema() : undefined,
      onStarted: ({ threadId, turnId }) => {
        active.threadId = threadId;
        active.turnId = turnId;
        void this.mutate(() => {
          const currentRun = latestRun(this.state, work.id);
          if (currentRun) { currentRun.threadId = threadId; currentRun.turnId = turnId; }
          this.event('status', `${agentName(this.state, work.agentId)} is working with Codex.`, work.id, work.agentId);
        });
      },
      onProgress: (text) => void this.mutate(() => {
        const current = this.state.work.find((item) => item.id === work.id);
        if (current?.status !== 'running') return;
        this.event('tool', compact(text, 180), work.id, work.agentId);
      }),
    });
    if (active.abort.signal.aborted) throw new AbortError();
    if (result.status !== 'completed') throw new Error(result.error || `Codex turn ${result.status}`);
    const artifact = await this.readLiveArtifact(work, workspace, result.message);
    let event: CalendarEvent | undefined;
    if (work.scenario === 'dinner') {
      event = validateCalendarResult(result.message, work.sourceIds, this.state.calendar);
      await writeFile(path.join(workspace, 'calendar.json'), JSON.stringify(event, null, 2), 'utf8');
      artifact.filePath = path.join(workspace, 'calendar.json');
      artifact.content = JSON.stringify(event, null, 2);
    }
    await this.completeJob(work.id, artifact, event);
  }

  private async readLiveArtifact(work: WorkItem, workspace: string, message: string): Promise<Artifact> {
    const details = liveArtifactSpec(work.scenario);
    const filePath = path.join(workspace, details.file);
    let content: string;
    if (work.scenario === 'dinner') {
      content = message;
    } else {
      try {
        content = await readFile(filePath, 'utf8');
      } catch {
        content = message;
        if (!content) throw new Error(`Codex completed without producing ${details.file}`);
        await writeFile(filePath, content, 'utf8');
      }
    }
    return {
      id: `artifact-${work.scenario}-${nextNumber(this.state.artifacts.map((item) => item.id))}`,
      workId: work.id,
      title: details.title,
      kind: details.kind,
      content,
      createdAt: Date.now(),
      filePath,
      simulated: false,
    };
  }

  private async cancelWork(id: string): Promise<void> {
    const work = requiredWork(this.state, id);
    if (!activeStatus(work.status)) return;
    const active = this.active.get(id);
    active?.abort.abort();
    if (active?.threadId && active.turnId) {
      await this.codex.interrupt(active.threadId, active.turnId).catch(() => undefined);
    }
    work.status = 'cancelled';
    work.completedAt = Date.now();
    const run = latestRun(this.state, id);
    if (run && activeStatus(run.status)) { run.status = 'cancelled'; run.completedAt = work.completedAt; }
    this.setAgent(work.agentId, 'idle', 'Available');
    this.event('status', `${work.title} was cancelled.`, work.id, work.agentId);
  }

  private retryWork(id: string): void {
    const work = requiredWork(this.state, id);
    if (work.status !== 'failed' && work.status !== 'cancelled') throw new Error('Only failed or cancelled work can be retried');
    work.status = 'queued';
    work.createdAt = Date.now();
    delete work.completedAt;
    delete work.error;
    this.event('status', `${work.title} was queued for another attempt.`, work.id, work.agentId);
  }

  private async steerWork(id: string, text: string): Promise<void> {
    const work = requiredWork(this.state, id);
    const instruction = text.trim();
    if (!instruction) throw new Error('Steering text is required');
    const active = this.active.get(id);
    if (work.mode !== 'live' || work.status !== 'running' || !active?.threadId || !active.turnId) {
      throw new Error('Only active live work can be steered');
    }
    await this.codex.steer(active.threadId, active.turnId, instruction);
    this.event('status', `Steered ${work.title}: ${compact(instruction, 120)}`, work.id, work.agentId);
  }

  private saveRoutine(input: Omit<Routine, 'id' | 'nextRunAt'> & { id?: string }): void {
    const name = input.name.trim();
    const instructions = input.instructions.trim();
    if (!name || !instructions) throw new Error('Routine name and instructions are required');
    if (!this.state.agents.some((agent) => agent.id === input.agentId)) throw new Error('Routine agent not found');
    validateSchedule(input.schedule, input.intervalMinutes, input.dailyTime);
    const existing = input.id ? this.state.routines.find((routine) => routine.id === input.id) : undefined;
    const previousAgentId = existing?.agentId;
    const id = existing?.id || `routine-${nextNumber(this.state.routines.map((item) => item.id))}`;
    const routine: Routine = {
      ...input,
      id,
      name,
      instructions,
      nextRunAt: nextRoutineTime(input.schedule, input.intervalMinutes, input.dailyTime, Date.now()),
    };
    if (existing) this.state.routines.splice(this.state.routines.indexOf(existing), 1, routine);
    else this.state.routines.push(routine);
    const agent = this.state.agents.find((item) => item.id === routine.agentId);
    if (agent) agent.persistent = true;
    if (previousAgentId && previousAgentId !== routine.agentId) this.syncAgentPersistence(previousAgentId);
    this.event('system', `${name} routine saved.`, undefined, routine.agentId);
  }

  private toggleRoutine(id: string): void {
    const routine = requiredRoutine(this.state, id);
    routine.enabled = !routine.enabled;
    if (routine.enabled) routine.nextRunAt = nextRoutineTime(routine.schedule, routine.intervalMinutes, routine.dailyTime, Date.now());
  }

  private runRoutine(id: string): void {
    const routine = requiredRoutine(this.state, id);
    if (this.state.work.some((work) => work.routineId === id && activeStatus(work.status))) {
      this.event('system', `${routine.name} is already running.`, undefined, routine.agentId);
      return;
    }
    const scenario = routineScenario(routine.instructions);
    const work = this.startScenario(scenario, routine.id);
    work.agentId = routine.agentId;
    work.title = routine.name;
    work.goal = routine.instructions;
    routine.lastRunAt = Date.now();
    routine.nextRunAt = nextRoutineTime(routine.schedule, routine.intervalMinutes, routine.dailyTime, routine.lastRunAt);
  }

  private deleteRoutine(id: string): void {
    const routine = requiredRoutine(this.state, id);
    this.state.routines.splice(this.state.routines.indexOf(routine), 1);
    this.syncAgentPersistence(routine.agentId);
  }

  private async checkRoutines(): Promise<void> {
    await this.exclusive(async () => {
      if (this.closed) return;
      const due = this.state.routines.filter((routine) => routine.enabled && routine.nextRunAt <= Date.now());
      if (!due.length) return;
      for (const routine of due) this.runRoutine(routine.id);
      await this.persistAndEmit();
      this.drainQueue();
    });
  }

  private addManualPost(text: string, workId?: string): void {
    const body = text.trim();
    if (!body) throw new Error('Post text is required');
    if (workId) requiredWork(this.state, workId);
    this.addBoard('agent-maya', workId, 'finding', body);
  }

  private updateSettings(settings: Partial<Snapshot['settings']>): void {
    if (settings.mode && settings.mode !== 'demo' && settings.mode !== 'live') throw new Error('Unknown runtime mode');
    if (typeof settings.model === 'string' && settings.model.length > 120) throw new Error('Model name is too long');
    this.state.settings = { ...this.state.settings, ...settings };
  }

  private setAgent(agentId: string, activity: ActivityKind, statusText: string, workId?: string): void {
    const agent = this.state.agents.find((item) => item.id === agentId);
    if (!agent) return;
    agent.activity = activity;
    agent.statusText = statusText;
    if (workId) agent.workId = workId;
    else delete agent.workId;
  }

  private syncAgentPersistence(agentId: string): void {
    const agent = this.state.agents.find((item) => item.id === agentId);
    if (agent) agent.persistent = ['agent-eli', 'agent-lena'].includes(agentId) || this.state.routines.some((routine) => routine.agentId === agentId);
  }

  private event(kind: Snapshot['activity'][number]['kind'], text: string, workId?: string, agentId?: string): void {
    const sequence = (this.state.activity.at(-1)?.sequence || 0) + 1;
    this.state.activity.push({ id: `event-${sequence}`, sequence, timestamp: Date.now(), workId, agentId, kind, text });
    if (this.state.activity.length > ACTIVITY_LIMIT) this.state.activity.splice(0, this.state.activity.length - ACTIVITY_LIMIT);
  }

  private addBoard(agentId: string, workId: string | undefined, kind: Snapshot['board'][number]['kind'], text: string, artifactId?: string): void {
    this.state.board.push({ id: `board-${nextNumber(this.state.board.map((item) => item.id))}`, agentId, workId, artifactId, kind, text, timestamp: Date.now() });
  }
}

class AbortError extends Error {
  constructor() { super('Work was cancelled'); }
}

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new AbortError()); return; }
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener('abort', () => { clearTimeout(timer); reject(new AbortError()); }, { once: true });
  });
}

function activeStatus(status: string): boolean {
  return status === 'queued' || status === 'running' || status === 'waiting';
}

function requiredWork(state: Snapshot, id: string): WorkItem {
  const work = state.work.find((item) => item.id === id);
  if (!work) throw new Error('Work item not found');
  return work;
}

function latestRun(state: Snapshot, workId: string) {
  return [...state.runs].reverse().find((run) => run.workId === workId);
}

function requiredRoutine(state: Snapshot, id: string): Routine {
  const routine = state.routines.find((item) => item.id === id);
  if (!routine) throw new Error('Routine not found');
  return routine;
}

function nextNumber(ids: string[]): number {
  return ids.reduce((maximum, id) => Math.max(maximum, Number(id.match(/(\d+)$/)?.[1] || 0)), 0) + 1;
}

function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) throw new Error('Speed must be a number');
  return Math.min(maximum, Math.max(minimum, value));
}

function visibleDelay(milliseconds: number, speed: number): number {
  return clamp(milliseconds / speed, 1_000, 3_000);
}

function safeError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return compact(text.replace(/[\r\n]+/g, ' '), 300);
}

function compact(text: string, length: number): string {
  return text.length <= length ? text : `${text.slice(0, length - 1)}…`;
}

function agentName(state: Snapshot, id: string): string {
  return state.agents.find((agent) => agent.id === id)?.name || 'Agent';
}

function scenarioTitle(scenario: Scenario): string {
  return ({ report: 'Draft the launch readout', bug: 'Fix the checkout total', meeting: 'Prepare the leadership meeting', dinner: 'Add the client dinner', qa: 'Run checkout QA' })[scenario];
}

function scenarioGoal(scenario: Scenario): string {
  return ({
    report: 'Turn the launch evidence into a concise leadership report.',
    bug: 'Reproduce and fix the checkout tax regression, then verify the fix.',
    meeting: 'Prepare a meeting brief from the launch report and checkout fix status.',
    dinner: 'Create a conflict-free local dinner calendar event from the message details.',
    qa: 'Test discounted and full-price checkout totals and report the results.',
  })[scenario];
}

function scenarioActivity(scenario: Scenario, stage: number): ActivityKind {
  const activities: Record<Scenario, ActivityKind[]> = {
    report: ['reading', 'researching', 'drafting', 'collaborating'],
    bug: ['reading', 'coding', 'coding', 'collaborating'],
    meeting: ['reading', 'scheduling', 'scheduling', 'collaborating'],
    dinner: ['reading', 'researching', 'drafting', 'collaborating'],
    qa: ['reading', 'researching', 'coding', 'collaborating'],
  };
  return activities[scenario][Math.min(stage, 3)];
}

function demoStages(scenario: Scenario): string[] {
  return ({
    report: ['Eli is grouping launch evidence by decision.', 'Eli handed the metrics outline to Maya for a clarity check.', 'Eli is writing the one-page readout.'],
    bug: ['Priya reproduced the discounted checkout mismatch.', 'Priya handed Lena a focused verification plan.', 'Priya prepared a simulated patch and PR note.'],
    meeting: ['Jonah gathered the launch report and checkout fix status.', 'Jonah handed Maya the decision and risk outline.', 'Jonah drafted the Friday meeting brief.'],
    dinner: ['Sam collected the time and attendee details from Gmail and iMessage.', 'Sam handed Jonah a local calendar conflict check.', 'Sam prepared a simulated dinner calendar event.'],
    qa: ['Lena checked the reported and baseline totals.', 'Lena handed Priya the failing-case result.', 'Lena wrote the focused QA record.'],
  })[scenario];
}

function routineStages(work: WorkItem): string[] {
  return [
    `the routine “${work.title}” started from its saved instructions.`,
    `the assigned agent checked the requested scope: ${compact(work.goal, 100)}`,
    'the routine produced a result tied to those instructions.',
  ];
}

function demoArtifact(scenario: Scenario, goal: string, routine: boolean, calendar?: CalendarEvent): { title: string; kind: Artifact['kind']; extension: string; content: string } {
  const instruction = routine ? `\n\nSaved routine instructions\n\n${goal}` : '';
  const artifacts: Record<Scenario, { title: string; kind: Artifact['kind']; extension: string; content: string }> = {
    report: {
      title: routine ? 'Routine report' : 'Launch leadership readout', kind: 'report', extension: 'md',
      content: `SIMULATED DEMO ARTIFACT\n\n# Launch leadership readout\n\nAdoption reached 68% of the invited pilot group. Support volume fell from 31 to 18 weekly tickets after the onboarding revision.\n\n## Decisions\n\n- Keep the guided import in the default path.\n- Assign an owner for the seven unresolved enterprise migrations.\n\nThis report is fictional demo output.${instruction}`,
    },
    bug: {
      title: routine ? 'Routine patch note' : 'Checkout tax patch', kind: 'patch', extension: 'patch',
      content: `SIMULATED DEMO PATCH\n\n--- a/checkout.js\n+++ b/checkout.js\n@@\n-  return discounted + tax + (coupon > 0 ? tax : 0);\n+  return discounted + tax;\n\nSimulated PR action: prepared a local patch for review. No remote PR was opened.${instruction}`,
    },
    meeting: {
      title: routine ? 'Routine meeting brief' : 'Friday leadership meeting brief', kind: 'brief', extension: 'md',
      content: `SIMULATED DEMO ARTIFACT\n\n# Friday leadership meeting brief\n\n## Launch\n\nPilot activation is 68%. Support tickets declined after the onboarding revision. Seven enterprise migrations remain open.\n\n## Checkout fix\n\nThe fictional patch removes the second tax addition on coupon orders. Focused QA covers full-price and discounted totals.\n\n## Decisions and risks\n\nKeep guided import as the default. Assign an owner and target date for the remaining migrations. Treat the checkout status as simulated until a live run verifies it.${instruction}`,
    },
    dinner: {
      title: routine ? 'Routine calendar event' : 'Client dinner calendar event', kind: 'calendar', extension: 'json',
      content: JSON.stringify(calendar || demoDinnerCalendar([], [], goal), null, 2),
    },
    qa: {
      title: routine ? 'Routine QA record' : 'Checkout QA record', kind: 'qa', extension: 'md',
      content: `SIMULATED DEMO ARTIFACT\n\n# Checkout QA\n\n- Full price: 100 + 8% tax = 108.00, passed.\n- $10 coupon: 90 + 8% tax = 97.20, passed after the simulated patch.\n- Negative and oversized coupon inputs remain outside this fixture's contract.\n\nNo production system was tested.${instruction}`,
    },
  };
  return artifacts[scenario];
}

function demoDinnerCalendar(sourceIds: string[], existing: CalendarEvent[], goal?: string): CalendarEvent {
  const start = new Date(Date.now());
  start.setDate(start.getDate() + ((4 - start.getDay() + 7) % 7 || 7));
  start.setHours(19, 30, 0, 0);
  while (existing.some((event) => !event.sourceIds.some((id) => sourceIds.includes(id)) && start.getTime() < Date.parse(event.end) && start.getTime() + 2 * 60 * 60_000 > Date.parse(event.start))) {
    start.setDate(start.getDate() + 7);
  }
  const end = new Date(start.getTime() + 2 * 60 * 60_000);
  return {
    id: `calendar-demo-${start.getTime()}`,
    title: 'Client dinner (simulated)', start: start.toISOString(), end: end.toISOString(),
    attendees: ['avery@example.test', 'five guests'], location: 'Near Union Square, venue undecided',
    description: `SIMULATED DEMO CALENDAR EVENT. Quiet venue, vegetarian options, patio preferred. No external calendar or restaurant was changed.${goal ? ` Routine instructions: ${goal}` : ''}`,
    sourceIds, simulated: true,
  };
}

function liveArtifactSpec(scenario: Scenario): { title: string; kind: Artifact['kind']; file: string } {
  const specs: Record<Scenario, { title: string; kind: Artifact['kind']; file: string }> = {
    report: { title: 'Codex launch readout', kind: 'report', file: 'report.md' },
    bug: { title: 'Codex checkout patch', kind: 'patch', file: 'patch.md' },
    meeting: { title: 'Codex leadership meeting brief', kind: 'brief', file: 'brief.md' },
    dinner: { title: 'Validated dinner calendar event', kind: 'calendar', file: 'calendar.json' },
    qa: { title: 'Codex checkout QA', kind: 'qa', file: 'qa.md' },
  };
  return specs[scenario];
}

async function writeLiveEvidence(scenario: Scenario, workspace: string, state: Snapshot): Promise<void> {
  const relatedWork = state.work.filter((work) => work.scenario === 'report' || work.scenario === 'bug');
  const relatedArtifacts = state.artifacts.filter((artifact) => relatedWork.some((work) => work.id === artifact.workId));
  const meetingContext = relatedWork.length
    ? `\nCurrent office status:\n${relatedWork.map((work) => `- ${work.title}: ${work.status}`).join('\n')}\n\nAvailable output:\n${relatedArtifacts.map((artifact) => artifact.content.slice(0, 1_500)).join('\n\n')}\n`
    : '';
  const evidence: Record<Scenario, string> = {
    report: '# Local launch evidence\n\nPilot invitations: 250\nActivated accounts: 170\nWeekly support tickets before onboarding revision: 31\nWeekly support tickets after: 18\nOpen enterprise migrations: 7\n',
    bug: '# Reported issue\n\nPercentage coupon checkouts apply tax twice. Fix the supplied fixture and keep full-price behavior intact.\n',
    meeting: `# Local meeting evidence\n\nLaunch: 170 of 250 invited pilot accounts activated. Weekly support tickets fell from 31 to 18. Seven enterprise migrations remain open.\nCheckout: the proposed patch removes a duplicate tax addition on coupon purchases. Focused checks cover full-price and $10 coupon cases.\nPrepare decisions, risks, and direct questions for Friday leadership.\n${meetingContext}`,
    dinner: '# Local dinner and calendar evidence\n\nSix people, Thursday at 7:30 PM, near Union Square, quiet conversation, vegetarian options, patio preferred. Two-hour event. Busy that day from 6:00 PM to 7:00 PM America/New_York. Do not contact a restaurant or external calendar.\n',
    qa: '# QA request\n\nRun the supplied Node tests. Report the actual result and the totals covered. Do not alter the implementation.\n',
  };
  await writeFile(path.join(workspace, 'evidence.md'), evidence[scenario], 'utf8');
}

function livePrompt(work: WorkItem): string {
  const common = `Task: ${work.goal}\nRead evidence.md. Work only in this directory. Do not use network access or external apps.`;
  const directions: Record<Scenario, string> = {
    report: 'Write a concise, source-grounded leadership readout to report.md. Do not invent facts.',
    bug: 'Run the tests, fix the checkout bug, rerun the tests, and write patch.md with the cause, exact change, and test result. Do not create or claim a remote PR.',
    meeting: 'Write brief.md with a meeting brief grounded only in the local launch and checkout evidence. Include decisions, risks, and direct questions.',
    dinner: 'Return only the requested structured local calendar event. Use Thursday at 7:30 PM for two hours and confirm it does not overlap the local busy interval. Do not change any external calendar.',
    qa: 'Run npm test without changing checkout.js. Write qa.md with the commands, actual result, and any failure. Do not claim a pass if a test fails.',
  };
  return `${common}\n\n${directions[work.scenario]}`;
}

function calendarSchema(): Record<string, unknown> {
  return {
    type: 'object', additionalProperties: false,
    required: ['title', 'start', 'end', 'attendees', 'location', 'description'],
    properties: {
      title: { type: 'string' }, start: { type: 'string' }, end: { type: 'string' },
      attendees: { type: 'array', items: { type: 'string' } }, location: { type: 'string' }, description: { type: 'string' },
    },
  };
}

function validateCalendarResult(text: string, sourceIds: string[], existing: CalendarEvent[]): CalendarEvent {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error('Codex returned an invalid calendar result'); }
  if (!value || typeof value !== 'object') throw new Error('Codex returned an invalid calendar result');
  const item = value as Record<string, unknown>;
  const required = ['title', 'start', 'end', 'location', 'description'];
  if (required.some((key) => typeof item[key] !== 'string') || !Array.isArray(item.attendees) || item.attendees.some((entry) => typeof entry !== 'string')) {
    throw new Error('Codex returned an invalid calendar result');
  }
  const start = Date.parse(item.start as string);
  const end = Date.parse(item.end as string);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end - start !== 2 * 60 * 60_000) {
    throw new Error('Dinner calendar result must be a valid two-hour interval');
  }
  const conflict = existing.some((event) => !event.sourceIds.some((id) => sourceIds.includes(id)) && start < Date.parse(event.end) && end > Date.parse(event.start));
  if (conflict) throw new Error('Dinner calendar result conflicts with an existing office event');
  return {
    id: `calendar-live-${start}`,
    title: item.title as string, start: new Date(start).toISOString(), end: new Date(end).toISOString(),
    attendees: item.attendees as string[], location: item.location as string,
    description: item.description as string, sourceIds, simulated: false,
  };
}

function validateSchedule(schedule: Routine['schedule'], intervalMinutes: number, dailyTime: string): void {
  if (schedule === 'interval' && (!Number.isFinite(intervalMinutes) || intervalMinutes < 1)) throw new Error('Interval routines must run at least one minute apart');
  if (schedule === 'daily' && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(dailyTime)) throw new Error('Daily time must use HH:MM');
}

function nextRoutineTime(schedule: Routine['schedule'], intervalMinutes: number, dailyTime: string, now: number): number {
  if (schedule === 'interval') return now + intervalMinutes * 60_000;
  const [hours, minutes] = dailyTime.split(':').map(Number);
  const next = new Date(now);
  next.setHours(hours, minutes, 0, 0);
  if (next.getTime() <= now) next.setDate(next.getDate() + 1);
  return next.getTime();
}

function routineScenario(instructions: string): Scenario {
  const text = instructions.toLowerCase();
  if (/bug|code|fix|patch|implement/.test(text)) return 'bug';
  if (/test|qa|verify/.test(text)) return 'qa';
  if (/meeting|brief|agenda/.test(text)) return 'meeting';
  if (/dinner|calendar|schedule/.test(text)) return 'dinner';
  return 'report';
}
