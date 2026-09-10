import type { AppState, CloudSettings, DesktopAPI } from '../../shared/types';
import { isState } from './store';

type StartupCallbacks = {
  workspaceLoaded: (state: AppState | null) => void;
  workspaceFailed: () => void;
  connectionLoaded: (settings: CloudSettings) => void;
  connectionFailed: () => void;
};

/** Local data must load independently of the optional AI connection. */
export function beginWorkspaceStartup(
  api: Pick<DesktopAPI, 'loadState' | 'getCloudSettings'>,
  callbacks: StartupCallbacks,
) {
  let active = true;
  const workspace = Promise.resolve()
    .then(() => api.loadState())
    .then((saved) => {
      if (saved !== null && !isState(saved)) throw new Error('Invalid saved workspace');
      if (active) callbacks.workspaceLoaded(saved);
    })
    .catch(() => {
      if (active) callbacks.workspaceFailed();
    });
  const connection = Promise.resolve()
    .then(() => api.getCloudSettings())
    .then((settings) => {
      if (active) callbacks.connectionLoaded(settings);
    })
    .catch(() => {
      if (active) callbacks.connectionFailed();
    });
  return {
    cancel: () => {
      active = false;
    },
    settled: Promise.all([workspace, connection]).then(() => undefined),
  };
}
