import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import initSqlJs, { type Database } from 'sql.js';
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
      locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm'),
    });
    const filePath = path.join(dataDir, 'office.sqlite');
    let db: Database;
    try {
      db = new SQL.Database(await readFile(filePath));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      db = new SQL.Database();
    }
    db.run('CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK (id = 1), snapshot TEXT NOT NULL)');
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
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(temporary, Buffer.from(this.db.export()), { mode: 0o600 });
    try {
      await rename(temporary, this.filePath);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  }

  close(): void {
    this.db.close();
  }
}
