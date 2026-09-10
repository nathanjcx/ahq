export const reviewOutputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['content', 'question', 'choices'],
  properties: {
    content: { type: 'string', minLength: 1, maxLength: 200000 },
    question: {
      anyOf: [{ type: 'string', minLength: 1, maxLength: 300 }, { type: 'null' }],
    },
    choices: {
      anyOf: [
        {
          type: 'array',
          minItems: 2,
          maxItems: 6,
          items: { type: 'string', minLength: 1, maxLength: 160 },
        },
        { type: 'null' },
      ],
    },
  },
};

export const reviewChoiceInstructions = `Return your final report as one JSON object with exactly three fields: content, question, and choices. Put the complete plain-language report or deliverable in content; Markdown is allowed inside that string. When you need the manager to choose between concrete alternatives before you continue, put a short question in question and 2 to 6 distinct short options in choices. Do not make the choice yourself. Otherwise set BOTH question and choices to null and return the deliverable in content for a yes/no review. Never return only a schema, a code fence, or a :::choices block. Never treat a selection as permission for unrelated external actions.`;

function structuredReview(text: string): { content: string; question?: string; choices?: string[] } | null {
  if (text.length > 256000 || !text.trimStart().startsWith('{')) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const fields = value as Record<string, unknown>;
  if (
    Object.keys(fields).length !== 3 ||
    !['content', 'question', 'choices'].every((key) => Object.hasOwn(fields, key)) ||
    typeof fields.content !== 'string' ||
    !fields.content.trim() ||
    fields.content.length > 200000
  )
    return null;
  if (fields.question === null && fields.choices === null) return { content: fields.content.trim() };
  if (
    typeof fields.question !== 'string' ||
    !fields.question.trim() ||
    fields.question.length > 300 ||
    !Array.isArray(fields.choices) ||
    fields.choices.length < 2 ||
    fields.choices.length > 6 ||
    fields.choices.some((choice) => typeof choice !== 'string' || !choice.trim() || choice.length > 160)
  )
    return null;
  const choices = (fields.choices as string[]).map((choice) => choice.trim());
  if (new Set(choices).size !== choices.length) return null;
  return { content: fields.content.trim(), question: fields.question.trim(), choices };
}

export function parseReviewContent(text: string): { content: string; question?: string; choices?: string[] } {
  const structured = structuredReview(text);
  if (structured) return structured;
  const match = /(?:^|\n):::choices\r?\n([^\n]+)\r?\n([\s\S]*?)\r?\n:::\s*$/.exec(text);
  if (!match) return { content: text };
  const question = match[1].trim();
  const lines = match[2].split(/\r?\n/).filter((line) => line.trim());
  if (
    !question ||
    question.length > 300 ||
    lines.length < 2 ||
    lines.length > 6 ||
    lines.some((line) => !/^\s*-\s+\S/.test(line))
  )
    return { content: text };
  const choices = lines.map((line) => line.replace(/^\s*-\s+/, '').trim());
  if (choices.some((choice) => choice.length > 160) || new Set(choices).size !== choices.length)
    return { content: text };
  return { content: text.slice(0, match.index).trim() || question, question, choices };
}
