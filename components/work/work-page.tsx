'use client';

import { ArrowRight, Check, Inbox, Siren, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { PageProps } from '../app/page-props';
import { useNow } from '../office/use-day';
import { EmptyPane } from '../shared/empty';
import { Avatar } from '../shared/marks';
import { MasterDetail, useMasterDetail } from '../shared/master-detail';
import { relativeTime } from '../shared/time';
import { useUiQuery } from '../shared/use-ui-query';
import { TaskDetail } from '../tasks/task-detail';
import { taskFloorName } from '../tasks/tasks-page';
import type { Employee } from '@/lib/contracts';
import { pluralize } from '@/lib/text';
import { uiApi } from '@/lib/ui-api';
import { GROUP_LABELS, buildThreads, type Thread, type ThreadGroup } from '@/lib/work';
import './work.css';

const GROUPS: ThreadGroup[] = ['needs', 'running', 'waiting', 'done'];

type Props = PageProps & { onCorrect: (proposalId: string) => void };

/** The stream of everything in motion, grouped by what it needs from a person, beside the open thread. */
export function WorkPage(props: Props) {
  const { dashboard, actions, run, configured } = props;
  const handoffs = useUiQuery(uiApi.pendingHandoffs, {});
  const alerts = useUiQuery(uiApi.alerts, {});
  const [scope, setScope] = useState<'needs' | 'all'>('needs');
  const [employeeFilter, setEmployeeFilter] = useState('all');
  const { open, openDetail, closeDetail } = useMasterDetail();
  const now = useNow(60_000);
  const threads = useMemo(
    () =>
      buildThreads({
        tasks: dashboard.tasks,
        proposals: dashboard.proposals,
        handoffs: handoffs ?? [],
        alerts: alerts ?? [],
        now,
      }),
    [dashboard.tasks, dashboard.proposals, handoffs, alerts, now],
  );
  const [picked, setPicked] = useState<string | null>(null);
  const needsCount = threads.filter((thread) => thread.group === 'needs').length;
  const list = threads.filter(
    (thread) =>
      (scope === 'all' || thread.group === 'needs') &&
      (employeeFilter === 'all' || thread.employeeId === employeeFilter),
  );
  // A task another page selected opens here; otherwise the last row picked, otherwise the first.
  const selectedId = props.selectedTask ? `task:${props.selectedTask}` : null;
  const current =
    list.find((thread) => thread.id === picked) ?? list.find((thread) => thread.id === selectedId) ?? list[0];
  const employees = dashboard.employees;
  const withThreads = employees.filter((employee) =>
    threads.some((thread) => thread.employeeId === employee.id),
  );

  const select = (thread: Thread) => {
    props.onSelectTask(thread.taskId ?? null);
    setPicked(thread.id);
    openDetail();
  };

  if (!threads.length)
    return (
      <div className="work-empty card">
        <EmptyPane
          icon={<Inbox size={22} />}
          title="Nothing in motion"
          text="Give an employee a task and follow it here."
        />
        <button className="primary-button" disabled={!configured} onClick={() => props.onNewTask()}>
          New task
        </button>
      </div>
    );

  return (
    <MasterDetail
      className="work-layout card"
      open={open}
      backLabel="Work"
      onBack={closeDetail}
      list={
        <div className="work-list">
          <div className="work-list-head">
            <div className="work-scope" role="tablist" aria-label="Which threads">
              <button role="tab" aria-selected={scope === 'needs'} onClick={() => setScope('needs')}>
                Needs you {needsCount > 0 && <em>{needsCount}</em>}
              </button>
              <button role="tab" aria-selected={scope === 'all'} onClick={() => setScope('all')}>
                All
              </button>
            </div>
            <label className="work-filter">
              <span className="sr-only">Filter by employee</span>
              <select value={employeeFilter} onChange={(event) => setEmployeeFilter(event.target.value)}>
                <option value="all">Everyone</option>
                {withThreads.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {GROUPS.map((group) => {
            const rows = list.filter((thread) => thread.group === group);
            if (!rows.length) return null;
            return (
              <section key={group} aria-label={GROUP_LABELS[group]}>
                <h3 className="work-group">
                  {GROUP_LABELS[group]} <span>{rows.length}</span>
                </h3>
                {rows.map((thread) => (
                  <ThreadRow
                    key={thread.id}
                    thread={thread}
                    employee={employees.find((employee) => employee.id === thread.employeeId)}
                    active={current?.id === thread.id}
                    onOpen={() => select(thread)}
                  />
                ))}
              </section>
            );
          })}
          {!list.length && (
            <EmptyPane
              icon={<Check size={20} />}
              title="Nothing needs you"
              text="Everything is running or done."
            />
          )}
        </div>
      }
      detail={
        current ? (
          <ThreadPane
            key={current.id}
            thread={current}
            props={props}
            onDecideHandoff={(id, accepted) =>
              run(
                () => actions.decideHandoff(id, accepted),
                accepted ? 'Handoff accepted' : 'Handoff declined',
              )
            }
          />
        ) : (
          <EmptyPane
            icon={<Inbox size={20} />}
            title="Pick a thread"
            text="Choose a thread to read it here."
          />
        )
      }
    />
  );
}

function ThreadRow({
  thread,
  employee,
  active,
  onOpen,
}: {
  thread: Thread;
  employee?: Employee;
  active: boolean;
  onOpen: () => void;
}) {
  return (
    <button className="work-row" data-active={active} onClick={onOpen}>
      {employee ? (
        <Avatar employee={employee} />
      ) : (
        <span className="avatar work-avatar" data-kind={thread.kind}>
          {thread.kind === 'alert' ? <Siren size={14} /> : thread.who.slice(0, 1)}
        </span>
      )}
      <span className="work-row-body">
        <span className="work-row-who">
          <strong>{thread.who}</strong>
          <span>{thread.title}</span>
        </span>
        <span className="work-row-preview">{thread.preview}</span>
        <span className="work-status" data-tone={thread.tone}>
          <i />
          {thread.label}
        </span>
      </span>
      <time className="work-row-time">{relativeTime(thread.at)}</time>
    </button>
  );
}

function ThreadPane({
  thread,
  props,
  onDecideHandoff,
}: {
  thread: Thread;
  props: Props;
  onDecideHandoff: (postId: string, accepted: boolean) => Promise<boolean>;
}) {
  const { dashboard, actions, run, go } = props;
  if (thread.kind === 'task' && thread.taskId) {
    const task = dashboard.tasks.find((item) => item.id === thread.taskId);
    if (!task) return null;
    const floor = dashboard.floors.find((item) => item.id === task.floorId);
    const floorEmployees = dashboard.employees.filter((employee) => floor?.employeeIds.includes(employee.id));
    return (
      <TaskDetail
        task={task}
        floorName={taskFloorName(task, dashboard.floors)}
        proposals={dashboard.proposals.filter((proposal) => proposal.taskId === task.id)}
        floorEmployees={floorEmployees}
        onSend={(taskId, text) => run(() => actions.sendMessage(taskId, text), 'Message sent')}
        onCancel={(taskId) => run(() => actions.cancelTask(taskId), 'Task cancelled')}
        onDecide={(id, approved) =>
          run(() => actions.decide(id, approved), approved ? 'Action approved' : 'Action rejected')
        }
        onCorrect={props.onCorrect}
        onSetVisibility={(taskId, visibility) =>
          run(() => actions.setTaskVisibility(taskId, visibility), 'Visibility updated')
        }
        onRequestHandoff={(floorId, toEmployeeId, brief, taskId) =>
          run(() => actions.requestHandoff(floorId, toEmployeeId, brief, taskId), 'Handoff requested')
        }
      />
    );
  }
  if (thread.kind === 'handoff' && thread.handoff) {
    const handoff = thread.handoff;
    return (
      <div className="work-pane">
        <header className="work-pane-head">
          <h2>Handoff to {handoff.toEmployeeName}</h2>
          <p>
            {handoff.fromName} asked {relativeTime(handoff.createdAt)} · {handoff.floorName}
          </p>
        </header>
        <div className="work-pane-body">
          <p className="work-brief">{handoff.brief}</p>
          <p className="work-hint">
            Accepting starts a task for {handoff.toEmployeeName} with this brief
            {handoff.sourceTaskId ? ' and the source task’s final message' : ''}.
          </p>
          <div className="work-pane-actions">
            <button className="primary-button compact" onClick={() => void onDecideHandoff(handoff.id, true)}>
              <Check size={14} /> Accept
            </button>
            <button
              className="secondary-button compact"
              onClick={() => void onDecideHandoff(handoff.id, false)}
            >
              <X size={14} /> Decline
            </button>
            {handoff.sourceTaskId && (
              <button
                className="text-button"
                onClick={() => props.onSelectTask(handoff.sourceTaskId ?? null)}
              >
                Open the source task <ArrowRight size={13} />
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }
  if (thread.kind === 'alert' && thread.alert) {
    const alert = thread.alert;
    return (
      <div className="work-pane">
        <header className="work-pane-head">
          <h2>{alert.title}</h2>
          <p>
            {alert.severity} · {alert.source} · {pluralize(alert.occurrences, 'occurrence')} ·{' '}
            {relativeTime(alert.updatedAt)}
          </p>
        </header>
        <div className="work-pane-body">
          <p className="work-brief">{alert.detail}</p>
          <div className="work-pane-actions">
            <button className="primary-button compact" onClick={() => go('triage')}>
              Open incidents <ArrowRight size={14} />
            </button>
            {alert.triageTaskId && (
              <button
                className="secondary-button compact"
                onClick={() => {
                  props.onSelectTask(alert.triageTaskId ?? null);
                  go('tasks');
                }}
              >
                Triage task
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }
  return null;
}
