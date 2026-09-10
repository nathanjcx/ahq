import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { DemoAttachment, DemoNotification, DemoTrigger, LocalTaskInput } from '../shared/demo';
import type { LaunchScene, LaunchSceneId, LaunchSnapshot, LaunchStep } from '../shared/launch';
import type { AppState, CloudSession } from '../shared/types';
import { demoDataPath } from './demo-execution';

interface StoredCheckpoint {
  id: string;
  label: string;
  createdAt: string;
  snapshot: LaunchSnapshot;
  appState: AppState;
}

interface LaunchRecord {
  snapshot: LaunchSnapshot;
  checkpoints: StoredCheckpoint[];
  notificationIds?: string[];
  dispatchKeys?: Partial<Record<LaunchSceneId, string>>;
}

type LaunchTask = LocalTaskInput & {
  project: 'little-office';
  launchId: string;
  launchStep: LaunchStep;
};

export interface LaunchDependencies {
  load(): Promise<AppState>;
  restoreState(state: AppState, launchId: string): Promise<void>;
  store: { get<T>(key: string): Promise<T | undefined>; put<T>(key: string, value: T): Promise<void> };
  queue<T>(work: () => Promise<T>): Promise<T>;
  createGoal(goal: string, launchId: string): Promise<AppState>;
  trigger(input: DemoTrigger, task: LaunchTask): Promise<DemoNotification>;
  retryLaunch(launchId: string): Promise<void>;
  retryNotification?(id: string): Promise<DemoNotification>;
  demoSnapshot(): Promise<{ notifications: DemoNotification[]; sessions: CloudSession[] }>;
  getSession(id: string): Promise<CloudSession>;
  validateArtifacts(session: CloudSession): Promise<boolean>;
}

const storeKey = 'launch-story';
const sceneTitles: Record<LaunchSceneId, string> = {
  launch: 'Prepare the Little Office launch',
  investor: 'Answer the competitor scenario',
  bug: 'Fix the product screenshot bug',
  reporter: 'Prepare for the reporter meeting',
  celebrate: 'Celebrate the verified launch',
};

function freshSnapshot(): LaunchSnapshot {
  const ids: LaunchSceneId[] = ['launch', 'investor', 'bug', 'reporter', 'celebrate'];
  return {
    id: randomUUID(),
    status: 'idle',
    projectName: 'Little Office',
    checkpoints: [],
    scenes: ids.map((id) => ({
      id,
      title: sceneTitles[id],
      status: id === 'launch' ? 'ready' : 'locked',
      sessionIds: [],
    })),
  };
}

export class LaunchCoordinator {
  constructor(private deps: LaunchDependencies) {}

  snapshot(): Promise<LaunchSnapshot> {
    return this.deps.queue(async () => {
      const record = await this.loadRecord();
      await this.reconcile(record);
      return structuredClone(record.snapshot);
    });
  }

  start(): Promise<LaunchSnapshot> {
    return this.deps.queue(async () => {
      const existing = await this.deps.store.get<LaunchRecord>(storeKey);
      if (existing && existing.snapshot.status !== 'idle') return structuredClone(existing.snapshot);
      const snapshot = freshSnapshot();
      snapshot.status = 'running';
      snapshot.scenes[0].status = 'running';
      const record: LaunchRecord = { snapshot, checkpoints: [] };
      await this.saveRecord(record);
      try {
        await this.deps.createGoal(
          'Launch Little Office with a working product, a marketing plan, and a baseline financial forecast.',
          snapshot.id,
        );
      } catch (error) {
        this.fail(snapshot.scenes[0], error);
        snapshot.status = 'failed';
        await this.saveRecord(record);
      }
      return structuredClone(snapshot);
    });
  }

  advance(id: LaunchSceneId): Promise<LaunchSnapshot> {
    if (id === 'launch') return this.start();
    return this.deps.queue(async () => {
      const record = await this.loadRecord();
      await this.reconcile(record);
      const scene = record.snapshot.scenes.find((item) => item.id === id);
      if (!scene) throw new Error('Unknown launch scene.');
      if (scene.status !== 'ready') throw new Error(`The ${scene.title} scene is not ready.`);
      if (id === 'celebrate') {
        await this.completeCelebration(record, scene);
      } else {
        await this.dispatch(record, scene);
      }
      await this.saveRecord(record);
      return structuredClone(record.snapshot);
    });
  }

  retry(id: LaunchSceneId): Promise<LaunchSnapshot> {
    return this.deps.queue(async () => {
      const record = await this.loadRecord();
      const scene = record.snapshot.scenes.find((item) => item.id === id);
      if (!scene) throw new Error('Unknown launch scene.');
      if (scene.status !== 'failed') throw new Error(`The ${scene.title} scene has not failed.`);
      const source = scene.notificationId
        ? (await this.deps.demoSnapshot()).notifications.find((item) => item.id === scene.notificationId)
        : undefined;
      if (source?.status === 'ignored') {
        scene.notificationId = undefined;
        delete record.dispatchKeys?.[id];
      }
      if (scene.notificationId && this.deps.retryNotification) {
        const notification = await this.deps.retryNotification(scene.notificationId);
        record.notificationIds = [...(record.notificationIds ?? []), notification.id];
        scene.notificationId = notification.id;
        scene.sessionIds = [notification.triageSessionId, notification.sessionId].filter(
          (value): value is string => !!value,
        );
        scene.status = 'running';
        scene.error = undefined;
      } else if (id === 'launch') {
        await this.deps.retryLaunch(record.snapshot.id);
        scene.status = 'running';
        scene.error = undefined;
      } else {
        await this.dispatch(record, scene);
      }
      record.snapshot.status = scene.status === 'failed' ? 'failed' : 'running';
      await this.saveRecord(record);
      return structuredClone(record.snapshot);
    });
  }

  restore(checkpointId: string): Promise<LaunchSnapshot> {
    return this.deps.queue(async () => {
      const record = await this.loadRecord();
      const checkpoint = record.checkpoints.find((item) => item.id === checkpointId);
      if (!checkpoint) throw new Error('Launch checkpoint not found.');
      const current = await this.deps.load();
      const demo = await this.deps.demoSnapshot();
      const notifications = demo.notifications.filter((item) => record.notificationIds?.includes(item.id));
      const sessions = await this.sessions([
        ...record.snapshot.scenes.flatMap((scene) => scene.sessionIds),
        ...current.commitments
          .filter((item) => item.launchId === record.snapshot.id)
          .flatMap((item) => (item.sessionId ? [item.sessionId] : [])),
        ...notifications.flatMap((item) =>
          [item.triageSessionId, item.sessionId].filter((id): id is string => !!id),
        ),
      ]);
      if (notifications.some((item) => item.status === 'triaging' || item.status === 'working'))
        throw new Error('Wait for launch work to stop before restoring a checkpoint.');
      if (
        sessions.some(
          (session) =>
            session.status === 'queued' ||
            session.status === 'running' ||
            session.status === 'waiting_for_approval',
        )
      )
        throw new Error('Wait for launch work to stop before restoring a checkpoint.');
      if (current.roadmap?.status === 'planning')
        throw new Error('Wait for roadmap planning to finish before restoring a checkpoint.');
      await this.deps.restoreState(structuredClone(checkpoint.appState), record.snapshot.id);
      const restored = structuredClone(checkpoint.snapshot);
      restored.checkpoints = record.checkpoints.map(({ id, label, createdAt }) => ({ id, label, createdAt }));
      record.snapshot = restored;
      record.dispatchKeys = {};
      await this.saveRecord(record);
      return structuredClone(restored);
    });
  }

  tick(): Promise<void> {
    return this.deps.queue(async () => {
      const record = await this.loadRecord();
      await this.reconcile(record);
    });
  }

  private async loadRecord(): Promise<LaunchRecord> {
    const stored = await this.deps.store.get<LaunchRecord>(storeKey);
    if (stored) return stored;
    const record: LaunchRecord = { snapshot: freshSnapshot(), checkpoints: [] };
    await this.saveRecord(record);
    return record;
  }

  private async saveRecord(record: LaunchRecord): Promise<void> {
    record.snapshot.checkpoints = record.checkpoints.map(({ id, label, createdAt }) => ({
      id,
      label,
      createdAt,
    }));
    await this.deps.store.put(storeKey, structuredClone(record));
  }

  private async checkpoint(record: LaunchRecord, label: string): Promise<void> {
    const item: StoredCheckpoint = {
      id: randomUUID(),
      label,
      createdAt: new Date().toISOString(),
      snapshot: structuredClone(record.snapshot),
      appState: structuredClone(await this.deps.load()),
    };
    record.checkpoints.push(item);
  }

  private fail(scene: LaunchScene, error: unknown) {
    scene.status = 'failed';
    scene.error = error instanceof Error ? error.message : String(error);
  }

  private async sessions(ids: string[]): Promise<CloudSession[]> {
    return Promise.all([...new Set(ids)].map((id) => this.deps.getSession(id)));
  }

  private async verified(session: CloudSession): Promise<boolean> {
    return (
      session.status === 'completed' && session.reviewed === true && this.deps.validateArtifacts(session)
    );
  }

  private async reconcile(record: LaunchRecord): Promise<void> {
    if (record.snapshot.status === 'idle' || record.snapshot.status === 'completed') return;
    const launch = record.snapshot.scenes[0];
    if (launch.status === 'running') await this.reconcileLaunch(record, launch);
    for (const scene of record.snapshot.scenes.slice(1, 4))
      if (scene.status === 'running') await this.reconcileNotification(record, scene);
    if (record.snapshot.scenes.some((scene) => scene.status === 'failed')) record.snapshot.status = 'failed';
    await this.saveRecord(record);
  }

  private async reconcileLaunch(record: LaunchRecord, scene: LaunchScene): Promise<void> {
    const state = await this.deps.load();
    if (state.roadmap?.launchId !== record.snapshot.id) return;
    const tasks = state.commitments.filter(
      (item) =>
        item.launchId === record.snapshot.id &&
        ['product', 'marketing', 'forecast'].includes(item.launchStep ?? ''),
    );
    if (state.roadmap?.status === 'failed')
      return this.fail(scene, state.roadmap.message || 'Launch planning failed.');
    if (
      tasks.length !== 3 ||
      new Set(tasks.map((item) => item.launchStep)).size !== 3 ||
      tasks.some((item) => !item.sessionId)
    )
      return;
    const order = ['product', 'marketing', 'forecast'];
    scene.sessionIds = tasks
      .sort((a, b) => order.indexOf(a.launchStep!) - order.indexOf(b.launchStep!))
      .map((item) => item.sessionId!);
    const sessions = await this.sessions(scene.sessionIds);
    const failed = sessions.find((session) => session.status === 'failed');
    if (failed) return this.fail(scene, failed.activity || 'Initial launch work failed.');
    const verified = await Promise.all(sessions.map((session) => this.verified(session)));
    if (
      sessions.some(
        (session, index) => session.status === 'completed' && session.reviewed && !verified[index],
      )
    )
      return this.fail(scene, 'Initial launch work ended without verified artifacts.');
    if (!verified.every(Boolean)) return;
    scene.status = 'completed';
    record.snapshot.scenes[1].status = 'ready';
    await this.checkpoint(record, 'Initial launch work complete');
  }

  private async reconcileNotification(record: LaunchRecord, scene: LaunchScene): Promise<void> {
    const demo = await this.deps.demoSnapshot();
    const notification = demo.notifications.find((item) => item.id === scene.notificationId);
    if (!notification) return this.fail(scene, 'The source notification is unavailable.');
    scene.sessionIds = [notification.triageSessionId, notification.sessionId].filter(
      (value): value is string => !!value,
    );
    if (notification.status === 'ignored')
      return this.fail(scene, 'The launch request was ignored during triage. Retry to classify it again.');
    if (notification.status === 'failed') return this.fail(scene, notification.error || 'The scene failed.');
    if (notification.status !== 'completed' || !notification.sessionId) return;
    const session =
      demo.sessions.find((item) => item.id === notification.sessionId) ??
      (await this.deps.getSession(notification.sessionId));
    if (!(await this.verified(session)))
      return this.fail(scene, 'The scene ended without verified artifacts.');
    scene.status = 'completed';
    const index = record.snapshot.scenes.indexOf(scene);
    record.snapshot.scenes[index + 1].status = 'ready';
    await this.checkpoint(record, `${scene.title} complete`);
  }

  private async sessionFor(record: LaunchRecord, step: LaunchStep): Promise<CloudSession> {
    const state = await this.deps.load();
    const task = state.commitments.find(
      (item) => item.launchId === record.snapshot.id && item.launchStep === step,
    );
    if (!task?.sessionId) throw new Error(`The ${step} launch session is missing.`);
    const session = await this.deps.getSession(task.sessionId);
    if (!(await this.verified(session))) throw new Error(`The ${step} launch artifact is not verified.`);
    return session;
  }

  private async artifactsFor(record: LaunchRecord, steps: LaunchStep[]): Promise<DemoAttachment[]> {
    const files: DemoAttachment[] = [];
    for (const step of steps) {
      const session = await this.sessionFor(record, step);
      for (const artifact of session.artifacts ?? []) {
        if (!/\.(md|csv|txt|pdf)$/i.test(artifact.filePath)) continue;
        files.push({
          name: `${step}-${path.basename(artifact.filePath).replace(/\.pdf$/i, '.md')}`,
          mediaType: 'text/plain',
          content: artifact.content,
        });
      }
      if (step === 'forecast' || step === 'revision') {
        if (!session.workspace) throw new Error('The forecast workspace is missing.');
        files.push({
          name: step === 'forecast' ? 'original-forecast.csv' : 'revised-forecast.csv',
          mediaType: 'text/csv',
          content: await readFile(path.join(session.workspace, 'forecast.csv'), 'utf8'),
        });
      }
    }
    return files;
  }

  private async dispatch(record: LaunchRecord, scene: LaunchScene): Promise<void> {
    try {
      record.dispatchKeys ??= {};
      const idempotencyKey = (record.dispatchKeys[scene.id] ??=
        `${record.snapshot.id}:${scene.id}:${randomUUID()}`);
      await this.saveRecord(record);
      let input: DemoTrigger;
      let task: LaunchTask;
      if (scene.id === 'investor') {
        const files = await this.artifactsFor(record, ['forecast']);
        for (const name of ['assumptions.csv', 'forecast-contract.md'])
          files.push({
            name,
            mediaType: 'text/plain',
            content: await readFile(path.join(demoDataPath, 'launch', name), 'utf8'),
          });
        files.push({
          name: 'competitor-scenario.csv',
          mediaType: 'text/csv',
          content: await readFile(path.join(demoDataPath, 'launch', 'competitor-scenario.csv'), 'utf8'),
        });
        input = {
          kind: 'email',
          idempotencyKey,
          title: 'Email from Nina Park: [ACTION] Revise the Little Office forecast',
          content: await readFile(path.join(demoDataPath, 'launch', 'competitor-email.md'), 'utf8'),
          attachments: files,
        };
        task = {
          kind: 'report',
          title: 'Revise the Little Office forecast',
          files,
          project: 'little-office',
          launchId: record.snapshot.id,
          launchStep: 'revision',
        };
      } else if (scene.id === 'bug') {
        const product = await this.sessionFor(record, 'product');
        if (!product.workspace) throw new Error('The product workspace is missing.');
        const files = await this.artifactsFor(record, ['product']);
        files.push({
          name: 'actual-product-screenshot.png',
          mediaType: 'image/png',
          content: (await readFile(path.join(product.workspace, 'little-office-launch-bug.png'))).toString(
            'base64',
          ),
          encoding: 'base64',
        });
        input = {
          kind: 'slack',
          idempotencyKey,
          title: 'Slack #launch: Send first request is missing at 960px',
          content:
            'The attached actual Little Office screenshot at 960 by 720 pixels shows the launch welcome banner without its Send first request button. This is a disclosed demo regression staged after the product build. Reproduce it in the same product code, fix the responsive CSS, run the focused test and build, and prepare a simulated PR. Do not publish it.',
          attachments: files,
        };
        task = {
          kind: 'bug',
          title: 'Restore the Little Office launch button',
          files,
          project: 'little-office',
          launchId: record.snapshot.id,
          launchStep: 'bug',
          parentWorkspace: product.workspace,
          parentSessionId: product.id,
        };
      } else {
        const files = await this.artifactsFor(record, ['marketing', 'revision', 'bug']);
        input = {
          kind: 'meeting',
          idempotencyKey,
          title: 'Meeting with Elena Torres about Little Office',
          content: await readFile(path.join(demoDataPath, 'launch', 'reporter-meeting.md'), 'utf8'),
          attachments: files,
        };
        task = {
          kind: 'meeting',
          title: 'Prepare the Little Office reporter briefing',
          files,
          project: 'little-office',
          launchId: record.snapshot.id,
          launchStep: 'reporter',
        };
      }
      const notification = await this.deps.trigger(input, task);
      record.notificationIds = [...(record.notificationIds ?? []), notification.id];
      scene.notificationId = notification.id;
      scene.sessionIds = [notification.triageSessionId, notification.sessionId].filter(
        (value): value is string => !!value,
      );
      scene.status = 'running';
      scene.error = undefined;
    } catch (error) {
      this.fail(scene, error);
      record.snapshot.status = 'failed';
    }
  }

  private async completeCelebration(record: LaunchRecord, scene: LaunchScene): Promise<void> {
    const state = await this.deps.load();
    if (state.roadmap?.launchId !== record.snapshot.id || state.roadmap.status !== 'complete')
      throw new Error('The launch roadmap is not complete.');
    const required: LaunchStep[] = ['product', 'marketing', 'forecast', 'revision', 'bug', 'reporter'];
    const tasks = state.commitments.filter(
      (item) => item.launchId === record.snapshot.id && required.includes(item.launchStep!),
    );
    if (
      required.some(
        (step) =>
          !tasks.some((item) => item.launchStep === step && item.status === 'done' && !!item.sessionId),
      )
    )
      throw new Error('Every launch step must be reviewed and complete before the celebration.');
    const sessions = await this.sessions(tasks.map((item) => item.sessionId!).filter(Boolean));
    if (!(await Promise.all(sessions.map((session) => this.verified(session)))).every(Boolean))
      throw new Error('Every launch deliverable must pass verification before the celebration.');
    scene.status = 'completed';
    record.snapshot.status = 'completed';
    record.snapshot.celebrationId = randomUUID();
    await this.checkpoint(record, 'Launch complete');
  }
}
