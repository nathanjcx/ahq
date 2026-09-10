import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, Plus, Sparkles } from 'lucide-react';
import type { Employee } from '../../shared/types';
import Modal from './Modal';

export type EmployeeFields = Pick<Employee, 'name' | 'jobTitle' | 'personality'>;

function identity(name: string, jobTitle: string) {
  return JSON.stringify([name.trim(), jobTitle.trim()]);
}

export default function EmployeeForm({
  initial,
  onClose,
  onCreate,
}: {
  initial?: Employee;
  onClose: () => void;
  onCreate: (fields: EmployeeFields) => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [jobTitle, setJobTitle] = useState(initial?.jobTitle ?? '');
  const [personality, setPersonality] = useState(initial?.personality ?? '');
  const [generatedFor, setGeneratedFor] = useState(
    initial?.personality.trim() ? identity(initial.name, initial.jobTitle) : '',
  );
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(0);
  const currentIdentity = identity(name, jobTitle);
  const identityRef = useRef(currentIdentity);
  identityRef.current = currentIdentity;

  useEffect(
    () => () => {
      request.current += 1;
    },
    [],
  );

  const hasIdentity = Boolean(name.trim() && jobTitle.trim());
  const canSave =
    hasIdentity && Boolean(personality.trim()) && generatedFor === currentIdentity && !generating;

  function changeIdentity(nextName: string, nextJob: string) {
    const nextIdentity = identity(nextName, nextJob);
    setName(nextName);
    setJobTitle(nextJob);
    identityRef.current = nextIdentity;
    if (nextIdentity === currentIdentity) return;
    request.current += 1;
    setGenerating(false);
    setError('');
    setPersonality('');
    setGeneratedFor('');
  }

  async function generate() {
    if (!hasIdentity || generating) return;
    const token = ++request.current;
    const forIdentity = currentIdentity;
    setGenerating(true);
    setError('');
    try {
      if (!window.ahq?.generatePersonality) {
        throw new Error(
          'Open the Astra HQ desktop app and connect ChatGPT in Settings to generate a personality.',
        );
      }
      const result = (
        await window.ahq.generatePersonality({
          name: name.trim(),
          jobTitle: jobTitle.trim(),
        })
      ).trim();
      if (token !== request.current || identityRef.current !== forIdentity) return;
      if (!result || result.length > 2000) {
        throw new Error('The personality could not be generated. Please try again.');
      }
      setPersonality(result);
      setGeneratedFor(forIdentity);
    } catch (cause) {
      if (token !== request.current || identityRef.current !== forIdentity) return;
      setError(
        cause instanceof Error ? cause.message : 'The personality could not be generated. Please try again.',
      );
    } finally {
      if (token === request.current) setGenerating(false);
    }
  }

  return (
    <Modal title={initial ? `Edit ${initial.name}` : 'New employee'} brand={false} onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (canSave)
            onCreate({ name: name.trim(), jobTitle: jobTitle.trim(), personality: personality.trim() });
        }}
      >
        <div className="form-grid">
          <label>
            Name
            <input
              autoFocus
              required
              maxLength={40}
              placeholder="e.g. Alex"
              value={name}
              onChange={(event) => changeIdentity(event.target.value, jobTitle)}
            />
          </label>
          <label>
            Job
            <input
              required
              maxLength={80}
              placeholder="e.g. Research Assistant"
              value={jobTitle}
              onChange={(event) => changeIdentity(name, event.target.value)}
            />
          </label>
        </div>
        <div className="label-row">
          <label htmlFor="employee-personality">Personality</label>
          <button
            type="button"
            className="text-button"
            disabled={!hasIdentity || generating}
            onClick={() => void generate()}
          >
            {generating ? <LoaderCircle size={13} className="spin" /> : <Sparkles size={13} />}
            {generating ? 'Generating personality…' : 'Generate personality'}
          </button>
        </div>
        <textarea
          id="employee-personality"
          readOnly
          value={personality}
          rows={5}
          aria-busy={generating}
          aria-describedby="employee-personality-hint"
          placeholder="Their AI-generated personality will appear here."
        />
        <p id="employee-personality-hint" className="form-hint">
          {initial
            ? 'Generate again whenever you change their name or job.'
            : 'A unique avatar is randomly created when they join your office.'}
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-footer">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" type="submit" disabled={!canSave}>
            <Plus size={16} />
            {initial ? 'Save profile' : 'New employee'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
