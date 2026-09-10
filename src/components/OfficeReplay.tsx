import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { Download, Film, Pause, Play, Save, ShieldCheck, SkipBack, SkipForward } from 'lucide-react';
import type { AppState, HistoryEntry } from '../../shared/types';
import type {
  OfficeAuditVerification,
  OfficeEvent,
  OfficeRecordingBounds,
  OfficeReplayBundle,
} from '../../shared/office-events';
import { officeAnalogyForTool } from '../../shared/office-tool-atlas';
import {
  advanceReplayTime,
  clampReplayTime,
  replayEventTime,
  REPLAY_SPEEDS,
  selectReplayBundle,
  stepReplayEvent,
} from '../lib/replay-clock';
import Modal from './Modal';
import './office-replay.css';

const emptyRange = () => ({ firstAt: null, lastAt: null, count: 0 });
const emptyBounds = (): OfficeRecordingBounds => ({
  firstAt: null,
  lastAt: null,
  checkpoints: emptyRange(),
  frames: emptyRange(),
  events: emptyRange(),
});
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : 'The recording could not be loaded. Try again.';
const timestamp = (time: number | null) =>
  time === null
    ? 'Not recorded'
    : new Date(time).toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        fractionalSecondDigits: 3,
      });
const localDateTime = (time: number) =>
  new Date(time - new Date(time).getTimezoneOffset() * 60_000).toISOString().slice(0, 23);

export function useOfficeReplay(
  state: AppState,
  update: (fn: (state: AppState) => AppState) => void,
  notify: (message: string) => void,
) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [at, commitAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now);
  const [play, setPlay] = useState(false);
  const [speed, setSpeed] = useState(60);
  const [confirm, setConfirm] = useState(false);
  const [recording, setRecording] = useState<OfficeRecordingBounds>(emptyBounds);
  const [frozen, setFrozen] = useState<OfficeRecordingBounds | null>(null);
  const [liveBundle, setLiveBundle] = useState<OfficeReplayBundle | null>(null);
  const [pastBundle, setPastBundle] = useState<OfficeReplayBundle | null>(null);
  const [eventIndex, setEventIndex] = useState<OfficeEvent[]>([]);
  const [indexTruncated, setIndexTruncated] = useState(false);
  const [loading, setLoading] = useState(Boolean(window.ahq));
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [auditOpen, setAuditOpen] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportResult, setExportResult] = useState<{
    exported: boolean;
    path?: string;
    verification: OfficeAuditVerification;
  } | null>(null);
  const [mutationBusy, setMutationBusy] = useState(false);
  const cursor = useRef<number | null>(null);
  const recordingRef = useRef(recording);
  const frozenRef = useRef<OfficeRecordingBounds | null>(null);
  const liveRef = useRef<OfficeReplayBundle | null>(null);
  const request = useRef(0);
  const seeking = useRef(false);
  const refreshing = useRef(false);
  const refreshAgain = useRef(false);
  const mounted = useRef(true);
  const notifyRef = useRef(notify);
  notifyRef.current = notify;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current += 1;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!window.ahq || cursor.current !== null || !mounted.current) return;
    if (refreshing.current) {
      refreshAgain.current = true;
      return;
    }
    refreshing.current = true;
    const version = request.current;
    try {
      const [bounds, checkpoints] = await Promise.all([
        window.ahq.officeRecordingBounds(),
        window.ahq.history(),
      ]);
      const bundle = await window.ahq.officeReplay(bounds.lastAt ?? Date.now());
      if (!mounted.current || cursor.current !== null || version !== request.current) return;
      recordingRef.current = bounds;
      liveRef.current = bundle;
      setRecording(bounds);
      setEntries(checkpoints);
      setLiveBundle(bundle);
      setError(null);
    } catch (error) {
      if (mounted.current && cursor.current === null && version === request.current)
        setError(errorText(error));
    } finally {
      refreshing.current = false;
      if (mounted.current && cursor.current === null && version === request.current) setLoading(false);
      if (refreshAgain.current) {
        refreshAgain.current = false;
        if (mounted.current && cursor.current === null) queueMicrotask(() => void refresh());
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (cursor.current === null) void refresh();
    }, 5000);
    return () => clearInterval(timer);
  }, [refresh]);
  const sessionSignature = JSON.stringify([
    state.employees.map((employee) => [employee.id, employee.sessionId, employee.status, employee.activity]),
    state.events[0]?.id,
    state.events.at(-1)?.id,
  ]);
  useEffect(() => {
    if (cursor.current !== null) return;
    const timer = setTimeout(() => void refresh(), 180);
    return () => clearTimeout(timer);
  }, [sessionSignature, refresh]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (cursor.current === null) setNow(Date.now());
    }, 100);
    return () => clearInterval(timer);
  }, []);

  const setAt: Dispatch<SetStateAction<number | null>> = useCallback(
    (action) => {
      const target = typeof action === 'function' ? action(cursor.current) : action;
      if (target === null) {
        request.current += 1;
        cursor.current = null;
        frozenRef.current = null;
        seeking.current = false;
        commitAt(null);
        setFrozen(null);
        setPastBundle(null);
        setPlay(false);
        setConfirm(false);
        setLoading(false);
        setError(null);
        setNow(Date.now());
        void refresh();
        return;
      }
      const bounds = frozenRef.current ?? recordingRef.current;
      const next = clampReplayTime(target, bounds);
      if (next === null || next === cursor.current) return;
      if (cursor.current === null) {
        const captured = structuredClone(bounds);
        frozenRef.current = captured;
        setFrozen(captured);
        setEventIndex([...(liveRef.current?.events ?? [])]);
        setIndexTruncated(liveRef.current?.coverage.eventsTruncated ?? false);
      }
      request.current += 1;
      cursor.current = next;
      seeking.current = true;
      setLoading(true);
      setError(null);
      commitAt(next);
    },
    [refresh],
  );

  useEffect(() => {
    if (at === null || !window.ahq) return;
    const version = ++request.current;
    seeking.current = true;
    setLoading(true);
    setError(null);
    void window.ahq
      .officeReplay(at)
      .then((bundle) => {
        if (!mounted.current || version !== request.current) return;
        if (bundle.requestedAt !== at) throw new Error('The recorder returned a different time. Seek again.');
        setPastBundle(bundle);
      })
      .catch((error) => {
        if (!mounted.current || version !== request.current) return;
        setPastBundle(null);
        setError(errorText(error));
        setPlay(false);
      })
      .finally(() => {
        if (!mounted.current || version !== request.current) return;
        seeking.current = false;
        setLoading(false);
      });
    return () => {
      if (version === request.current) request.current += 1;
    };
  }, [at, retry]);

  useEffect(() => {
    if (!play || cursor.current === null || !frozenRef.current) return;
    const start = cursor.current;
    const started = performance.now();
    const bounds = frozenRef.current;
    const timer = setInterval(() => {
      if (seeking.current) return;
      const next = advanceReplayTime(start, performance.now() - started, speed, bounds);
      if (next === null) {
        setPlay(false);
        return;
      }
      setAt(next);
      if (next === bounds.lastAt) setPlay(false);
    }, 100);
    return () => clearInterval(timer);
  }, [play, speed, setAt]);

  const bundle = selectReplayBundle(at, liveBundle, pastBundle);
  const selected =
    at === null || !bundle?.checkpoint
      ? undefined
      : { id: bundle.checkpoint.id, time: bundle.checkpoint.time, reason: bundle.checkpoint.reason };
  const activeBounds = frozen ?? recording;
  const timelineEvents = at === null ? (liveBundle?.events ?? []) : eventIndex;
  const timelineTruncated = at === null ? (liveBundle?.coverage.eventsTruncated ?? false) : indexTruncated;

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
    recording: activeBounds,
    frozen: frozen !== null,
    display: at === null ? state : (bundle?.state ?? null),
    frame: bundle?.frame ?? null,
    events: bundle?.events ?? [],
    coverage: bundle?.coverage ?? null,
    audit: bundle?.audit ?? null,
    loading,
    error,
    auditOpen,
    setAuditOpen,
    exportBusy,
    exportResult,
    mutationBusy,
    timelineEvents,
    timelineTruncated,
    previousEventAt: stepReplayEvent(timelineEvents, at ?? activeBounds.lastAt ?? now, -1),
    nextEventAt: stepReplayEvent(timelineEvents, at ?? activeBounds.lastAt ?? now, 1),
    retry() {
      if (at === null) {
        setLoading(true);
        void refresh();
      } else setRetry((value) => value + 1);
    },
    async checkpoint() {
      if (cursor.current !== null || mutationBusy) return;
      if (!window.ahq) {
        notifyRef.current('Checkpoints are available in the desktop app.');
        return;
      }
      setMutationBusy(true);
      try {
        await window.ahq.checkpoint();
        await refresh();
        notifyRef.current('Office checkpoint saved.');
      } catch (error) {
        notifyRef.current(errorText(error));
      } finally {
        if (mounted.current) setMutationBusy(false);
      }
    },
    async restore() {
      if (!selected || !window.ahq || !confirm || mutationBusy) return;
      setMutationBusy(true);
      setPlay(false);
      try {
        const restored = await window.ahq.restoreHistory(selected.id);
        update(() => restored);
        setAt(null);
        notifyRef.current('Checkpoint restored. Cloud work stays stopped until you assign it.');
      } catch (error) {
        notifyRef.current(errorText(error));
      } finally {
        if (mounted.current) setMutationBusy(false);
      }
    },
    async exportAudit() {
      if (!window.ahq || exportBusy) return;
      setExportBusy(true);
      try {
        setExportResult(await window.ahq.exportOfficeAudit());
      } catch (error) {
        notifyRef.current(errorText(error));
      } finally {
        if (mounted.current) setExportBusy(false);
      }
    },
  };
}

function Verification({ audit }: { audit: OfficeAuditVerification }) {
  return (
    <div className={`or-verification ${audit.verified ? 'is-verified' : 'is-partial'}`}>
      <strong>
        <ShieldCheck size={16} aria-hidden="true" />{' '}
        {audit.verified ? 'Local ledger hashes verified' : 'Verification needs attention'}
      </strong>
      <p>
        {audit.ledger.count.toLocaleString()} ledger events · {audit.checkpoints.verified.toLocaleString()}{' '}
        verified checkpoints · {audit.frames.verified.toLocaleString()} verified frames.
      </p>
      {audit.legacyUnverified && (
        <p>
          Earlier records lack hashes: {audit.checkpoints.legacy} checkpoints and {audit.frames.legacy}{' '}
          frames. They remain visibly unverified.
        </p>
      )}
      {audit.issues.length > 0 && (
        <ul>
          {audit.issues.map((issue, index) => (
            <li key={index}>{issue}</li>
          ))}
        </ul>
      )}
      <small>
        Verification checks local hash consistency. It does not prove a provider claim or protect against
        replacement of the entire local archive. Keep an exported ledger anchor for comparison.
      </small>
    </div>
  );
}

function EventDetail({ event }: { event: OfficeEvent }) {
  const analogy = event.toolName ? officeAnalogyForTool(event.toolName) : undefined;
  return (
    <article className="or-event-detail" aria-label={`Details for event ${event.sequence}`}>
      <div className="or-event-heading">
        <strong>
          #{event.sequence} · {event.kind}
        </strong>
        <span className="or-source">{event.source}</span>
      </div>
      <p>{event.summary}</p>
      {analogy && (
        <p className="or-object">
          <strong>{analogy.object}</strong> · {analogy.action}
        </p>
      )}
      <dl>
        <dt>Occurred</dt>
        <dd>
          <time dateTime={event.occurredAt}>{timestamp(Date.parse(event.occurredAt))}</time>
        </dd>
        <dt>Recorded</dt>
        <dd>
          <time dateTime={event.recordedAt}>{timestamp(Date.parse(event.recordedAt))}</time>
        </dd>
        <dt>Source</dt>
        <dd>{event.source}</dd>
        {event.employeeId && (
          <>
            <dt>Employee</dt>
            <dd>{event.employeeId}</dd>
          </>
        )}
        {event.targetEmployeeId && (
          <>
            <dt>Recipient</dt>
            <dd>{event.targetEmployeeId}</dd>
          </>
        )}
        {event.toolName && (
          <>
            <dt>Actual tool</dt>
            <dd>
              <code>{event.toolName}</code>
            </dd>
          </>
        )}
        {event.status && (
          <>
            <dt>Observed status</dt>
            <dd>{event.status}</dd>
          </>
        )}
      </dl>
      <details>
        <summary>Technical receipt and hash chain</summary>
        <dl>
          <dt>Event ID</dt>
          <dd>
            <code>{event.id}</code>
          </dd>
          {event.sessionId && (
            <>
              <dt>Session ID</dt>
              <dd>
                <code>{event.sessionId}</code>
              </dd>
            </>
          )}
          {event.runId && (
            <>
              <dt>Run ID</dt>
              <dd>
                <code>{event.runId}</code>
              </dd>
            </>
          )}
          {event.responseId && (
            <>
              <dt>Response ID</dt>
              <dd>
                <code>{event.responseId}</code>
              </dd>
            </>
          )}
          {event.messageId && (
            <>
              <dt>Message ID</dt>
              <dd>
                <code>{event.messageId}</code>
              </dd>
            </>
          )}
          {event.artifactId && (
            <>
              <dt>Artifact ID</dt>
              <dd>
                <code>{event.artifactId}</code>
              </dd>
            </>
          )}
          {event.configRevision && (
            <>
              <dt>Configuration</dt>
              <dd>Revision {event.configRevision}</dd>
            </>
          )}
          {event.checkpointId && (
            <>
              <dt>Checkpoint ID</dt>
              <dd>{event.checkpointId}</dd>
            </>
          )}
          {(
            [
              'memoryId',
              'memoryKind',
              'memoryScope',
              'targetSessionId',
              'toolCallId',
              'inputHash',
              'resultHash',
              'contentHash',
            ] as const
          )
            .filter((field) => event[field])
            .map((field) => (
              <div key={field} className="or-receipt-field">
                <dt>{field.replace(/([A-Z])/g, ' $1')}</dt>
                <dd>
                  <code>{event[field]}</code>
                </dd>
              </div>
            ))}
          <dt>Event hash</dt>
          <dd>
            <code>{event.hash}</code>
          </dd>
          <dt>Previous hash</dt>
          <dd>
            <code>{event.previousHash ?? 'First ledger entry'}</code>
          </dd>
        </dl>
      </details>
    </article>
  );
}

export function OfficeReplayTimeline({ history: h }: { history: ReturnType<typeof useOfficeReplay> }) {
  const id = useId();
  const [seekText, setSeekText] = useState('');
  const [seekError, setSeekError] = useState<string | null>(null);
  const [source, setSource] = useState('all');
  const [employee, setEmployee] = useState('all');
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const first = h.recording.firstAt;
  const last = h.recording.lastAt;
  const hasRecording = first !== null && last !== null;
  const historical = h.at !== null;
  const position = h.at ?? last ?? h.now;
  const employees = [
    ...new Set(h.events.map((event) => event.employeeId).filter((value): value is string => Boolean(value))),
  ].sort();
  const filteredEvents = h.events.filter(
    (event) =>
      (source === 'all' || event.source === source) && (employee === 'all' || event.employeeId === employee),
  );
  const selectedEvent = filteredEvents.find((event) => event.id === selectedEventId) ?? filteredEvents.at(-1);
  const seek = (time: number) => {
    h.setPlay(false);
    h.setAt(time);
    setSeekText('');
    setSeekError(null);
  };
  const submitSeek = () => {
    const parsed = Date.parse(seekText);
    if (!hasRecording || !Number.isFinite(parsed) || parsed < first || parsed > last) {
      setSeekError('Choose a local date and time within the recorded interval.');
      return;
    }
    seek(parsed);
  };
  return (
    <section className="office-replay surface" aria-label="Office recorder and replay">
      <div className="or-heading">
        <div>
          <Film size={19} aria-hidden="true" />
          <div>
            <strong>Office recorder</strong>
            <span>
              {historical ? 'Projector · historical, read-only' : 'Live office · recorded observations'}
            </span>
          </div>
        </div>
        <div className="or-heading-actions">
          <button
            type="button"
            className="text-button"
            disabled={historical || !window.ahq || h.mutationBusy}
            onClick={() => void h.checkpoint()}
          >
            <Save size={14} aria-hidden="true" /> Save checkpoint
          </button>
          <button
            type="button"
            className="text-button"
            aria-expanded={h.auditOpen}
            aria-controls={`${id}-audit`}
            onClick={() => h.setAuditOpen(!h.auditOpen)}
          >
            <ShieldCheck size={15} aria-hidden="true" /> Archive ledger
          </button>
        </div>
      </div>

      {!window.ahq && (
        <p className="or-notice">
          The office recorder connects in the desktop app. This browser preview has no recorded workspace
          history.
        </p>
      )}
      <div className="or-controls">
        <button
          type="button"
          className="icon-button"
          aria-label="Previous recorded event"
          disabled={h.previousEventAt === null || !hasRecording}
          onClick={() => h.previousEventAt !== null && seek(h.previousEventAt)}
        >
          <SkipBack size={18} />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={h.play ? 'Pause office replay' : 'Play office replay'}
          disabled={!hasRecording || Boolean(h.error)}
          onClick={() => {
            if (h.play) h.setPlay(false);
            else {
              if (h.at === null || h.at >= last!) h.setAt(first!);
              h.setPlay(true);
            }
          }}
        >
          {h.play ? <Pause size={18} /> : <Play size={18} />}
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Next recorded event"
          disabled={h.nextEventAt === null || !hasRecording}
          onClick={() => h.nextEventAt !== null && seek(h.nextEventAt)}
        >
          <SkipForward size={18} />
        </button>
        <input
          className="or-range"
          aria-label="Office recording position"
          aria-valuetext={timestamp(position)}
          type="range"
          min={first ?? 0}
          max={last ?? 1}
          value={hasRecording ? position : 0}
          step={1}
          disabled={!hasRecording}
          onChange={(event) => seek(Number(event.target.value))}
        />
        <select
          aria-label="Office replay speed"
          value={h.speed}
          onChange={(event) => h.setSpeed(Number(event.target.value))}
        >
          {REPLAY_SPEEDS.map((speed) => (
            <option key={speed} value={speed}>
              {speed}×
            </option>
          ))}
        </select>
        <button
          type="button"
          className={`button ${historical ? 'secondary' : 'primary'}`}
          aria-pressed={!historical}
          onClick={() => h.setAt(null)}
        >
          Live
        </button>
      </div>
      <div className="or-range-labels">
        <time>{timestamp(first)}</time>
        <span>{h.frozen ? 'Fixed recording interval' : 'Latest recorded interval'}</span>
        <time>{timestamp(last)}</time>
      </div>
      <div className="or-position">
        <strong>{historical ? timestamp(h.at) : 'Live'}</strong>
        <span>
          {h.play
            ? `Playing at ${h.speed}×`
            : historical
              ? position === last
                ? 'Paused at the end of this recording'
                : 'Paused'
              : hasRecording
                ? 'Choose a time to replay'
                : h.loading
                  ? 'Loading recording…'
                  : 'No recorded observations yet'}
        </span>
      </div>
      <details className="or-seek">
        <summary>Seek to an exact time</summary>
        <div className="or-seek-controls" role="group" aria-label="Exact replay time">
          <label htmlFor={`${id}-time`}>
            Local date and time
            <input
              id={`${id}-time`}
              type="datetime-local"
              step="0.001"
              min={first === null ? undefined : localDateTime(first)}
              max={last === null ? undefined : localDateTime(last)}
              value={seekText || (hasRecording ? localDateTime(position) : '')}
              disabled={!hasRecording}
              onChange={(event) => setSeekText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  submitSeek();
                }
              }}
            />
          </label>
          <button
            type="button"
            className="button secondary"
            disabled={!hasRecording || !seekText}
            onClick={submitSeek}
          >
            Seek
          </button>
        </div>
        {seekError && <p role="alert">{seekError}</p>}
        <small>Millisecond precision. Event steps use the later of occurred and recorded time.</small>
      </details>

      {h.error && (
        <div className="or-notice is-error" role="alert">
          {h.error}{' '}
          <button type="button" className="text-button" onClick={() => h.retry()}>
            Retry recording
          </button>
        </div>
      )}
      {historical && (
        <div className="or-history-status" aria-live="polite" aria-busy={h.loading}>
          {h.loading
            ? 'Loading this recorded instant…'
            : !h.display
              ? 'No workspace state was recorded at this time. Choose a later point or return to Live.'
              : `Showing checkpoint ${h.selected ? `#${h.selected.id} from ${timestamp(h.selected.time)}` : 'state'}${h.frame ? ` · observed frame ${timestamp(h.frame.time)}` : ' · no observed frame'}.`}
          <span>
            Return to Live to change the office. The projector never substitutes current data for missing
            history.
          </span>
        </div>
      )}
      {h.coverage && h.coverage.status !== 'verified' && (
        <details className="or-coverage">
          <summary>
            {h.coverage.status === 'unavailable'
              ? 'Recording coverage unavailable'
              : 'Recording has gaps or unverified history'}
          </summary>
          <ul>
            {h.coverage.gaps.map((gap, index) => (
              <li key={index}>{gap}</li>
            ))}
          </ul>
          {h.coverage.legacyUnverified && <p>Some earlier records have no integrity hashes.</p>}
        </details>
      )}
      {h.timelineTruncated && (
        <p className="or-notice">
          Event stepping covers the latest {h.timelineEvents.length.toLocaleString()} indexed events in this
          recording. Use the time slider for earlier history; export the full ledger for its complete event
          list.
        </p>
      )}

      {h.auditOpen && (
        <div className="or-audit" id={`${id}-audit`}>
          <div className="or-audit-heading">
            <div>
              <h3>Office archive ledger</h3>
              <p>Recorded receipts explain each observed office action.</p>
            </div>
            <button
              type="button"
              className="button secondary"
              disabled={!window.ahq || h.exportBusy}
              onClick={() => void h.exportAudit()}
            >
              <Download size={15} aria-hidden="true" />
              {h.exportBusy ? 'Verifying export…' : 'Export and verify'}
            </button>
          </div>
          <p className="or-audit-scope">
            {historical
              ? `Ledger visible through ${timestamp(h.at)}. Export includes the entire archive, including later records.`
              : 'Latest loaded archive receipts. Export includes the entire archive.'}
          </p>
          {h.audit ? (
            <Verification audit={h.audit} />
          ) : (
            <p>{h.loading ? 'Loading archive verification…' : 'Archive verification is unavailable.'}</p>
          )}
          {h.exportResult && (
            <div className="or-export-result" role="status">
              <strong>{h.exportResult.exported ? 'Archive exported' : 'Export cancelled'}</strong>
              {h.exportResult.path && <p className="or-export-path">{h.exportResult.path}</p>}
              <Verification audit={h.exportResult.verification} />
            </div>
          )}
          <div className="or-event-filters">
            <label htmlFor={`${id}-source`}>
              Source
              <select id={`${id}-source`} value={source} onChange={(event) => setSource(event.target.value)}>
                <option value="all">All sources</option>
                {['user', 'provider', 'tool', 'system'].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label htmlFor={`${id}-employee`}>
              Employee
              <select
                id={`${id}-employee`}
                value={employee}
                onChange={(event) => setEmployee(event.target.value)}
              >
                <option value="all">All employees</option>
                {employees.map((value) => (
                  <option key={value} value={value}>
                    {h.display?.employees.find((item) => item.id === value)?.name ?? value}
                  </option>
                ))}
              </select>
            </label>
            <span>{filteredEvents.length.toLocaleString()} visible events</span>
          </div>
          {filteredEvents.length ? (
            <div className="or-event-browser">
              <ol className="or-events" aria-label="Recorded office events">
                {[...filteredEvents].reverse().map((event) => (
                  <li key={event.id}>
                    <button
                      type="button"
                      aria-pressed={selectedEvent?.id === event.id}
                      onClick={() => setSelectedEventId(event.id)}
                    >
                      <span>
                        <strong>
                          #{event.sequence} · {event.kind}
                        </strong>
                        <time dateTime={new Date(replayEventTime(event)).toISOString()}>
                          {timestamp(replayEventTime(event))}
                        </time>
                      </span>
                      <span className="or-event-summary">{event.summary}</span>
                      <small>
                        {event.source}
                        {event.employeeId
                          ? ` · ${h.display?.employees.find((employee) => employee.id === event.employeeId)?.name ?? event.employeeId}`
                          : ''}
                      </small>
                    </button>
                  </li>
                ))}
              </ol>
              {selectedEvent && <EventDetail event={selectedEvent} />}
            </div>
          ) : (
            <p className="or-empty">
              {h.loading
                ? 'Loading events for this instant…'
                : 'No recorded events match this time and filter.'}
            </p>
          )}
          {historical && h.selected && (
            <div className="or-restore">
              <p>
                Checkpoint #{h.selected.id}: {h.selected.reason}
              </p>
              <button
                type="button"
                className="text-button"
                disabled={h.loading || h.mutationBusy}
                onClick={() => {
                  h.setPlay(false);
                  h.setConfirm(true);
                }}
              >
                Leave replay and restore this checkpoint…
              </button>
            </div>
          )}
        </div>
      )}
      {h.confirm && (
        <Modal title="Leave replay and restore this checkpoint?" onClose={() => h.setConfirm(false)}>
          <p>
            Your local goal, team, conversations, and commitments return to checkpoint #{h.selected?.id}. The
            current workspace is checkpointed first.
          </p>
          <p>
            Stop cloud sessions first. Previous cloud actions and exported files cannot be undone; the archive
            ledger stays intact.
          </p>
          <div className="modal-footer">
            <button
              type="button"
              className="button secondary"
              disabled={h.mutationBusy}
              onClick={() => h.setConfirm(false)}
            >
              Keep current office
            </button>
            <button
              type="button"
              className="button primary"
              disabled={h.mutationBusy || !h.selected}
              onClick={() => void h.restore()}
            >
              {h.mutationBusy ? 'Restoring…' : 'Restore and return to Live'}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}

export const OfficeTimeline = OfficeReplayTimeline;
