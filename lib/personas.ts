import type { Persona } from './contracts';

/** The fixed trait vocabulary. Studio picks from this list; the office animates from it. */
export const PERSONA_TRAITS = [
  'fast',
  'cautious',
  'methodical',
  'dry humour',
  'warm',
  'terse',
  'curious',
  'formal',
  'playful',
  'blunt',
] as const;
export type PersonaTrait = (typeof PERSONA_TRAITS)[number];

export const PERSONA_LIMITS = { voice: 400, traits: 5, catchphrase: 80 } as const;

export function isPersonaTrait(value: string): value is PersonaTrait {
  return (PERSONA_TRAITS as readonly string[]).includes(value);
}

/**
 * The persona paragraph appended to an employee's operating rules. Character only:
 * it never widens what the employee may do, and the catchphrase is kept out of tool
 * arguments so it can never change an external write.
 */
export function personaInstructions(persona: Persona): string {
  const traits = persona.traits.filter(isPersonaTrait);
  const lines = [`Voice: ${persona.voice.trim()}`];
  if (traits.length) lines.push(`Your manner is ${traits.join(', ')}.`);
  if (persona.catchphrase?.trim())
    lines.push(
      `You may use the phrase "${persona.catchphrase.trim()}" at most once per task, and never inside tool arguments.`,
    );
  lines.push('Voice never changes what you do, what you claim, or which tools you use.');
  return lines.join(' ');
}
