'use client';

import { useState } from 'react';
import type { Connection, ConnectionVisibility } from '@/lib/contracts';
import { useMembers } from '../shared/members';
import { SkeletonList } from '../shared/skeleton';
import { Sheet } from '../shared/sheet';

const choices: { value: ConnectionVisibility; title: string; detail: string }[] = [
  { value: 'private', title: 'Private', detail: 'Only me' },
  { value: 'members', title: 'Specific people', detail: 'Choose who may use this account' },
  { value: 'workspace', title: 'Everyone in the workspace', detail: 'Every member may use this account' },
];

export function SharePanel({
  connection,
  onClose,
  onSave,
}: {
  connection: Connection;
  onClose: () => void;
  onSave: (visibility: ConnectionVisibility, visibleToSubjects: string[]) => void;
}) {
  const { members, loading, error } = useMembers();
  const [visibility, setVisibility] = useState<ConnectionVisibility>(connection.visibility);
  const [subjects, setSubjects] = useState(connection.visibleToSubjects);
  // The owner always has access, so they are never a choice in the list.
  const candidates = members.filter((member) => member.subject !== connection.ownerSubject);

  return (
    <Sheet
      title={`Sharing for ${connection.name}`}
      subtitle="You stay the owner of this account. Sharing only decides who may use it."
      onClose={onClose}
      footer={
        <button
          className="primary-button full"
          disabled={visibility === 'members' && subjects.length === 0}
          onClick={() => onSave(visibility, visibility === 'members' ? subjects : [])}
        >
          Save sharing
        </button>
      }
    >
      <div className="form-stack">
        <p className="form-note">
          People you share with can run employees through this account. Writes still wait for your approval or
          a workspace admin&apos;s.
        </p>
        <div className="share-choices">
          {choices.map((choice) => (
            <label key={choice.value}>
              <input
                type="radio"
                name="connection-visibility"
                checked={visibility === choice.value}
                onChange={() => setVisibility(choice.value)}
              />
              <span>
                <strong>{choice.title}</strong>
                <small>{choice.detail}</small>
              </span>
            </label>
          ))}
        </div>
        {visibility === 'members' &&
          (loading ? (
            <SkeletonList kind="member" rows={3} label="Loading workspace members" />
          ) : error ? (
            <p className="field-hint">{error}</p>
          ) : candidates.length === 0 ? (
            <p className="field-hint">Invite people by creating an organization in Clerk.</p>
          ) : (
            <div className="tool-checklist share-members">
              {candidates.map((member) => {
                const checked = subjects.includes(member.subject);
                return (
                  <label key={member.subject}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setSubjects(
                          checked
                            ? subjects.filter((subject) => subject !== member.subject)
                            : [...subjects, member.subject],
                        )
                      }
                    />
                    <span>
                      <strong>{member.name}</strong>
                      {member.email && <small>{member.email}</small>}
                    </span>
                  </label>
                );
              })}
            </div>
          ))}
      </div>
    </Sheet>
  );
}
