import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import initSqlJs, { type Database } from 'sql.js';
import { createRequire } from 'node:module';
import type { AppState, HistoryEntry, WorkEvent, OfficeFrame } from '../shared/types';
import type { Snapshot } from '../src/shared/types';

export class SnapshotStore {
  readonly filePath: string;
  private constructor(
    filePath: string,
    private db: Database,
  ) {
    this.filePath = filePath;
  }

  static async open(dataDir: string): Promise<SnapshotStore> {
    await mkdir(dataDir, { recursive: true });
    const SQL = await initSqlJs({
      locateFile: () =>
        (typeof require === 'function'
          ? require
          : createRequire(path.join(process.cwd(), 'package.json'))
        ).resolve('sql.js/dist/sql-wasm.wasm'),
    });
    const filePath = path.join(dataDir, 'office.sqlite');
    let db: Database;
    try {
      db = new SQL.Database(await readFile(filePath));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      db = new SQL.Database();
    }
    db.run(
      'CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK (id = 1), snapshot TEXT NOT NULL)',
    );
    db.run('CREATE TABLE IF NOT EXISTS hq_frames (time INTEGER PRIMARY KEY, value TEXT NOT NULL)');
    db.run('CREATE TABLE IF NOT EXISTS hq_documents (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    db.run(
      'CREATE TABLE IF NOT EXISTS hq_history (id INTEGER PRIMARY KEY AUTOINCREMENT, time INTEGER NOT NULL, reason TEXT NOT NULL, state TEXT NOT NULL)',
    );
    db.run(
      'CREATE TABLE IF NOT EXISTS hq_activity (id TEXT PRIMARY KEY, time TEXT NOT NULL, value TEXT NOT NULL)',
    );
    return new SnapshotStore(filePath, db);
  }

  load(): Snapshot | undefined {
    const result = this.db.exec('SELECT snapshot FROM state WHERE id = 1');
    const value = result[0]?.values[0]?.[0];
    if (typeof value !== 'string') return undefined;
    return JSON.parse(value) as Snapshot;
  }

  async save(snapshot: Snapshot): Promise<void> {
    this.db.run(
      'INSERT INTO state (id, snapshot) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET snapshot = excluded.snapshot',
      [JSON.stringify(snapshot)],
    );
    await this.flush();
  }

  get<T>(key: string): T | undefined {
    const row = this.db.exec('SELECT value FROM hq_documents WHERE key = ?', [key])[0]?.values[0]?.[0];
    return typeof row === 'string' ? (JSON.parse(row) as T) : undefined;
  }
  async put(key: string, value: unknown): Promise<void> {
    this.db.run(
      'INSERT INTO hq_documents(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      [key, JSON.stringify(value)],
    );
    await this.flush();
  }
  async saveHQ(
    state: AppState,
    reason = 'Workspace changed',
    force = false,
    now = Date.now(),
  ): Promise<void> {
    const previous = this.get<AppState>('workspace');
    const data = JSON.stringify(state);
    if (!force && JSON.stringify(previous) === data) return;
    this.db.run(
      'INSERT INTO hq_documents(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      ['workspace', data],
    );
    this.db.run('INSERT INTO hq_history(time,reason,state) VALUES (?,?,?)', [now, reason, data]);
    for (const event of state.events) this.insertActivity(event);
    if (previous) {
      const oldMessages = new Set(previous.messages.map((m) => m.id));
      for (const m of state.messages.filter((m) => !oldMessages.has(m.id)))
        this.insertActivity({
          id: `message:${m.id}`,
          time: m.time,
          employeeId: m.authorId === 'you' ? undefined : m.authorId,
          text: m.text,
          kind: m.channel === 'announce' ? 'announcement' : 'work',
          source: m.authorId === 'you' ? 'local' : 'cloud',
        });
      const changed = state.employees.filter(
        (e) => JSON.stringify(e) !== JSON.stringify(previous.employees.find((p) => p.id === e.id)),
      );
      for (const e of changed)
        this.insertActivity({
          id: `profile:${now}:${e.id}`,
          employeeId: e.id,
          time: new Date(now).toISOString(),
          text: `${e.name}: ${e.activity}`,
          kind: 'system',
          source: e.sessionId?.startsWith('chatgpt-') ? 'chatgpt' : e.sessionId ? 'cloud' : 'local',
        });
      if (previous.goal !== state.goal)
        this.insertActivity({
          id: `goal:${now}`,
          time: new Date(now).toISOString(),
          text: `Goal updated: ${state.goal}`,
          kind: 'announcement',
          source: 'local',
        });
    }
    await this.flush();
  }
  private insertActivity(event: WorkEvent) {
    this.db.run('INSERT OR IGNORE INTO hq_activity(id,time,value) VALUES (?,?,?)', [
      event.id,
      event.time,
      JSON.stringify(event),
    ]);
  }
  async log(event: WorkEvent) {
    this.insertActivity(event);
    await this.flush();
  }
  activity(): WorkEvent[] {
    return (this.db.exec('SELECT value FROM hq_activity ORDER BY time,id')[0]?.values ?? []).map(
      (row) => JSON.parse(String(row[0])) as WorkEvent,
    );
  }
  history(): HistoryEntry[] {
    return (this.db.exec('SELECT id,time,reason FROM hq_history ORDER BY id')[0]?.values ?? []).map(
      (row) => ({ id: Number(row[0]), time: Number(row[1]), reason: String(row[2]) }),
    );
  }
  historyState(id: number): AppState {
    const row = this.db.exec('SELECT state FROM hq_history WHERE id=?', [id])[0]?.values[0]?.[0];
    if (typeof row !== 'string') throw new Error('That checkpoint is unavailable.');
    return JSON.parse(row) as AppState;
  }
  private lastFrameFlush = 0;
  async recordFrame(frame: OfficeFrame) {
    this.db.run('INSERT OR REPLACE INTO hq_frames(time,value) VALUES (?,?)', [
      frame.time,
      JSON.stringify(frame),
    ]);
    if (frame.time - this.lastFrameFlush > 1000 || !frame.listening) {
      this.lastFrameFlush = frame.time;
      await this.flush();
    }
  }
  frameAt(time: number): OfficeFrame | null {
    const row = this.db.exec('SELECT value FROM hq_frames WHERE time<=? ORDER BY time DESC LIMIT 1', [
      time,
    ])[0]?.values[0]?.[0];
    if (typeof row !== 'string') return null;
    const frame = JSON.parse(row) as OfficeFrame;
    return {
      ...frame,
      sceneTime: frame.sceneTime + (frame.motion && !frame.listening ? (time - frame.time) / 1000 : 0),
    };
  }
  private writes: Promise<void> = Promise.resolve();
  private flush(): Promise<void> {
    const bytes = Buffer.from(this.db.export());
    const write = this.writes.then(async () => {
      const temporary = `${this.filePath}.${process.pid}.tmp`;
      await writeFile(temporary, bytes, { mode: 0o600 });
      try {
        await rename(temporary, this.filePath);
      } catch (error) {
        await unlink(temporary).catch(() => undefined);
        throw error;
      }
    });
    this.writes = write.catch(() => undefined);
    return write;
  }

  async drain() {
    await this.writes;
  }
  close(): void {
    this.db.close();
  }
}
