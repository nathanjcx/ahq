'use client';

import { useQuery } from 'convex/react';
import { History, Pause, Play, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ActionProposal, ActivityEvent, AuditTimeline, Task } from '@/lib/contracts';
import { providers as providerCatalog } from '@/lib/providers';
import { uiApi } from '@/lib/ui-api';
import { webClient } from '@/lib/api/client';
import { deriveActivities, providerForTool } from '../office/activity';
import type { OfficeSceneData } from '../office/office-stage';
import type { OfficeProvider } from '../office/office-view';

/** Replay runs at ten times the recorded pace. */
const SPEED = 10;
const TICK_MS = 100;
const REPLAYABLE: Task['status'][] = ['completed', 'failed', 'cancelled', 'uncertain'];

export type FloorReplayProps = {
  projectId: string;
  /** Whether a Convex client exists. Without one there is nothing to replay. */
  live: boolean;
  /** The employee ids on this floor, so replay only dresses people who are here. */
  employeeIds: string[];
  /** The scene to show, or undefined to hand the floor back to live work. */
  onScene: (scene: OfficeSceneData | undefined) => void;
};

export function FloorReplay(props: FloorReplayProps) {
  return props.live ? <LiveReplay {...props} /> : null;
}

/**
 * Rebuilds the office from one task's audit timeline: the same derivation the live
 * floor uses, fed only the entries recorded up to the scrubber's position.
 */
export function sceneAt(
  timeline: AuditTimeline,
  employeeId: string | undefined,
  at: number,
): OfficeSceneData {
  const taskId = timeline.task.id;
  const events: ActivityEvent[] = [];
  const proposals: ActionProposal[] = [];
  const providers: OfficeProvider[] = [];
  let lastMessage: Task['lastMessage'];
  let sequence = 0;
  for (const entry of timeline.entries) {
    if (entry.at > at) break;
    sequence += 1;
    if (entry.kind === 'event')
      events.push({
        id: entry.id,
        sequence,
        taskId,
        type: entry.type,
        text: entry.text,
        createdAt: entry.at,
      });
    else if (entry.kind === 'message') {
      if (entry.role === 'assistant' && entry.text.trim())
        lastMessage = {
          text: entry.text,
          createdAt: entry.at,
          ...(entry.phase ? { phase: entry.phase } : {}),
        };
    } else if (entry.kind === 'tool_call') {
      events.push({
        id: entry.id,
        sequence,
        taskId,
        type: 'tool_call',
        text: `${entry.tool}: ${entry.outcome}`,
        createdAt: entry.at,
      });
      const id = providerForTool(entry.tool) ?? entry.provider;
      if (id && !providers.some((provider) => provider.id === id)) {
        const known = providerCatalog.find((item) => item.id === id);
        providers.push({ id, name: known?.name ?? id, color: known?.color ?? '#607565', degraded: false });
      }
    } else if (entry.kind === 'proposal') {
      const decided = entry.transitions.some(
        (transition) => transition.at <= at && transition.to !== 'pending',
      );
      proposals.push({
        id: entry.id,
        taskId,
        connectionId: '',
        employeeName: timeline.task.employeeName,
        provider: entry.provider,
        tool: entry.tool,
        arguments: '',
        summary: entry.summary,
        status: decided ? 'approved' : 'pending',
        correction: entry.correction,
        correctionReason: '',
        createdAt: entry.at,
        canDecide: true,
      });
    }
  }
  const pending = proposals.some((proposal) => proposal.status === 'pending');
  const finished = timeline.entries.every((entry) => entry.at <= at);
  const task: Task = {
    id: taskId,
    projectId: undefined,
    employeeId: employeeId ?? '',
    employeeName: timeline.task.employeeName,
    createdBy: '',
    createdByName: timeline.task.createdByName,
    isOwner: false,
    visibility: 'workspace',
    title: timeline.task.title,
    prompt: '',
    status: finished ? timeline.task.status : pending ? 'awaiting_approval' : 'running',
    createdAt: timeline.task.createdAt,
    updatedAt: at,
    model: 'gpt-5.6-terra',
    ...(lastMessage ? { lastMessage } : {}),
  };
  return {
    activities: deriveActivities({
      employees: employeeId ? [{ id: employeeId, name: timeline.task.employeeName }] : [],
      tasks: [task],
      events,
      proposals,
      posts: [],
      now: at,
    }),
    providers,
    lightBudget: 0,
  };
}

/** The entry the scrubber is sitting on, for the caption under the bar. */
export function entryAt(timeline: AuditTimeline, at: number): string {
  let text = '';
  for (const entry of timeline.entries) {
    if (entry.at > at) break;
    text =
      entry.kind === 'event'
        ? entry.text
        : entry.kind === 'message'
          ? entry.text
          : entry.kind === 'tool_call'
            ? `${entry.tool}: ${entry.outcome}`
            : `Proposed ${entry.tool}: ${entry.summary}`;
  }
  return text.replace(/\s+/g, ' ').slice(0, 180);
}

function LiveReplay({ projectId, employeeIds, onScene }: FloorReplayProps) {
  const dashboard = useQuery(uiApi.dashboard, {});
  const [open, setOpen] = useState(false);
  const [taskId, setTaskId] = useState('');
  const [timeline, setTimeline] = useState<AuditTimeline | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [at, setAt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const onSceneRef = useRef(onScene);
  onSceneRef.current = onScene;

  const finished = useMemo(
    () =>
      (dashboard?.tasks ?? [])
        .filter((task) => task.projectId === projectId && REPLAYABLE.includes(task.status))
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 30),
    [dashboard, projectId],
  );
  const task = finished.find((item) => item.id === taskId);
  const span = timeline?.entries.length
    ? { from: timeline.entries[0].at, to: timeline.entries[timeline.entries.length - 1].at }
    : null;

  useEffect(() => {
    if (!open || !taskId) return;
    let cancelled = false;
    setError(null);
    setTimeline(null);
    webClient
      .audit(taskId)
      .then((data) => {
        if (cancelled) return;
        setTimeline(data);
        setAt(data.entries[0]?.at ?? 0);
        setPlaying(true);
      })
      .catch(() => !cancelled && setError('This timeline could not be loaded.'));
    return () => {
      cancelled = true;
    };
  }, [open, taskId]);

  useEffect(() => {
    if (!playing || !span) return;
    const timer = setInterval(() => {
      setAt((current) => {
        const next = current + TICK_MS * SPEED;
        if (next >= span.to) {
          setPlaying(false);
          return span.to;
        }
        return next;
      });
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [playing, span?.from, span?.to]);

  // The floor above owns the override, so it always learns when replay ends.
  useEffect(() => {
    if (!open || !timeline) {
      onSceneRef.current(undefined);
      return;
    }
    const employeeId = task?.employeeId ?? employeeIds[0];
    onSceneRef.current(sceneAt(timeline, employeeId, at));
  }, [open, timeline, at, task?.employeeId, employeeIds]);

  useEffect(() => () => onSceneRef.current(undefined), []);

  return (
    <>
      <button
        type="button"
        className="floor-replay-toggle"
        aria-pressed={open}
        disabled={!finished.length}
        title={finished.length ? 'Replay a finished task' : 'No finished tasks to replay yet'}
        onClick={() => {
          setOpen((value) => !value);
          setPlaying(false);
        }}
      >
        <History size={12} /> Replay
      </button>
      {open && (
        <div className="floor-replay" role="group" aria-label="Task replay">
          <div className="floor-replay-controls">
            <select
              value={taskId}
              aria-label="Task to replay"
              onChange={(event) => setTaskId(event.target.value)}
            >
              <option value="">Choose a finished task…</option>
              {finished.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="icon-button"
              disabled={!span}
              aria-label={playing ? 'Pause replay' : 'Play replay'}
              onClick={() => setPlaying((value) => !value)}
            >
              {playing ? <Pause size={13} /> : <Play size={13} />}
            </button>
            <input
              type="range"
              aria-label="Replay position"
              disabled={!span}
              min={span?.from ?? 0}
              max={span?.to ?? 1}
              value={at}
              onChange={(event) => {
                setPlaying(false);
                setAt(Number(event.target.value));
              }}
            />
            <span className="floor-replay-speed">{SPEED}×</span>
            <button
              type="button"
              className="icon-button"
              aria-label="Close replay"
              onClick={() => setOpen(false)}
            >
              <X size={13} />
            </button>
          </div>
          <p className="floor-replay-entry">
            {error ?? (timeline ? entryAt(timeline, at) || 'Waiting for the first entry.' : 'Loading…')}
          </p>
        </div>
      )}
    </>
  );
}
