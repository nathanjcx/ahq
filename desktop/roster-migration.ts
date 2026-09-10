import type { SnapshotStore } from '../runtime/store';
import { StateSchema } from '../shared/schemas';
import type { AppState } from '../shared/types';
import { freshWorkspaceState, isDefaultRoster } from '../src/lib/store';

const migrationKey = 'default-roster-v2';
const migrations = new WeakMap<SnapshotStore, Promise<void>>();

async function migrateRoster(database: SnapshotStore, state: AppState): Promise<void> {
  // Earlier builds completed this migration but accidentally wrote the v1 key.
  // Promote that marker without replacing employees or clearing their work.
  if (database.get<boolean>('default-roster-v1') !== true && isDefaultRoster(state.employees)) {
    await database.saveHQ(
      {
        ...state,
        employees: freshWorkspaceState().employees,
        roadmap: undefined,
        commitments: [],
        messages: [],
        approvals: [],
        events: [],
        demo: false,
      },
      'Replaced the default employee roster',
      true,
    );
  }
  await database.put(migrationKey, true);
}

export async function loadDesktopWorkspace(database: SnapshotStore): Promise<AppState | null> {
  const pending = migrations.get(database);
  if (pending) await pending;
  const value = database.get<AppState>('workspace');
  if (!value) return null;
  const state = StateSchema.parse(value);
  if (database.get<boolean>(migrationKey) === true) return state;

  const migration = migrateRoster(database, state);
  migrations.set(database, migration);
  try {
    await migration;
  } finally {
    migrations.delete(database);
  }
  return StateSchema.parse(database.get<AppState>('workspace'));
}
