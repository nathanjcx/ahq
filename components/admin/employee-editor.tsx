'use client';

import { Check, LockKeyhole, Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import type { ModelId, Persona } from '@/lib/contracts';
import { PERSONA_LIMITS, PERSONA_TRAITS, type PersonaTrait } from '@/lib/personas';
import { lines } from '../shared/format';
import { Sheet } from '../shared/sheet';
import { CapabilityRows, type CapabilityRow } from './capability-rows';
import { MediaRows, type MediaRow } from './media-rows';
import { SkillRows, type SkillRow } from './skill-rows';
import { editorRowId, sha256, type EditorDraft } from './draft-issues';
import type { RegistryByProvider } from './registry';

export function EmployeeEditor({
  draft,
  registry,
  onClose,
  onSave,
}: {
  draft?: EditorDraft;
  registry: RegistryByProvider;
  onClose: () => void;
  onSave: (value: Record<string, unknown>) => Promise<void>;
}) {
  const [name, setName] = useState(draft?.name ?? '');
  const [role, setRole] = useState(draft?.role ?? '');
  const [description, setDescription] = useState(draft?.description ?? '');
  const [category, setCategory] = useState(draft?.category ?? '');
  const [color, setColor] = useState(draft?.color ?? '#6f8d72');
  const [model, setModel] = useState<ModelId>(draft?.model ?? 'gpt-5.6-terra');
  const [instructions, setInstructions] = useState(draft?.instructions ?? '');
  const [strengths, setStrengths] = useState(draft?.strengths.join('\n') ?? '');
  const [limitations, setLimitations] = useState(draft?.limitations.join('\n') ?? '');
  const [capabilities, setCapabilities] = useState<CapabilityRow[]>(() =>
    (draft?.capabilities ?? []).map((item) => ({ ...item, rowId: editorRowId() })),
  );
  const [skills, setSkills] = useState<SkillRow[]>(() =>
    (draft?.skills ?? []).map((item) => ({ ...item, rowId: editorRowId() })),
  );
  const [media, setMedia] = useState<MediaRow[]>(() =>
    (draft?.media ?? []).map((item) => ({ ...item, rowId: editorRowId() })),
  );
  const [voice, setVoice] = useState(draft?.persona?.voice ?? '');
  const [traits, setTraits] = useState<PersonaTrait[]>(() =>
    (draft?.persona?.traits ?? []).filter((trait): trait is PersonaTrait =>
      (PERSONA_TRAITS as readonly string[]).includes(trait),
    ),
  );
  const [catchphrase, setCatchphrase] = useState(draft?.persona?.catchphrase ?? '');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const skillCharacters = skills.reduce((total, skill) => total + skill.content.length, 0);
  const skillLimitError =
    skills.length > 10
      ? 'An employee can have at most 10 skills.'
      : skillCharacters > 600_000
        ? 'Private skill content must total 600,000 characters or less.'
        : null;

  /** Character only. An empty voice means this employee has no persona at all. */
  function persona(): Persona | undefined {
    if (!voice.trim()) return undefined;
    return {
      voice: voice.trim(),
      traits,
      ...(catchphrase.trim() ? { catchphrase: catchphrase.trim() } : {}),
    };
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (![name, role, description, category, color, instructions].every((value) => value.trim())) {
      setFormError('Complete every required listing and runtime field.');
      return;
    }
    const longStrength = lines(strengths).find((item) => item.length > 200);
    if (longStrength) {
      setFormError('Each strength must be 200 characters or less.');
      return;
    }
    const longLimitation = lines(limitations).find((item) => item.length > 300);
    if (longLimitation) {
      setFormError('Each limitation must be 300 characters or less.');
      return;
    }
    if (skills.some((skill) => !skill.name.trim() || !skill.version.trim())) {
      setFormError('Every skill needs a name and version.');
      return;
    }
    if (skillLimitError) {
      setFormError(skillLimitError);
      return;
    }
    if (!voice.trim() && (traits.length || catchphrase.trim())) {
      setFormError('A persona needs a voice before traits or a catchphrase.');
      return;
    }
    setFormError(null);
    setSaving(true);
    try {
      const hashedSkills = await Promise.all(
        skills.map(async ({ rowId: _rowId, ...skill }) => ({
          ...skill,
          sha256: await sha256(skill.content),
        })),
      );
      await onSave({
        draftId: draft?.id,
        name,
        role,
        description,
        category,
        color,
        model,
        instructions,
        strengths: lines(strengths),
        limitations: lines(limitations),
        capabilities: capabilities.map(({ rowId: _rowId, ...capability }) => capability),
        media: media.map(({ rowId: _rowId, ...item }) => item),
        skills: hashedSkills,
        persona: persona(),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet
      wide
      title={draft ? `Edit ${draft.name || 'draft'}` : 'Create employee'}
      subtitle="Public listing details are separated from private instructions and skill files."
      onClose={onClose}
    >
      <form className="editor-form" onSubmit={submit}>
        <section>
          <span className="editor-step">01</span>
          <div>
            <h3>Marketplace listing</h3>
            <p>Customers see these details before hiring.</p>
          </div>
        </section>
        <div className="form-grid">
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required />
          </label>
          <label>
            Role
            <input value={role} onChange={(e) => setRole(e.target.value)} maxLength={120} required />
          </label>
          <label className="full-field">
            Description
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={2000}
              required
            />
          </label>
          <label>
            Category
            <input value={category} onChange={(e) => setCategory(e.target.value)} maxLength={80} required />
          </label>
          <label>
            Accent color
            <span className="color-input">
              <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
              <input value={color} onChange={(e) => setColor(e.target.value)} maxLength={40} required />
            </span>
          </label>
          <label>
            Strengths, one per line
            <textarea value={strengths} onChange={(e) => setStrengths(e.target.value)} />
          </label>
          <label>
            Limitations, one per line
            <textarea value={limitations} onChange={(e) => setLimitations(e.target.value)} />
          </label>
        </div>
        <section>
          <span className="editor-step">02</span>
          <div>
            <h3>Runtime</h3>
            <p>These details remain private and versioned.</p>
          </div>
        </section>
        <div className="form-grid">
          <label>
            Model
            <select value={model} onChange={(e) => setModel(e.target.value as ModelId)}>
              <option value="gpt-5.6-luna">Luna · narrow, high-volume work</option>
              <option value="gpt-5.6-terra">Terra · routine multi-step work</option>
              <option value="gpt-5.6-sol">Sol · complex judgment</option>
              <option value="gpt-6-astra">Astra · hardest assignments</option>
            </select>
          </label>
          <label className="full-field">
            Private instructions
            <textarea
              className="code-area"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              maxLength={100_000}
              required
              spellCheck={false}
              placeholder="Describe the role, operating rules, and handoff requirements…"
            />
          </label>
        </div>
        <section>
          <span className="editor-step">03</span>
          <div>
            <h3>Persona</h3>
            <p>
              How this employee sounds, and up to {PERSONA_LIMITS.traits} traits. Character never changes what
              they are allowed to do.
            </p>
          </div>
        </section>
        <div className="form-grid">
          <label className="full-field">
            Voice
            <textarea
              value={voice}
              onChange={(e) => setVoice(e.target.value)}
              maxLength={PERSONA_LIMITS.voice}
              placeholder="One or two sentences on how this employee speaks and works…"
            />
          </label>
          <div className="full-field registry-tools" role="group" aria-label="Persona traits">
            {PERSONA_TRAITS.map((trait) => {
              const chosen = traits.includes(trait);
              return (
                <label key={trait} className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={chosen}
                    disabled={!chosen && traits.length >= PERSONA_LIMITS.traits}
                    onChange={() =>
                      setTraits((current) =>
                        chosen ? current.filter((item) => item !== trait) : [...current, trait],
                      )
                    }
                  />
                  <strong>{trait}</strong>
                </label>
              );
            })}
          </div>
          <label className="full-field">
            Catchphrase
            <input
              value={catchphrase}
              onChange={(e) => setCatchphrase(e.target.value)}
              maxLength={PERSONA_LIMITS.catchphrase}
              placeholder="Used at most once per task, never in tool arguments."
            />
          </label>
        </div>
        <section>
          <span className="editor-step">04</span>
          <div>
            <h3>MCP capabilities</h3>
            <p>Required connections block hiring until every listed tool is granted.</p>
          </div>
          <button
            type="button"
            className="secondary-button editor-add"
            onClick={() =>
              setCapabilities((items) => [
                ...items,
                { rowId: editorRowId(), provider: 'linear', tools: [], optional: false },
              ])
            }
          >
            <Plus size={14} /> Add MCP
          </button>
        </section>
        <CapabilityRows capabilities={capabilities} registry={registry} onChange={setCapabilities} />
        <section>
          <span className="editor-step">05</span>
          <div>
            <h3>Private skills</h3>
            <p>Add versioned skill files that the employee needs at runtime.</p>
          </div>
          <button
            type="button"
            className="secondary-button editor-add"
            disabled={skills.length >= 10}
            onClick={() =>
              setSkills((items) => [
                ...items,
                { rowId: editorRowId(), name: '', version: '1.0.0', sha256: '', content: '' },
              ])
            }
          >
            <Plus size={14} /> Add skill
          </button>
        </section>
        <SkillRows skills={skills} onChange={setSkills} />
        <section>
          <span className="editor-step">06</span>
          <div>
            <h3>Marketplace gallery</h3>
            <p>Add up to ten images or videos. Customers can view every item.</p>
          </div>
          <button
            type="button"
            className="secondary-button editor-add"
            disabled={media.length >= 10}
            onClick={() =>
              setMedia((items) => [...items, { rowId: editorRowId(), url: '', type: 'image', alt: '' }])
            }
          >
            <Plus size={14} /> Add media
          </button>
        </section>
        <MediaRows media={media} onChange={setMedia} />
        <div className="editor-footer">
          <div>
            {(formError || skillLimitError) && (
              <p className="editor-error" role="alert">
                {formError || skillLimitError}
              </p>
            )}
            <p>
              <LockKeyhole size={14} />
              Instructions and skills are never returned by public marketplace APIs.
            </p>
          </div>
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button" disabled={saving || Boolean(skillLimitError)}>
            <Check size={15} />
            {saving ? 'Saving…' : 'Save draft'}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
