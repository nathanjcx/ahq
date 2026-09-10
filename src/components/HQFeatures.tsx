import { useCallback, useEffect, useRef, useState } from 'react';
import { Cloud, Download, Mic, Shirt } from 'lucide-react';
import type {
  AppState,
  Appearance,
  CloudSettings,
  ChatGPTAccount,
  Employee,
  HistoryEntry,
  Integration,
  WorkEvent,
} from '../../shared/types';
import type { UpdateState } from '../App';
import type { Snapshot } from '../shared/types';
import { applySession } from '../lib/workflow';
import Modal from './Modal';
import { monoWav } from '../lib/audio';
import './timeline.css';
const errorText = (e: unknown) => (e instanceof Error ? e.message : 'Please try again.');

export function useOfficeHistory(state: AppState, update: UpdateState, notify: (s: string) => void) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [at, setAt] = useState<number | null>(null),
    [past, setPast] = useState<AppState | null>(null);
  const [now, setNow] = useState(Date.now()),
    [play, setPlay] = useState(false),
    [speed, setSpeed] = useState(60);
  const [confirm, setConfirm] = useState(false);
  const refresh = useCallback(async () => {
    if (window.ahq) setEntries(await window.ahq.history());
  }, []);
  useEffect(() => {
    void refresh().catch((e) => notify(errorText(e)));
    const timer = setInterval(() => void refresh().catch(() => undefined), 5000);
    return () => clearInterval(timer);
  }, [refresh, notify]);
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
      if (play)
        setAt((t) => {
          if (t === null) return null;
          const next = t + speed * 100;
          if (next >= Date.now()) {
            setPlay(false);
            return null;
          }
          return next;
        });
    }, 100);
    return () => clearInterval(timer);
  }, [play, speed]);
  const selected = at === null ? undefined : ([...entries].reverse().find((e) => e.time <= at) ?? entries[0]);
  useEffect(() => {
    let alive = true;
    if (selected && window.ahq)
      void window.ahq
        .historyState(selected.id)
        .then((s) => {
          if (alive) setPast(s);
        })
        .catch((e) => notify(errorText(e)));
    else setPast(null);
    return () => {
      alive = false;
    };
  }, [selected?.id, notify]);
  return {
    entries,
    at,
    setAt,
    now,
    play,
    setPlay,
    speed,
    setSpeed,
    selected,
    confirm,
    setConfirm,
    display: at !== null && past ? past : state,
    async checkpoint() {
      try {
        if (window.ahq) setEntries(await window.ahq.checkpoint());
        else notify('Checkpoints are available in the desktop app.');
      } catch (e) {
        notify(errorText(e));
      }
    },
    async restore() {
      try {
        if (selected && window.ahq) {
          const restored = await window.ahq.restoreHistory(selected.id);
          update(() => restored);
          setAt(null);
          setPlay(false);
          setConfirm(false);
          await refresh();
          notify('Checkpoint restored. Cloud work stays stopped until you assign it.');
        }
      } catch (e) {
        notify(errorText(e));
      }
    },
  };
}
export function OfficeTimeline({ history: h }: { history: ReturnType<typeof useOfficeHistory> }) {
  const live = h.at === null;
  return (
    <section className="office-scrubber" aria-label="Office history">
      <div className="office-scrubber-row">
        <span className="office-scrubber-beta">Beta</span>
        <input
          className="office-scrubber-range"
          aria-label="Office history position"
          aria-valuetext={h.at === null ? 'Live' : new Date(h.at).toLocaleString()}
          type="range"
          min={h.entries[0]?.time ?? h.now}
          max={h.now}
          step={100}
          value={h.at ?? h.now}
          onChange={(e) => {
            const time = Number(e.target.value);
            h.setAt(time >= h.now ? null : time);
            h.setPlay(false);
          }}
          disabled={!h.entries.length}
        />
        <button
          className={`office-scrubber-live${live ? ' is-live' : ''}`}
          aria-pressed={live}
          onClick={() => {
            h.setAt(null);
            h.setPlay(false);
          }}
        >
          Live
        </button>
      </div>
      {h.confirm && (
        <Modal title="Return to this checkpoint?" onClose={() => h.setConfirm(false)}>
          <p>
            Your goal, team, conversations, and commitments will return to this saved state. A checkpoint of
            the current workspace is saved first.
          </p>
          <p>
            Stop cloud sessions first. Previous cloud actions and exported files cannot be undone; the
            activity journal stays intact.
          </p>
          <div className="modal-footer">
            <button className="button secondary" onClick={() => h.setConfirm(false)}>
              Keep current state
            </button>
            <button className="button primary" onClick={() => void h.restore()}>
              Restore checkpoint
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}

export function AppearanceEditor({
  employee,
  onSave,
}: {
  employee: Employee;
  onSave: (a: Appearance) => void;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<Appearance>(
    employee.appearance ?? {
      gender: 'neutral',
      skin: '#ce9a76',
      hair: '#3d3029',
      hairstyle: 'short',
      hat: 'none',
      glasses: false,
      clothing: employee.color,
    },
  );
  return (
    <>
      <button className="text-button" onClick={() => setOpen(!open)}>
        <Shirt size={15} />
        Appearance
      </button>
      {open && (
        <div className="appearance-editor">
          <div className="form-grid">
            <label>
              Presentation
              <select
                value={value.gender}
                onChange={(e) => setValue({ ...value, gender: e.target.value as Appearance['gender'] })}
              >
                <option value="neutral">Neutral</option>
                <option value="feminine">Feminine</option>
                <option value="masculine">Masculine</option>
              </select>
            </label>
            <label>
              Hair
              <select
                value={value.hairstyle}
                onChange={(e) => setValue({ ...value, hairstyle: e.target.value as Appearance['hairstyle'] })}
              >
                <option value="short">Short</option>
                <option value="long">Long</option>
                <option value="bald">Bald</option>
              </select>
            </label>
            <label>
              Hat
              <select
                value={value.hat}
                onChange={(e) => setValue({ ...value, hat: e.target.value as Appearance['hat'] })}
              >
                <option value="none">None</option>
                <option value="cap">Cap</option>
                <option value="beanie">Beanie</option>
              </select>
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={value.glasses}
                onChange={(e) => setValue({ ...value, glasses: e.target.checked })}
              />
              Glasses
            </label>
          </div>
          <div className="appearance-colors">
            {(['skin', 'hair', 'clothing'] as const).map((key) => (
              <label key={key}>
                {key === 'hair' ? 'Hair color' : key === 'skin' ? 'Skin tone' : 'Clothing'}
                <input
                  aria-label={key + ' color'}
                  type="color"
                  value={value[key]}
                  onChange={(e) => setValue({ ...value, [key]: e.target.value })}
                />
              </label>
            ))}
          </div>
          <button
            className="button primary"
            onClick={() => {
              onSave(value);
              setOpen(false);
            }}
          >
            Save appearance
          </button>
        </div>
      )}
    </>
  );
}

export function VoiceAnnounce({
  disabled = false,
  onLevel,
  onListening,
  onBroadcast,
  notify,
}: {
  disabled?: boolean;
  onLevel: (n: number) => void;
  onListening: (b: boolean) => void;
  onBroadcast: (s: string) => Promise<void>;
  notify: (s: string) => void;
}) {
  const [recording, setRecording] = useState(false),
    [busy, setBusy] = useState(false),
    [transcript, setTranscript] = useState('');
  const mounted = useRef(true);
  const held = useRef(false),
    recorder = useRef<MediaRecorder | null>(null),
    stream = useRef<MediaStream | null>(null),
    context = useRef<AudioContext | null>(null),
    frame = useRef(0),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stop = () => {
    held.current = false;
    if (timer.current) clearTimeout(timer.current);
    if (recorder.current?.state === 'recording') recorder.current.stop();
    else cleanup();
  };
  const cleanup = () => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    void context.current?.close();
    context.current = null;
    cancelAnimationFrame(frame.current);
    setRecording(false);
    onListening(false);
    onLevel(0);
  };
  useEffect(() => {
    mounted.current = true;
    const release = () => stop();
    window.addEventListener('blur', release);
    window.addEventListener('pointerup', release);
    return () => {
      mounted.current = false;
      held.current = false;
      if (timer.current) clearTimeout(timer.current);
      recorder.current?.state === 'recording' && recorder.current.stop();
      cleanup();
      window.removeEventListener('blur', release);
      window.removeEventListener('pointerup', release);
    };
  }, []);
  async function start() {
    if (disabled || busy || held.current || recording) return;
    held.current = true;
    setBusy(true);
    try {
      if (!window.ahq) throw new Error('Open the desktop app to announce with your microphone.');
      if (!(await window.ahq.microphonePermission()))
        throw new Error('Allow microphone access in macOS System Settings to use voice announcements.');
      if (!held.current) return;
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!held.current) {
        cleanup();
        return;
      }
      const ctx = new AudioContext();
      context.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      ctx.createMediaStreamSource(stream.current).connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      const meter = () => {
        analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (const n of samples) sum += ((n - 128) / 128) ** 2;
        onLevel(Math.min(1, Math.sqrt(sum / samples.length) * 6));
        frame.current = requestAnimationFrame(meter);
      };
      meter();
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((t) =>
        MediaRecorder.isTypeSupported(t),
      );
      if (!mime) throw new Error('Audio recording is unavailable on this device.');
      const r = new MediaRecorder(stream.current, { mimeType: mime });
      recorder.current = r;
      const chunks: BlobPart[] = [];
      r.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      r.onstop = () => {
        cleanup();
        if (!mounted.current) return;
        setBusy(true);
        void (async () => {
          try {
            const decoder = new AudioContext();
            let audio: ArrayBuffer;
            try {
              const decoded = await decoder.decodeAudioData(
                await new Blob(chunks, { type: mime }).arrayBuffer(),
              );
              audio = monoWav(
                Array.from({ length: decoded.numberOfChannels }, (_, i) => decoded.getChannelData(i)),
                decoded.sampleRate,
              );
            } finally {
              await decoder.close();
            }
            const text = await window.ahq!.transcribe({ audio, mime: 'audio/wav' });
            if (!text) throw new Error('No speech was heard. Hold the button and try again.');
            setTranscript(text);
            await onBroadcast(text);
          } catch (e) {
            notify(errorText(e));
          } finally {
            setBusy(false);
          }
        })();
      };
      r.onerror = () => {
        cleanup();
        setBusy(false);
        notify('Recording stopped unexpectedly. Please try again.');
      };
      r.start();
      setRecording(true);
      onListening(true);
      timer.current = setTimeout(stop, 120_000);
    } catch (e) {
      cleanup();
      notify(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={`voice-announce ${recording ? 'recording' : ''}`}>
      <button
        className="button primary"
        aria-label="Hold to announce to all employees"
        disabled={disabled || busy}
        onPointerDown={(e) => {
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          void start();
        }}
        onPointerUp={stop}
        onPointerCancel={stop}
        onKeyDown={(e) => {
          if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
            e.preventDefault();
            void start();
          }
        }}
        onKeyUp={(e) => {
          if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            stop();
          }
        }}
      >
        <Mic size={17} />
        {recording ? 'Listening · release to send' : busy ? 'Preparing announcement…' : 'Hold to announce'}
      </button>
      <span>
        {disabled
          ? 'Add your first employee to make an announcement.'
          : recording
            ? 'Everyone is listening through the office speakers.'
            : 'Release to transcribe and send to every employee.'}
      </span>
      {transcript && <p className="voice-transcript">“{transcript}”</p>}
    </div>
  );
}

function ChatGPTConnection({
  cloud,
  onCloud,
  notify,
}: {
  cloud: CloudSettings;
  onCloud: (s: CloudSettings) => void;
  notify: (s: string) => void;
}) {
  const [account, setAccount] = useState<ChatGPTAccount | undefined>(cloud.account);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    if (!window.ahq) return;
    const a = await window.ahq.chatGPTAccount();
    setAccount(a);
    onCloud(await window.ahq.getCloudSettings());
  }, [onCloud]);
  useEffect(() => {
    void refresh().catch((e) => notify(errorText(e)));
    const focused = () => void refresh().catch(() => undefined);
    window.addEventListener('focus', focused);
    return () => window.removeEventListener('focus', focused);
  }, [refresh, notify]);
  useEffect(() => {
    if (account?.status !== 'signing-in') return;
    const timer = setInterval(() => void refresh().catch(() => undefined), 2000);
    return () => clearInterval(timer);
  }, [account?.status, refresh]);
  async function connect() {
    if (!window.ahq) return;
    setBusy(true);
    try {
      if (account?.status === 'signed-in') {
        onCloud(await window.ahq.useChatGPT());
        notify('Employees will use your ChatGPT plan.');
      } else {
        setAccount(await window.ahq.loginChatGPT());
      }
    } catch (e) {
      notify(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="surface settings-section">
      <div className="section-heading">
        <h2>
          <Cloud size={19} /> ChatGPT plan
        </h2>
        <span className={`status-pill ${account?.status === 'signed-in' ? 'ready' : 'waiting'}`}>
          {account?.status === 'signed-in'
            ? cloud.provider === 'chatgpt'
              ? 'Connected'
              : 'Signed in'
            : account?.status === 'signing-in'
              ? 'Finish in your browser'
              : 'Not connected'}
        </span>
      </div>
      <p>
        Sign in with ChatGPT to let employees use the Codex allowance in your plan. No API key is needed for
        employee work.
      </p>
      {account?.status === 'signed-in' && (
        <div className="info-note">
          <strong>{account.email || 'ChatGPT account'}</strong>
          <span>
            {' '}
            ·{' '}
            {account.plan &&
            ['free', 'plus', 'pro', 'team', 'business', 'enterprise', 'edu'].includes(account.plan)
              ? `${account.plan.charAt(0).toUpperCase()}${account.plan.slice(1)} plan`
              : 'ChatGPT plan'}
          </span>
        </div>
      )}
      <p className="form-hint">
        Sessions run from this Mac while Astra HQ is open. Your existing Codex sign-in is shared; credentials
        stay with Codex. Local files and analysis are supported. Voice uses on-device macOS speech
        recognition. Remote integrations below use API mode.
      </p>
      {account?.error && (
        <p className="form-error" role="alert">
          {account.error}
        </p>
      )}
      <div className="button-group">
        {!(account?.status === 'signed-in' && cloud.provider === 'chatgpt') && (
          <button
            className="button primary"
            disabled={busy || !window.ahq || account?.status === 'signing-in'}
            onClick={() => void connect()}
          >
            {account?.status === 'signed-in' ? 'Use ChatGPT plan' : 'Sign in with ChatGPT'}
          </button>
        )}
        {account?.status === 'signing-in' && (
          <button
            className="button secondary"
            disabled={busy}
            onClick={() =>
              void window
                .ahq!.cancelChatGPTLogin()
                .then(setAccount)
                .catch((e) => notify(errorText(e)))
            }
          >
            Cancel sign-in
          </button>
        )}
        <button
          className="button secondary"
          disabled={busy || !window.ahq}
          onClick={() => void refresh().catch((e) => notify(errorText(e)))}
        >
          Refresh connection
        </button>
      </div>
    </section>
  );
}

export function ConnectionSettings({
  cloud,
  onCloud,
  notify,
}: {
  cloud: CloudSettings;
  onCloud: (s: CloudSettings) => void;
  notify: (s: string) => void;
}) {
  const [key, setKey] = useState(''),
    [model, setModel] = useState(cloud.model ?? 'gpt-6-astra'),
    [location, setLocation] = useState(''),
    [items, setItems] = useState<Integration[]>([]),
    [name, setName] = useState(''),
    [url, setUrl] = useState(''),
    [token, setToken] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (window.ahq)
      void Promise.all([window.ahq.storageLocation(), window.ahq.integrations()])
        .then(([p, i]) => {
          setLocation(p);
          setItems(i);
        })
        .catch((e) => notify(errorText(e)));
  }, [notify]);
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      notify(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="hq-connection-settings">
      <ChatGPTConnection cloud={cloud} onCloud={onCloud} notify={notify} />
      <details className="surface settings-section">
        <summary>Optional API access</summary>
        <section className="surface settings-section">
          <h2>
            <Cloud size={19} />
            Astra cloud
          </h2>
          <p>
            Use API billing for hosted employee sessions, remote integrations, and voice transcription.
            Connecting here switches new assignments to API mode.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void action(async () => {
                if (!window.ahq) throw new Error('Open the desktop app to save keys.');
                onCloud(await window.ahq.configureOpenAI({ key, model }));
                setKey('');
                notify('Astra cloud connected.');
              });
            }}
          >
            <label>
              Astra / OpenAI API key
              <input
                type="password"
                autoComplete="new-password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                required
                placeholder={
                  cloud.provider === 'openai' && cloud.configured
                    ? 'A key is saved securely · enter to replace'
                    : 'sk-…'
                }
              />
            </label>
            <label>
              Model
              <input required value={model} onChange={(e) => setModel(e.target.value)} />
            </label>
            <div className="form-hint">
              Keys are encrypted by macOS and stay out of activity exports. API billing is separate from your
              ChatGPT subscription.
            </div>
            <div className="button-group">
              <button className="button primary" disabled={busy || !window.ahq}>
                Connect Astra
              </button>
              {cloud.provider === 'openai' && cloud.configured && (
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  onClick={() =>
                    void action(async () => {
                      onCloud(await window.ahq!.disconnectCloud());
                      notify('Cloud key removed from this device.');
                    })
                  }
                >
                  Disconnect
                </button>
              )}
            </div>
          </form>
        </section>
      </details>
      <section className="surface settings-section">
        <h2>Local database</h2>
        <p>Choose where Astra HQ keeps your workspace, recorded history, and activity journal.</p>
        <p className="database-path">{location || 'Available in the desktop app'}</p>
        <button
          className="button secondary"
          disabled={busy || !window.ahq}
          onClick={() =>
            void action(async () => {
              const path = await window.ahq!.chooseDatabaseFolder();
              if (path) {
                setLocation(path);
                notify('Database moved to your chosen folder.');
              }
            })
          }
        >
          Choose database folder
        </button>
      </section>
      <section className="surface settings-section">
        <h2>Integration keys</h2>
        <p>
          Connect a service’s remote MCP endpoint. Add its name to an employee’s Skills to let them use it.
          You review each requested action.
        </p>
        {items.map((i) => (
          <div className="integration-row" key={i.id}>
            <div>
              <strong>{i.name}</strong>
              <small>{i.url}</small>
            </div>
            <button
              className="text-button"
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  setItems(await window.ahq!.removeIntegration(i.id));
                })
              }
            >
              Remove
            </button>
          </div>
        ))}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void action(async () => {
              setItems(await window.ahq!.saveIntegration({ name, url, key: token }));
              setName('');
              setUrl('');
              setToken('');
              notify('Integration saved. Assign it through employee Skills.');
            });
          }}
        >
          <label>
            Integration name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="e.g. Project tracker"
              maxLength={60}
            />
          </label>
          <label>
            Remote MCP endpoint
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              required
              placeholder="https://your-service.com/mcp"
            />
          </label>
          <label>
            API key or access token
            <input
              type="password"
              autoComplete="new-password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Leave empty for a public endpoint"
            />
          </label>
          <button className="button secondary" disabled={!window.ahq || busy}>
            Save integration
          </button>
        </form>
      </section>
    </div>
  );
}

export function ActivityPage({
  state,
  update,
  notify,
}: {
  state: AppState;
  update: UpdateState;
  notify: (s: string) => void;
}) {
  const [events, setEvents] = useState<WorkEvent[]>(state.events),
    [filter, setFilter] = useState('all'),
    [query, setQuery] = useState(''),
    [runtime, setRuntime] = useState<Snapshot | null>(null),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const refresh = () => {
      if (window.ahq)
        void window.ahq
          .activity()
          .then(setEvents)
          .catch((e) => notify(errorText(e)));
    };
    refresh();
    const timer = setInterval(refresh, 4000);
    return () => clearInterval(timer);
  }, [state.events, notify]);
  async function local(command: Parameters<NonNullable<Window['ahq']>['localCommand']>[0]) {
    setBusy(true);
    try {
      setRuntime(await window.ahq!.localCommand(command));
    } catch (e) {
      notify(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="activity-page">
      <section className="surface settings-section">
        <div className="section-heading">
          <h2>Every step, in one place</h2>
          <div className="button-group">
            {(['csv', 'json'] as const).map((format) => (
              <button
                key={format}
                className="button secondary"
                disabled={!window.ahq}
                onClick={() =>
                  void window
                    .ahq!.exportActivity(format)
                    .then((ok) => ok && notify('Activity exported.'))
                    .catch((e) => notify(errorText(e)))
                }
              >
                <Download size={15} />
                {format.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        <div className="form-grid">
          <input
            aria-label="Search activity"
            placeholder="Search activity…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select aria-label="Activity author" value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">Everyone</option>
            <option value="you">You</option>
            {state.employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </div>
        <div className="activity-journal">
          {events
            .filter(
              (e) =>
                (filter === 'all' || (filter === 'you' ? !e.employeeId : e.employeeId === filter)) &&
                e.text.toLowerCase().includes(query.toLowerCase()),
            )
            .reverse()
            .map((e) => (
              <article key={e.id}>
                <span className={`activity-source ${e.source}`}>
                  {e.source === 'chatgpt'
                    ? 'ChatGPT plan'
                    : e.source === 'cloud'
                      ? 'Astra cloud'
                      : e.source === 'example'
                        ? 'Example'
                        : 'Local'}
                </span>
                <div>
                  <strong>
                    {state.employees.find((p) => p.id === e.employeeId)?.name ??
                      (e.employeeId ? 'Local employee' : 'You')}
                  </strong>
                  <p>{e.text}</p>
                </div>
                <time>{new Date(e.time).toLocaleString()}</time>
              </article>
            ))}
        </div>
      </section>
      <section className="surface settings-section">
        <h2>
          <Cloud size={18} />
          Employee sessions
        </h2>
        {state.employees.map((e) => (
          <div className="integration-row" key={e.id}>
            <div>
              <strong>{e.name}</strong>
              <small>{e.sessionId ? `${e.activity} · ${e.sessionId}` : 'Ready · no session started'}</small>
            </div>
            {e.sessionId && (
              <button
                className="button secondary"
                onClick={() =>
                  void window
                    .ahq!.cancelSession(e.sessionId!)
                    .then((session) => update((s) => applySession(s, e.id, session)))
                    .catch((error) => notify(errorText(error)))
                }
              >
                Stop session
              </button>
            )}
          </div>
        ))}
      </section>
      <details className="surface settings-section">
        <summary>Local workflows</summary>
        <p>Codex workflows run in a local workspace. These jobs are separate from your office employees.</p>
        <button
          disabled={busy || !window.ahq}
          className="button secondary"
          onClick={() => void local({ type: 'snapshot' })}
        >
          Load local runtime
        </button>
        {runtime && (
          <>
            <p>
              Mode: {runtime.settings.mode === 'demo' ? 'Example playback' : 'Local Codex'} · Account:{' '}
              {runtime.auth.status}
            </p>
            <div className="button-group">
              <button
                className="button secondary"
                disabled={busy || runtime.auth.status !== 'signed-in'}
                onClick={() => void local({ type: 'settings.update', settings: { mode: 'live' } })}
              >
                Use local Codex
              </button>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => void local({ type: 'settings.update', settings: { mode: 'demo' } })}
              >
                Use examples
              </button>
            </div>
            <div className="button-group">
              {(['report', 'bug', 'meeting', 'dinner', 'qa'] as const).map((s) => (
                <button
                  className="button secondary"
                  key={s}
                  disabled={busy}
                  onClick={() => void local({ type: 'scenario.run', scenario: s })}
                >
                  {s}
                </button>
              ))}
            </div>
            {runtime.work.map((w) => (
              <p key={w.id}>
                {w.title} · {w.status}
              </p>
            ))}
            {runtime.artifacts.map((a) => (
              <details key={a.id}>
                <summary>
                  {a.title}
                  {a.simulated ? ' · Example' : ''}
                </summary>
                <pre>{a.content}</pre>
              </details>
            ))}
          </>
        )}
      </details>
    </div>
  );
}
