import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  ChevronRight,
  Circle,
  History,
  LoaderCircle,
  RotateCcw,
  Sparkles,
} from 'lucide-react';
import type { LaunchSceneId, LaunchSnapshot } from '../../shared/launch';
import './launch-panel.css';

const GOAL =
  'Launch Little Office with a clear story for investors, a reliable product, and a reporter ready to listen.';
const SCENE_COPY: Record<LaunchSceneId, { source: string; prompt: string }> = {
  launch: { source: 'Launch brief', prompt: 'Start the launch brief and split the work across the office.' },
  investor: {
    source: 'Investor email',
    prompt: 'An investor asks for a sharper forecast. The team revises it.',
  },
  bug: {
    source: 'Slack screenshot',
    prompt: 'A screenshot exposes a product bug. The team traces it to a fix.',
  },
  reporter: {
    source: 'Reporter meeting',
    prompt: 'The reporter is ready. Pull together the talking points.',
  },
  celebrate: { source: 'Launch day', prompt: 'Everything is in place. Open the doors.' },
};

const statusLabel: Record<string, string> = {
  locked: 'Locked',
  ready: 'Ready',
  running: 'In progress',
  completed: 'Done',
  failed: 'Needs attention',
};

function errorText(error: unknown) {
  return error instanceof Error ? error.message : 'The launch action failed.';
}

export default function LaunchPanel({
  notify,
  onWorkUpdate,
  onSelectSession,
  onRestore,
}: {
  notify: (message: string) => void;
  onWorkUpdate: () => Promise<void>;
  onSelectSession: (id: string | null) => void;
  onRestore: () => void;
}) {
  const [snapshot, setSnapshot] = useState<LaunchSnapshot | null>(null);
  const [expanded, setExpanded] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pollError, setPollError] = useState('');
  const [selectedScene, setSelectedScene] = useState<LaunchSceneId | null>(null);
  const lastVersion = useRef('');
  const revision = useRef(0);
  const actionPending = useRef(false);
  const refreshRef = useRef(onWorkUpdate);
  refreshRef.current = onWorkUpdate;
  const celebrated = useRef<string | null>(null);
  const firstSnapshot = useRef(true);
  const supported = !!window.ahq?.launchSnapshot && !!window.ahq?.launchAction;

  useEffect(() => {
    if (!supported) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const requestedRevision = revision.current;
        const next = await window.ahq!.launchSnapshot();
        if (disposed) return;
        if (actionPending.current || requestedRevision !== revision.current) {
          timer = setTimeout(poll, 1000);
          return;
        }
        const version = JSON.stringify(next);
        setSnapshot(next);
        setPollError('');
        if (version !== lastVersion.current) {
          await refreshRef.current();
          if (disposed) return;
          lastVersion.current = version;
        }
      } catch (cause) {
        if (!disposed) setPollError(errorText(cause));
      }
      if (!disposed) timer = setTimeout(poll, 1000);
    }
    void poll();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [supported]);

  useEffect(() => {
    if (!snapshot) return;
    if (firstSnapshot.current) {
      firstSnapshot.current = false;
      celebrated.current = snapshot.celebrationId ?? null;
      return;
    }
    if (
      snapshot.celebrationId &&
      snapshot.status === 'completed' &&
      celebrated.current !== snapshot.celebrationId
    ) {
      celebrated.current = snapshot.celebrationId;
      window.dispatchEvent(new CustomEvent('ahq:celebrate', { detail: { id: snapshot.celebrationId } }));
    }
  }, [snapshot]);

  async function action(input: Parameters<NonNullable<Window['ahq']>['launchAction']>[0]) {
    if (!supported || actionPending.current) return;
    actionPending.current = true;
    revision.current += 1;
    setBusy(true);
    setError('');
    try {
      const next = await window.ahq!.launchAction(input);
      setSnapshot(next);
      setSelectedScene(null);
      if (input.action === 'restore') {
        onSelectSession(null);
        onRestore();
        window.dispatchEvent(new Event('ahq:launch-restored'));
      }
      await onWorkUpdate();
      if (input.action === 'start') notify('The Little Office team is on it.');
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      actionPending.current = false;
      setBusy(false);
    }
  }

  const scenes = snapshot?.scenes ?? [];
  const activeScene = useMemo(
    () =>
      scenes.find(
        (scene) => scene.status === 'running' || scene.status === 'failed' || scene.status === 'ready',
      ) ?? scenes.at(-1),
    [scenes],
  );
  const detail = selectedScene ? scenes.find((scene) => scene.id === selectedScene) : activeScene;
  const firstReady = scenes.findIndex((scene) => scene.status === 'ready');
  const source = detail ? SCENE_COPY[detail.id] : null;
  const launchStarted = snapshot?.status && snapshot.status !== 'idle';

  return (
    <aside className="launch-panel" aria-label="Little Office launch story">
      <button
        className="launch-panel__heading"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
      >
        <span>
          <Sparkles size={16} /> Little Office launch
        </span>
        <span className="launch-panel__heading-status">{snapshot?.projectName || 'Ready when you are'}</span>
      </button>
      {expanded && (
        <div className="launch-panel__body">
          {!supported && <p className="launch-panel__hint">Open the desktop app to run the launch story.</p>}
          {!launchStarted && (
            <div className="launch-panel__intro">
              <p>Three teammates will work in parallel on the launch brief, forecast, and product.</p>
              <p className="launch-panel__goal">{GOAL}</p>
              <button
                className="button primary"
                disabled={!supported || busy}
                onClick={() => void action({ action: 'start' })}
              >
                {busy ? <LoaderCircle className="spin" size={15} /> : <Sparkles size={15} />} Start the launch
              </button>
            </div>
          )}
          {launchStarted && scenes.length > 0 && (
            <div className="launch-panel__story">
              <div className="launch-panel__progress" aria-label="Launch progress">
                {scenes.map((scene, index) => (
                  <button
                    key={scene.id}
                    className={`launch-stage launch-stage--${scene.status} ${detail?.id === scene.id ? 'is-selected' : ''}`}
                    onClick={() => setSelectedScene(scene.id)}
                    aria-current={detail?.id === scene.id ? 'step' : undefined}
                  >
                    <span className="launch-stage__marker">
                      {scene.status === 'completed' ? (
                        <Check size={13} />
                      ) : scene.status === 'running' ? (
                        <LoaderCircle className="spin" size={13} />
                      ) : scene.status === 'failed' ? (
                        <AlertCircle size={13} />
                      ) : (
                        <Circle size={10} />
                      )}
                    </span>
                    <span>
                      <b>
                        {index + 1}. {scene.title}
                      </b>
                      <small>{statusLabel[scene.status]}</small>
                    </span>
                  </button>
                ))}
              </div>
              {detail && source && (
                <section className="launch-panel__scene" aria-live="polite">
                  <p className="eyebrow">Current source · {source.source}</p>
                  <p>{source.prompt}</p>
                  {detail.error && (
                    <p className="launch-panel__error" role="alert">
                      <AlertCircle size={14} /> {detail.error}
                    </p>
                  )}
                  {!!detail.sessionIds.length && (
                    <div className="launch-panel__sessions">
                      <span>Work streams</span>
                      {detail.sessionIds.map((id, index) => (
                        <button key={id} className="text-button" onClick={() => onSelectSession(id)}>
                          <ChevronRight size={13} />{' '}
                          {detail.id === 'launch'
                            ? (['Product', 'Marketing', 'Forecast'][index] ?? 'View stream')
                            : 'View stream'}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="launch-panel__actions">
                    {(detail.status === 'ready' || detail.status === 'failed') && (
                      <button
                        className="button primary"
                        disabled={
                          !supported ||
                          busy ||
                          (detail.status === 'ready' && firstReady !== scenes.indexOf(detail))
                        }
                        onClick={() =>
                          void action({
                            action:
                              detail.status === 'failed'
                                ? 'retry'
                                : detail.id === 'launch'
                                  ? 'start'
                                  : 'advance',
                            scene: detail.id,
                          })
                        }
                      >
                        {busy ? (
                          <LoaderCircle className="spin" size={14} />
                        ) : detail.status === 'failed' ? (
                          <RotateCcw size={14} />
                        ) : (
                          <ChevronRight size={14} />
                        )}
                        {detail.status === 'failed'
                          ? 'Retry'
                          : detail.id === 'launch'
                            ? 'Start the launch'
                            : 'Continue'}
                      </button>
                    )}
                  </div>
                </section>
              )}
            </div>
          )}
          {(error || pollError) && (
            <p className="launch-panel__error" role="alert">
              <AlertCircle size={14} /> {error || pollError}
            </p>
          )}
          {!!snapshot?.checkpoints.length && (
            <details className="launch-panel__checkpoints">
              <summary>
                <History size={14} /> Restore a checkpoint
              </summary>
              {snapshot.checkpoints.map((checkpoint) => (
                <button
                  key={checkpoint.id}
                  className="launch-checkpoint"
                  disabled={busy}
                  onClick={() => void action({ action: 'restore', checkpointId: checkpoint.id })}
                >
                  <span>{checkpoint.label}</span>
                  <small>
                    {new Date(checkpoint.createdAt).toLocaleTimeString([], {
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </small>
                </button>
              ))}
            </details>
          )}
        </div>
      )}
    </aside>
  );
}
