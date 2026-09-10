import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import initSqlJs, { type Database } from 'sql.js';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { OfficeEventInputSchema } from '../shared/office-events';
import type {
  OfficeEventInput,
  OfficeEvent,
  OfficeAuditExport,
  OfficeAuditVerification,
  OfficeCheckpointRecord,
  OfficeFrameRecord,
  OfficeRange,
  OfficeRecordingBounds,
  OfficeReplayBundle,
} from '../shared/office-events';
import type { AppState, HistoryEntry, WorkEvent, OfficeFrame } from '../shared/types';
import type { Snapshot } from '../src/shared/types';

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .filter((key) => item[key] !== undefined)
            .map((key) => [key, item[key]]),
        )
      : item,
  );
}
const digest = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
interface AuditMetadata {
  recordingStartedAt: string;
  legacyActivityCount: number;
  lastRecordedAt: number;
  ledgerCount: number;
  ledgerHeadHash: string | null;
  frameCount: number;
  frameHeadHash: string | null;
  checkpointCount: number;
  checkpointHeadHash: string | null;
}
const checkpointPayload = (record: OfficeCheckpointRecord) => ({
  version: record.version,
  id: record.id,
  time: record.time,
  reason: record.reason,
  recordedAt: record.recordedAt,
  stateHash: record.stateHash,
  previousHash: record.previousHash,
});
const framePayload = (record: OfficeFrameRecord) => ({
  version: record.version,
  sequence: record.sequence,
  frame: record.frame,
  recordedAt: record.recordedAt,
  previousHash: record.previousHash,
});
const frameSchema = z.strictObject({
  time: z.number().int().nonnegative(),
  sceneTime: z.number().finite().nonnegative(),
  listening: z.boolean(),
  level: z.number().min(0).max(1),
  motion: z.boolean(),
});

export class SnapshotStore {
  readonly filePath: string;
  private constructor(
    filePath: string,
    private db: Database,
    private clock: () => number,
  ) {
    this.filePath = filePath;
  }

  static async open(dataDir: string, options: { now?: () => number } = {}): Promise<SnapshotStore> {
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
    db.run(
      'CREATE TABLE IF NOT EXISTS hq_office_events (sequence INTEGER PRIMARY KEY, id TEXT UNIQUE NOT NULL, recorded_at INTEGER NOT NULL, occurred_at INTEGER NOT NULL, input_hash TEXT NOT NULL, value TEXT NOT NULL)',
    );
    db.run(
      'CREATE TABLE IF NOT EXISTS hq_checkpoint_evidence (history_id INTEGER PRIMARY KEY, recorded_at INTEGER NOT NULL, value TEXT NOT NULL)',
    );
    db.run(
      'CREATE TABLE IF NOT EXISTS hq_frame_evidence (sequence INTEGER PRIMARY KEY, time INTEGER UNIQUE NOT NULL, recorded_at INTEGER NOT NULL, value TEXT NOT NULL)',
    );
    db.run(
      'CREATE TABLE IF NOT EXISTS hq_audit_metadata (id INTEGER PRIMARY KEY CHECK (id=1), value TEXT NOT NULL)',
    );
    const store = new SnapshotStore(filePath, db, options.now ?? Date.now);
    if (!db.exec('SELECT value FROM hq_audit_metadata WHERE id=1')[0]?.values.length) {
      const now = store.clock();
      store.saveAuditMetadata({
        recordingStartedAt: new Date(now).toISOString(),
        legacyActivityCount: Number(db.exec('SELECT COUNT(*) FROM hq_activity')[0].values[0][0]),
        lastRecordedAt: now,
        ledgerCount: 0,
        ledgerHeadHash: null,
        frameCount: 0,
        frameHeadHash: null,
        checkpointCount: 0,
        checkpointHeadHash: null,
      });
      // Existing history remains explicitly unverified; migration never hashes it as new evidence.
      await store.flush();
    }
    return store;
  }

  private auditMetadata(): AuditMetadata {
    return JSON.parse(
      String(this.db.exec('SELECT value FROM hq_audit_metadata WHERE id=1')[0].values[0][0]),
    ) as AuditMetadata;
  }
  private saveAuditMetadata(value: AuditMetadata) {
    this.db.run(
      'INSERT INTO hq_audit_metadata(id,value) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value',
      [JSON.stringify(value)],
    );
  }
  private recordedAt(meta: AuditMetadata) {
    const now = Math.max(this.clock(), meta.lastRecordedAt);
    if (!Number.isSafeInteger(now) || now < 0) throw new Error('The recording clock is invalid.');
    meta.lastRecordedAt = now;
    return new Date(now).toISOString();
  }
  private transaction<T>(action: () => T): T {
    this.db.run('BEGIN IMMEDIATE');
    try {
      const result = action();
      this.db.run('COMMIT');
      return result;
    } catch (error) {
      this.db.run('ROLLBACK');
      throw error;
    }
  }
  private appendOfficeEvent(input: OfficeEventInput): OfficeEvent {
    const parsed = OfficeEventInputSchema.parse(input),
      inputHash = digest(parsed);
    const existing = this.db.exec('SELECT input_hash,value FROM hq_office_events WHERE id=?', [parsed.id])[0]
      ?.values[0];
    if (existing) {
      if (existing[0] !== inputHash)
        throw new Error(`Office event ${parsed.id} already exists with different content.`);
      return JSON.parse(String(existing[1])) as OfficeEvent;
    }
    const meta = this.auditMetadata(),
      recordedAt = this.recordedAt(meta);
    const body = {
      ...parsed,
      version: 1 as const,
      sequence: meta.ledgerCount + 1,
      occurredAt: parsed.occurredAt ?? recordedAt,
      recordedAt,
      previousHash: meta.ledgerHeadHash,
    };
    const event: OfficeEvent = { ...body, hash: digest(body) };
    this.db.run(
      'INSERT INTO hq_office_events(sequence,id,recorded_at,occurred_at,input_hash,value) VALUES(?,?,?,?,?,?)',
      [
        event.sequence,
        event.id,
        Date.parse(recordedAt),
        Date.parse(event.occurredAt),
        inputHash,
        JSON.stringify(event),
      ],
    );
    meta.ledgerCount = event.sequence;
    meta.ledgerHeadHash = event.hash;
    this.saveAuditMetadata(meta);
    return event;
  }
  async recordOfficeEvent(input: OfficeEventInput): Promise<OfficeEvent> {
    const event = this.transaction(() => this.appendOfficeEvent(input));
    await this.flush();
    return event;
  }
  async putAudited(key: string, value: unknown, events: OfficeEventInput[]): Promise<void> {
    this.transaction(() => {
      this.db.run(
        'INSERT INTO hq_documents(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
        [key, JSON.stringify(value)],
      );
      for (const event of events) this.appendOfficeEvent(event);
    });
    await this.flush();
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
    now = this.clock(),
  ): Promise<void> {
    const previous = this.get<AppState>('workspace');
    const data = JSON.stringify(state);
    if (!force && JSON.stringify(previous) === data) return;
    if (!Number.isSafeInteger(now) || now < 0) throw new Error('The checkpoint timestamp is invalid.');
    this.transaction(() => {
      this.db.run(
        'INSERT INTO hq_documents(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
        ['workspace', data],
      );
      this.db.run('INSERT INTO hq_history(time,reason,state) VALUES (?,?,?)', [now, reason, data]);
      const checkpointId = Number(this.db.exec('SELECT last_insert_rowid()')[0].values[0][0]);
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
            source: e.sessionId ? 'cloud' : 'local',
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
      const meta = this.auditMetadata();
      const recordedAt = this.recordedAt(meta);
      const checkpoint: OfficeCheckpointRecord = {
        version: 1,
        id: checkpointId,
        time: now,
        reason,
        state,
        recordedAt,
        stateHash: digest(state),
        previousHash: meta.checkpointHeadHash,
        hash: null,
      };
      checkpoint.hash = digest(checkpointPayload(checkpoint));
      const { state: _state, ...evidence } = checkpoint;
      this.db.run('INSERT INTO hq_checkpoint_evidence(history_id,recorded_at,value) VALUES(?,?,?)', [
        checkpointId,
        Date.parse(recordedAt),
        JSON.stringify(evidence),
      ]);
      meta.checkpointCount++;
      meta.checkpointHeadHash = checkpoint.hash;
      this.saveAuditMetadata(meta);
      this.appendOfficeEvent({
        id: `checkpoint:${checkpointId}`,
        kind: 'checkpoint.saved',
        summary: `Workspace checkpoint saved: ${reason}`,
        source: 'system',
        occurredAt: new Date(now).toISOString(),
        checkpointId,
        checkpointHash: checkpoint.hash,
      });
      const profile = (employee: AppState['employees'][number]) => ({
        name: employee.name,
        jobTitle: employee.jobTitle,
        personality: employee.personality,
        skills: employee.skills,
        color: employee.color,
        avatar: employee.avatar,
        appearance: employee.appearance,
        agent: employee.agent,
      });
      if (previous)
        for (const employee of state.employees) {
          const old = previous.employees.find((item) => item.id === employee.id);
          if (!old || canonical(profile(old)) !== canonical(profile(employee)))
            this.appendOfficeEvent({
              id: `employee-config:${checkpointId}:${employee.id}`,
              kind: 'employee.configured',
              summary: `Saved configuration for ${employee.name}`,
              source: state.demo ? 'system' : 'user',
              employeeId: employee.id,
              ...(employee.agent ? { configRevision: employee.agent.revision } : {}),
              occurredAt: new Date(now).toISOString(),
              checkpointId,
              checkpointHash: checkpoint.hash,
            });
        }
    });
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
  async recordFrame(frame: OfficeFrame) {
    const parsed = frameSchema.parse(frame);
    this.transaction(() => {
      const old = this.db.exec('SELECT value FROM hq_frames WHERE time=?', [parsed.time])[0]?.values[0]?.[0];
      if (typeof old === 'string') {
        if (canonical(JSON.parse(old)) !== canonical(parsed))
          throw new Error('A recorded frame cannot be changed at the same timestamp.');
        return;
      }
      const meta = this.auditMetadata();
      const record: OfficeFrameRecord = {
        version: 1,
        sequence: meta.frameCount + 1,
        frame: parsed,
        recordedAt: this.recordedAt(meta),
        previousHash: meta.frameHeadHash,
        hash: null,
      };
      record.hash = digest(framePayload(record));
      this.db.run('INSERT INTO hq_frames(time,value) VALUES(?,?)', [parsed.time, JSON.stringify(parsed)]);
      const { frame: _frame, ...evidence } = record;
      this.db.run('INSERT INTO hq_frame_evidence(sequence,time,recorded_at,value) VALUES(?,?,?,?)', [
        record.sequence!,
        parsed.time,
        Date.parse(record.recordedAt!),
        JSON.stringify(evidence),
      ]);
      meta.frameCount++;
      meta.frameHeadHash = record.hash;
      this.saveAuditMetadata(meta);
    });
    await this.flush();
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
  private auditData(at?: number): OfficeAuditExport {
    const meta = this.auditMetadata();
    const ledger = (
      this.db.exec(
        `SELECT value FROM hq_office_events${at === undefined ? '' : ' WHERE recorded_at<=?'} ORDER BY sequence`,
        at === undefined ? [] : [at],
      )[0]?.values ?? []
    ).map((row) => JSON.parse(String(row[0])) as OfficeEvent);
    const checkpoints = (
      this.db.exec(
        `SELECT h.id,h.time,h.reason,h.state,e.value FROM hq_history h LEFT JOIN hq_checkpoint_evidence e ON e.history_id=h.id${at === undefined ? '' : ' WHERE e.recorded_at IS NULL OR e.recorded_at<=?'} ORDER BY h.id`,
        at === undefined ? [] : [at],
      )[0]?.values ?? []
    ).map(
      (row) =>
        ({
          version: 1 as const,
          recordedAt: null,
          stateHash: null,
          previousHash: null,
          hash: null,
          ...(typeof row[4] === 'string' ? JSON.parse(row[4]) : {}),
          id: Number(row[0]),
          time: Number(row[1]),
          reason: String(row[2]),
          state: JSON.parse(String(row[3])) as AppState,
        }) as OfficeCheckpointRecord,
    );
    const frames = (
      this.db.exec(
        `SELECT f.value,e.value FROM hq_frames f LEFT JOIN hq_frame_evidence e ON e.time=f.time${at === undefined ? '' : ' WHERE e.recorded_at IS NULL OR e.recorded_at<=?'} ORDER BY e.sequence,f.time`,
        at === undefined ? [] : [at],
      )[0]?.values ?? []
    ).map(
      (row) =>
        ({
          version: 1 as const,
          sequence: null,
          recordedAt: null,
          previousHash: null,
          hash: null,
          ...(typeof row[1] === 'string' ? JSON.parse(row[1]) : {}),
          frame: JSON.parse(String(row[0])) as OfficeFrame,
        }) as OfficeFrameRecord,
    );
    const verifiedCheckpoints = checkpoints.filter((c) => c.hash),
      verifiedFrames = frames.filter((f) => f.hash);
    const anchor =
      at === undefined
        ? {
            ledgerCount: meta.ledgerCount,
            ledgerHeadHash: meta.ledgerHeadHash,
            frameCount: meta.frameCount,
            frameHeadHash: meta.frameHeadHash,
            checkpointCount: meta.checkpointCount,
            checkpointHeadHash: meta.checkpointHeadHash,
          }
        : {
            ledgerCount: ledger.length,
            ledgerHeadHash: ledger.at(-1)?.hash ?? null,
            frameCount: verifiedFrames.length,
            frameHeadHash: verifiedFrames.at(-1)?.hash ?? null,
            checkpointCount: verifiedCheckpoints.length,
            checkpointHeadHash: verifiedCheckpoints.at(-1)?.hash ?? null,
          };
    const data = {
      version: 1 as const,
      algorithm: 'SHA-256' as const,
      createdAt: new Date(at ?? this.clock()).toISOString(),
      recordingStartedAt: meta.recordingStartedAt,
      ledger,
      checkpoints,
      frames,
      legacyActivityCount: meta.legacyActivityCount,
      anchor,
    };
    return { ...data, verification: verifyOfficeAudit(data) };
  }
  exportOfficeAudit(): OfficeAuditExport {
    return this.transaction(() => this.auditData());
  }
  private recordingBounds(data: OfficeAuditExport, at = Number.MAX_SAFE_INTEGER): OfficeRecordingBounds {
    const range = (times: number[]): OfficeRange =>
      times.reduce<OfficeRange>(
        (result, time) => ({
          firstAt: result.firstAt === null ? time : Math.min(result.firstAt, time),
          lastAt: result.lastAt === null ? time : Math.max(result.lastAt, time),
          count: result.count + 1,
        }),
        { firstAt: null, lastAt: null, count: 0 },
      );
    const checkpoints = range(
      data.checkpoints
        .filter((c) => c.time <= at)
        .map((c) => Math.max(c.time, c.recordedAt ? Date.parse(c.recordedAt) : c.time))
        .filter((time) => time <= at),
    );
    const frames = range(
      data.frames
        .filter((f) => f.frame.time <= at)
        .map((f) => Math.max(f.frame.time, f.recordedAt ? Date.parse(f.recordedAt) : f.frame.time))
        .filter((time) => time <= at),
    );
    const events = range(
      data.ledger
        .map((e) => Math.max(Date.parse(e.occurredAt), Date.parse(e.recordedAt)))
        .filter((time) => time <= at),
    );
    const all = [checkpoints, frames, events];
    const first = all.flatMap((r) => (r.firstAt === null ? [] : [r.firstAt])),
      last = all.flatMap((r) => (r.lastAt === null ? [] : [r.lastAt]));
    return {
      firstAt: first.length ? Math.min(...first) : null,
      lastAt: last.length ? Math.max(...last) : null,
      checkpoints,
      frames,
      events,
    };
  }
  officeRecordingBounds(): OfficeRecordingBounds {
    return this.transaction(() => this.recordingBounds(this.auditData(), this.clock()));
  }
  officeReplay(at: number, options: { eventLimit?: number } = {}): OfficeReplayBundle {
    if (!Number.isSafeInteger(at) || at < 0) throw new Error('Choose a valid recorded timestamp.');
    const limit = options.eventLimit ?? 2000;
    if (!Number.isInteger(limit) || limit < 1 || limit > 10000)
      throw new Error('Replay event limit must be between 1 and 10000.');
    return this.transaction(() => {
      // One synchronous SQLite snapshot: no awaits or renderer/live-state lookups can mix time slices.
      const data = this.auditData(at),
        bounds = this.recordingBounds(data, at);
      const checkpoint =
        data.checkpoints.filter((c) => c.time <= at).sort((a, b) => b.time - a.time || b.id - a.id)[0] ??
        null;
      const frame =
        data.frames.filter((f) => f.frame.time <= at).sort((a, b) => b.frame.time - a.frame.time)[0] ?? null;
      const visibleEvents = data.ledger.filter(
        (event) => Date.parse(event.occurredAt) <= at && Date.parse(event.recordedAt) <= at,
      );
      const events = visibleEvents.slice(-limit),
        gaps: string[] = [];
      const checkpointVerified =
        !!checkpoint?.hash &&
        data.verification.ledger.valid &&
        digest(checkpoint.state) === checkpoint.stateHash &&
        digest(checkpointPayload(checkpoint)) === checkpoint.hash &&
        data.ledger.some(
          (e) =>
            e.kind === 'checkpoint.saved' &&
            e.checkpointId === checkpoint.id &&
            e.checkpointHash === checkpoint.hash,
        );
      const frameVerified = !!frame?.hash && digest(framePayload(frame)) === frame.hash;
      if (!checkpoint) gaps.push('No recorded workspace checkpoint exists at or before this time.');
      if (!frame) gaps.push('No recorded office frame exists at or before this time.');
      if (checkpoint && !checkpointVerified)
        gaps.push('The selected checkpoint is legacy or its integrity check failed.');
      if (frame && !frameVerified) gaps.push('The selected frame is legacy or its integrity check failed.');
      if (frame && at - frame.frame.time > 1000)
        gaps.push(
          `No frame was recorded for the last ${at - frame.frame.time} ms; showing the last observed frame without extrapolation.`,
        );
      if (bounds.lastAt !== null && at > bounds.lastAt)
        gaps.push('The requested time is after the last available recorded observation.');
      if (visibleEvents.length > limit)
        gaps.push('Earlier office events were omitted by the replay event limit.');
      if (!data.verification.ledger.valid) gaps.push('The office event hash chain failed verification.');
      if (data.verification.issues.length) gaps.push(...data.verification.issues);
      if (Date.parse(data.recordingStartedAt) > at)
        gaps.push('This time predates the auditable office event ledger.');
      const legacyUnverified =
        !!(checkpoint && !checkpoint.hash) || !!(frame && !frame.hash) || data.verification.legacyUnverified;
      const corruptedCheckpoint = checkpoint?.hash && !checkpointVerified;
      const corruptedFrame = frame?.hash && !frameVerified;
      return {
        requestedAt: at,
        state: checkpoint && !corruptedCheckpoint ? checkpoint.state : null,
        checkpoint: checkpoint
          ? {
              id: checkpoint.id,
              time: checkpoint.time,
              reason: checkpoint.reason,
              hash: checkpoint.hash,
              verified: checkpointVerified,
            }
          : null,
        frame: frame && !corruptedFrame ? frame.frame : null,
        events: data.verification.ledger.valid ? events : [],
        bounds,
        coverage: {
          status:
            !checkpoint && !frame && !events.length
              ? 'unavailable'
              : gaps.length || legacyUnverified
                ? 'partial'
                : 'verified',
          from: bounds.firstAt,
          through: bounds.lastAt,
          gaps,
          legacyUnverified,
          eventsTruncated: visibleEvents.length > limit,
        },
        audit: data.verification,
      };
    });
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

/** Recompute exported evidence. This proves local hash consistency, not external attestation. */
export function verifyOfficeAudit(
  data: Omit<OfficeAuditExport, 'verification'> | OfficeAuditExport,
): OfficeAuditVerification {
  const issues: string[] = [];
  if (data.version !== 1 || data.algorithm !== 'SHA-256')
    issues.push('Unsupported office audit version or hash algorithm.');
  const checkpoints = { verified: 0, legacy: 0, invalid: 0 },
    frames = { verified: 0, legacy: 0, invalid: 0 };
  let previous: string | null = null,
    sequence = 0;
  const ids = new Set<string>();
  let lastRecordedAt = -1;
  for (const event of data.ledger) {
    const { hash, ...payload } = event;
    const {
      version: _version,
      sequence: _sequence,
      recordedAt: _recordedAt,
      previousHash: _previousHash,
      ...input
    } = payload;
    if (
      event.version !== 1 ||
      !OfficeEventInputSchema.safeParse(input).success ||
      !Number.isFinite(Date.parse(event.recordedAt)) ||
      Date.parse(event.recordedAt) < lastRecordedAt ||
      event.sequence !== sequence + 1 ||
      event.previousHash !== previous ||
      digest(payload) !== hash ||
      ids.has(event.id)
    )
      issues.push(`Office event ${event.id} failed hash, order, or schema verification.`);
    ids.add(event.id);
    previous = hash;
    sequence = event.sequence;
    lastRecordedAt = Date.parse(event.recordedAt);
  }
  if (data.anchor.ledgerCount !== data.ledger.length || data.anchor.ledgerHeadHash !== previous)
    issues.push('The office event ledger does not match its recorded head.');
  const ledgerValid = issues.length === 0;
  const checkpointAnchors = new Map(
    data.ledger
      .filter((event) => event.kind === 'checkpoint.saved')
      .map((event) => [event.checkpointId, event.checkpointHash]),
  );
  previous = null;
  for (const checkpoint of data.checkpoints) {
    if (!checkpoint.hash) {
      checkpoints.legacy++;
      continue;
    }
    const valid =
      checkpoint.version === 1 &&
      checkpoint.previousHash === previous &&
      digest(checkpoint.state) === checkpoint.stateHash &&
      digest(checkpointPayload(checkpoint)) === checkpoint.hash &&
      checkpointAnchors.get(checkpoint.id) === checkpoint.hash;
    if (valid) checkpoints.verified++;
    else {
      checkpoints.invalid++;
      issues.push(`Checkpoint ${checkpoint.id} failed content, chain, or ledger-anchor verification.`);
    }
    previous = checkpoint.hash;
  }
  if (
    data.anchor.checkpointCount !== checkpoints.verified + checkpoints.invalid ||
    data.anchor.checkpointHeadHash !== previous
  )
    issues.push('The checkpoint chain does not match its recorded head.');
  previous = null;
  sequence = 0;
  for (const frame of data.frames) {
    if (!frame.hash) {
      frames.legacy++;
      continue;
    }
    const valid =
      frame.version === 1 &&
      frameSchema.safeParse(frame.frame).success &&
      frame.sequence === sequence + 1 &&
      frame.previousHash === previous &&
      digest(framePayload(frame)) === frame.hash;
    if (valid) frames.verified++;
    else {
      frames.invalid++;
      issues.push(`Office frame ${frame.frame.time} failed content or chain verification.`);
    }
    previous = frame.hash;
    sequence = frame.sequence ?? sequence;
  }
  if (data.anchor.frameCount !== frames.verified + frames.invalid || data.anchor.frameHeadHash !== previous)
    issues.push('The frame chain does not match its recorded head.');
  const legacyUnverified = checkpoints.legacy > 0 || frames.legacy > 0 || data.legacyActivityCount > 0;
  return {
    verified: issues.length === 0 && !legacyUnverified,
    integrityScope: 'local-hash-consistency',
    ledger: { count: data.ledger.length, headHash: data.ledger.at(-1)?.hash ?? null, valid: ledgerValid },
    checkpoints,
    frames,
    issues,
    legacyUnverified,
  };
}
