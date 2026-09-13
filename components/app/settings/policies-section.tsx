'use client';

import { useState } from 'react';
import { formId, LockedNote, type SectionProps } from './sections';
import type { AuditPolicy, HiringPolicy } from '@/lib/contracts';

const hiringOptions: { value: HiringPolicy; label: string; hint: string }[] = [
  { value: 'anyone', label: 'Anyone', hint: 'Any member hires onto any floor.' },
  { value: 'admins', label: 'Administrators', hint: 'Only owners and administrators hire.' },
  { value: 'approval', label: 'On approval', hint: 'Members request; an administrator decides.' },
];

const auditOptions: { value: AuditPolicy; label: string; hint: string }[] = [
  {
    value: 'soft',
    label: 'Soft',
    hint: 'Findings lead the day. Other work waits behind them, and is not blocked on later days.',
  },
  {
    value: 'hard',
    label: 'Hard',
    hint: 'No other work runs for an instance while it has an open finding.',
  },
];

const channels: { value: string; label: string }[] = [
  { value: 'in_app', label: 'In app' },
  { value: 'push', label: 'Browser push' },
  { value: 'slack', label: 'Slack' },
  { value: 'email', label: 'Email' },
];

/** A tool allow-list is one reviewed tool name per line. */
function toList(text: string) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

export function PoliciesSection({ settings, canManage, save }: SectionProps) {
  const [draft, setDraft] = useState(settings);
  const [triageText, setTriageText] = useState(settings.triageAllowList.join('\n'));
  const [emergencyText, setEmergencyText] = useState(settings.emergencyAllowList.join('\n'));

  const toggleChannel = (value: string) =>
    setDraft({
      ...draft,
      notificationChannels: draft.notificationChannels.includes(value)
        ? draft.notificationChannels.filter((entry) => entry !== value)
        : [...draft.notificationChannels, value],
    });

  return (
    <form
      id={formId('policies')}
      className="form-stack"
      onSubmit={(event) => {
        event.preventDefault();
        void save(
          {
            ...draft,
            triageAllowList: toList(triageText),
            emergencyAllowList: toList(emergencyText),
          },
          'Policies saved',
        );
      }}
    >
      <div className="settings-field">
        <span className="settings-label">Hiring</span>
        <div className="settings-choices">
          {hiringOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              disabled={!canManage}
              data-active={draft.hiringPolicy === option.value}
              onClick={() => setDraft({ ...draft, hiringPolicy: option.value })}
            >
              <strong>{option.label}</strong>
              <small>{option.hint}</small>
            </button>
          ))}
        </div>
      </div>

      <div className="settings-field">
        <span className="settings-label">Audit findings</span>
        <div className="settings-choices">
          {auditOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              disabled={!canManage}
              data-active={draft.auditPolicy === option.value}
              onClick={() => setDraft({ ...draft, auditPolicy: option.value })}
            >
              <strong>{option.label}</strong>
              <small>{option.hint}</small>
            </button>
          ))}
        </div>
      </div>

      <label>
        Triage pull-request allow-list
        <textarea
          rows={3}
          disabled={!canManage}
          value={triageText}
          placeholder="create_pull_request"
          onChange={(event) => setTriageText(event.target.value)}
        />
        <small>
          One reviewed tool per line. The Triage floor may use these without asking, per proposal. Merging and
          deploying are not among them.
        </small>
      </label>

      <label>
        Emergency allow-list
        <textarea
          rows={3}
          disabled={!canManage}
          value={emergencyText}
          placeholder="merge_pull_request"
          onChange={(event) => setEmergencyText(event.target.value)}
        />
        <small>Merge and deploy tools, usable only under the emergency rule below.</small>
      </label>

      <div className="settings-rule">
        <strong>When triage may act without you</strong>
        <p>
          Inside attended hours, never: a merge or a deploy waits for your approval. Outside attended hours, a
          triage employee may reach for the emergency allow-list only after three notification attempts spaced
          over twenty minutes have all gone unacknowledged. It must then verify the fix and file an incident
          report naming the issue, the reproduction, the fix, why it acted without permission, and the
          knock-on risks. Every step is journaled and the report goes to the workspace channel and the next
          meeting.
        </p>
      </div>

      <div className="settings-field">
        <span className="settings-label">How we reach you</span>
        <div className="tool-checklist">
          {channels.map((channel) => (
            <label key={channel.value}>
              <input
                type="checkbox"
                disabled={!canManage}
                checked={draft.notificationChannels.includes(channel.value)}
                onChange={() => toggleChannel(channel.value)}
              />
              <span>
                <strong>{channel.label}</strong>
              </span>
            </label>
          ))}
        </div>
        <small>An attempt counts only when at least one channel delivered.</small>
      </div>
      {!canManage && <LockedNote what="Policies" />}
    </form>
  );
}
