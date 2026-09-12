'use client';

import { MessagesSquare, UserPlus, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import type { Actions } from '../app/actions';
import { ChannelFeed } from '../shared/channel-feed';
import { EmptyPane } from '../shared/empty';
import { SkeletonList } from '../shared/skeleton';
import { useUiQuery } from '../shared/use-ui-query';
import type { Employee } from '@/lib/contracts';
import { uiApi } from '@/lib/ui-api';

/**
 * The floor's own channel: the board every report, finding, incident, and handoff on this floor
 * lands in. A floor that has never been posted to has no channel yet, so opening one is the first
 * thing a person does here.
 */
export function FloorChannel({
  floorId,
  staff,
  canPost,
  actions,
  run,
  onTask,
}: {
  floorId: string;
  staff: Employee[];
  canPost: boolean;
  actions: Actions;
  run: (work: () => Promise<unknown>, success: string) => Promise<boolean>;
  onTask: (taskId: string) => void;
}) {
  const channels = useUiQuery(uiApi.channels, {});
  const [handoffOpen, setHandoffOpen] = useState(false);
  const channel = channels?.find((row) => row.kind === 'floor' && row.scopeId === floorId);

  if (channels === undefined) return <SkeletonList kind="post" rows={3} label="Loading the channel" />;

  if (!channel)
    return (
      <EmptyPane
        icon={<MessagesSquare size={19} />}
        title="This floor has no channel yet"
        text="Open it and everything this floor does — shift reports, findings, incidents, handoffs — starts collecting in one place."
        action={
          <button
            className="primary-button compact"
            disabled={!canPost}
            onClick={() => void run(() => actions.openChannel('floor', floorId), 'Channel opened')}
          >
            Open the channel
          </button>
        }
      />
    );

  return (
    <>
      <div className="floor-channel-bar">
        <button
          className="text-button"
          type="button"
          disabled={!canPost || !staff.length}
          onClick={() => setHandoffOpen((open) => !open)}
        >
          <UserPlus size={14} /> Request handoff
        </button>
      </div>
      {handoffOpen && (
        <HandoffForm
          staff={staff}
          onClose={() => setHandoffOpen(false)}
          onSubmit={(toEmployeeId, brief) => {
            void run(() => actions.requestHandoff(floorId, toEmployeeId, brief), 'Handoff requested');
            setHandoffOpen(false);
          }}
        />
      )}
      <ChannelFeed
        channelId={channel.id}
        actions={actions}
        canPost={canPost}
        onTask={onTask}
        mentionable={staff.map((employee) => ({
          id: employee.id,
          name: employee.name,
          role: employee.role,
        }))}
      />
    </>
  );
}

function HandoffForm({
  staff,
  onClose,
  onSubmit,
}: {
  staff: Employee[];
  onClose: () => void;
  onSubmit: (toEmployeeId: string, brief: string) => void;
}) {
  const [toEmployeeId, setToEmployeeId] = useState(staff[0]?.id ?? '');
  const [brief, setBrief] = useState('');

  function submit(event: FormEvent) {
    event.preventDefault();
    const value = brief.trim();
    if (!toEmployeeId || !value) return;
    onSubmit(toEmployeeId, value);
  }

  return (
    <form className="handoff-form" onSubmit={submit}>
      <header>
        <strong>Request a handoff</strong>
        <button className="icon-button" type="button" aria-label="Close handoff request" onClick={onClose}>
          <X size={15} />
        </button>
      </header>
      <label>
        Employee
        <select value={toEmployeeId} onChange={(event) => setToEmployeeId(event.target.value)} required>
          {staff.map((employee) => (
            <option key={employee.id} value={employee.id}>
              {employee.name} · {employee.role}
            </option>
          ))}
        </select>
      </label>
      <label>
        What should they pick up?
        <textarea
          value={brief}
          maxLength={5000}
          placeholder="Draft the follow-up summary for the client thread."
          onChange={(event) => setBrief(event.target.value)}
          required
        />
      </label>
      <button className="primary-button compact" disabled={!toEmployeeId || !brief.trim()}>
        Post the request
      </button>
    </form>
  );
}
