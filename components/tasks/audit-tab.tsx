'use client';

import { Download, LoaderCircle, RefreshCw, ScrollText } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { AuditEntry, AuditTimeline } from '@/lib/contracts';
import { webApi } from '@/lib/ui-api';
import { EmptyPane } from '../shared/empty';
import { correctionLabel, providerName } from '../shared/format';
import { JsonView } from '../shared/json-view';
import { ProviderMark } from '../shared/marks';
import { StateDiff } from '../shared/state-diff';

const NO_ACCESS = 'You need access to this task to read its audit trail.';
const LOAD_FAILED = 'The audit trail could not be loaded.';
const PREVIEW_LENGTH = 400;

function exactTime(at: number) {
  return new Date(at).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function duration(ms?: number) {
  if (ms === undefined) return null;
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function AuditText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const long = text.length > PREVIEW_LENGTH;
  return (
    <>
      <p className="audit-text">{long && !expanded ? `${text.slice(0, PREVIEW_LENGTH)}…` : text}</p>
      {long && (
        <button
          type="button"
          className="text-button"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? 'Show less' : `Show all ${text.length.toLocaleString()} characters`}
        </button>
      )}
    </>
  );
}

function EntryShell({
  kind,
  title,
  at,
  aside,
  children,
}: {
  kind: AuditEntry['kind'];
  title: ReactNode;
  at: number;
  aside?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <li className={`audit-entry audit-${kind}`}>
      <div className="audit-entry-head">
        <span className="audit-title">{title}</span>
        {aside}
        <time dateTime={new Date(at).toISOString()}>{exactTime(at)}</time>
      </div>
      {children}
    </li>
  );
}

function Entry({ entry }: { entry: AuditEntry }) {
  if (entry.kind === 'event')
    return (
      <EntryShell kind="event" title={<span className="audit-kind">{entry.type}</span>} at={entry.at}>
        <p className="audit-text">{entry.text}</p>
        {entry.gap && <p className="audit-gap">Recording gap before this event.</p>}
      </EntryShell>
    );

  if (entry.kind === 'message')
    return (
      <EntryShell
        kind="message"
        title={<span className="audit-kind">{entry.role}</span>}
        at={entry.at}
        aside={entry.phase ? <span className="audit-meta">{entry.phase}</span> : undefined}
      >
        <AuditText text={entry.text} />
      </EntryShell>
    );

  if (entry.kind === 'tool_call')
    return (
      <EntryShell
        kind="tool_call"
        title={
          <>
            <ProviderMark provider={entry.provider} small />
            <code>{entry.tool}</code>
          </>
        }
        at={entry.at}
        aside={<span className={`audit-outcome outcome-${entry.outcome}`}>{entry.outcome}</span>}
      >
        <p className="audit-meta">
          {[providerName(entry.provider), entry.reason, duration(entry.durationMs)]
            .filter(Boolean)
            .join(' · ')}
        </p>
        {entry.arguments !== undefined && <JsonView label="Arguments" value={entry.arguments} />}
        {entry.result !== undefined && <JsonView label="Result" value={entry.result} />}
        {entry.resultSha256 && <p className="audit-hash">Result hash {entry.resultSha256}</p>}
      </EntryShell>
    );

  return (
    <EntryShell
      kind="proposal"
      title={
        <>
          <ProviderMark provider={entry.provider} small />
          <strong>{entry.summary}</strong>
        </>
      }
      at={entry.at}
      aside={<span className={`audit-outcome proposal-${entry.status}`}>{entry.status}</span>}
    >
      <p className="audit-meta">
        <code>{entry.tool}</code> · {correctionLabel(entry.correction)}
      </p>
      {entry.transitions.length > 0 && (
        <ol className="audit-stepper">
          {entry.transitions.map((transition, index) => (
            <li key={`${transition.to}-${transition.at}-${index}`}>
              <strong>{transition.to}</strong>
              <span>
                {transition.actor} · {exactTime(transition.at)}
              </span>
              {transition.detail && <small>{transition.detail}</small>}
            </li>
          ))}
        </ol>
      )}
      <JsonView label="Arguments" value={entry.arguments} />
      {entry.beforeState !== undefined && <StateDiff before={entry.beforeState} after={entry.afterState} />}
    </EntryShell>
  );
}

/** The unsealed journal for one task: events, messages, tool calls, and proposals in order. */
export function AuditTab({ taskId }: { taskId: string }) {
  const [timeline, setTimeline] = useState<AuditTimeline | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      try {
        const response = await fetch(webApi.audit(taskId), { credentials: 'same-origin', signal });
        if (response.status === 401 || response.status === 403) {
          setTimeline(null);
          setError(NO_ACCESS);
          return;
        }
        if (!response.ok) {
          setError(LOAD_FAILED);
          return;
        }
        setTimeline((await response.json()) as AuditTimeline);
        setError(null);
      } catch {
        if (!signal?.aborted) setError(LOAD_FAILED);
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [taskId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  function exportJson() {
    if (!timeline) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(timeline, null, 2)], { type: 'application/json' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `audit-${taskId}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="audit-tab">
      <div className="audit-toolbar">
        <p>
          {timeline
            ? `${timeline.entries.length.toLocaleString()} recorded ${
                timeline.entries.length === 1 ? 'entry' : 'entries'
              }`
            : 'Every event, message, tool call, and proposal for this task.'}
        </p>
        <div>
          <button className="text-button" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={14} />
            Refresh
          </button>
          <button className="secondary-button compact" onClick={exportJson} disabled={!timeline}>
            <Download size={14} />
            Export JSON
          </button>
        </div>
      </div>
      {error && <p className="audit-error">{error}</p>}
      {loading && !timeline ? (
        <div className="messages-loading">
          <LoaderCircle size={17} className="spin" />
          Loading the audit trail
        </div>
      ) : timeline && !timeline.entries.length ? (
        <EmptyPane
          icon={<ScrollText size={22} />}
          title="Nothing recorded yet"
          text="Entries appear as the employee works and proposes external actions."
        />
      ) : (
        timeline && (
          <ol className="audit-list">
            {timeline.entries.map((entry) => (
              <Entry key={`${entry.kind}-${entry.id}`} entry={entry} />
            ))}
          </ol>
        )
      )}
    </div>
  );
}
