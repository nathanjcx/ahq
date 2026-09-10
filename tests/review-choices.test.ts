import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parseReviewContent, reviewOutputSchema } from '../shared/reviewChoices';
import { HostedEmployees } from '../desktop/hosted';
import { SnapshotStore } from '../runtime/store';
import { initialState, sampleState } from '../src/lib/store';
import { applySession } from '../src/lib/workflow';
import { StateSchema, SessionSchema } from '../shared/schemas';

test('structured reports expose a question only when paired with valid distinct choices', () => {
  assert.deepEqual(
    parseReviewContent(
      JSON.stringify({
        content: 'I can draft either version.',
        question: 'Which tone?',
        choices: ['Warm and playful', 'Calm and simple'],
      }),
    ),
    {
      content: 'I can draft either version.',
      question: 'Which tone?',
      choices: ['Warm and playful', 'Calm and simple'],
    },
  );
  assert.deepEqual(
    parseReviewContent(
      JSON.stringify({ content: '# Your note\nWelcome to the book club.', question: null, choices: null }),
    ),
    {
      content: '# Your note\nWelcome to the book club.',
    },
  );
});

test('invalid structured envelopes remain intact instead of inventing review controls', () => {
  const valid = { content: 'A report for your review.', question: 'Which tone?', choices: ['Warm', 'Calm'] };
  const invalid = [
    { ...valid, question: null },
    { ...valid, choices: null },
    { ...valid, choices: ['One'] },
    { ...valid, choices: ['Same', ' Same '] },
    { ...valid, choices: ['', 'Valid'] },
    { ...valid, choices: [1, 'Valid'] },
    { ...valid, choices: ['x'.repeat(161), 'Valid'] },
    { ...valid, choices: Array.from({ length: 7 }, (_, index) => String(index)) },
    { ...valid, question: 'x'.repeat(301) },
    { ...valid, content: ' ' },
    { ...valid, content: 'x'.repeat(200001) },
    { ...valid, extra: 'unknown' },
    { content: 'A legacy JSON document' },
    { content: 'A report', question: null },
  ];
  for (const value of invalid) {
    const text = JSON.stringify(value);
    assert.deepEqual(parseReviewContent(text), { content: text });
  }
  const incomplete = '{"content":"Unfinished';
  assert.deepEqual(parseReviewContent(incomplete), { content: incomplete });
});

test('explicit employee choices become review controls while ordinary lists remain a document', () => {
  const content =
    'I prepared two designs.\n\n:::choices\nWhich direction should I develop?\n- Warm and playful\n- Calm and simple\n:::';
  assert.deepEqual(parseReviewContent(content), {
    content: 'I prepared two designs.',
    question: 'Which direction should I develop?',
    choices: ['Warm and playful', 'Calm and simple'],
  });
  const list = 'Plan:\n- Research\n- Draft\n- Review';
  assert.deepEqual(parseReviewContent(list), { content: list });
});
test('malformed, duplicate and oversized choices preserve the original report', () => {
  for (const block of ['- One', '- Same\n- Same', 'One\nTwo', `- ${'x'.repeat(161)}\n- Two`]) {
    const text = `Report\n:::choices\nWhich?\n${block}\n:::`;
    assert.deepEqual(parseReviewContent(text), { content: text });
  }
});
test('actual session questions and choices survive validation, review creation and persistence', () => {
  const employee = sampleState().employees[0];
  const session = SessionSchema.parse({
    id: 'chatgpt-review',
    status: 'waiting_for_approval',
    activity: 'Choose a direction',
    location: 'board',
    events: [],
    output: {
      title: 'Choose the design',
      sources: [],
      recipient: 'You',
      version: 1,
      ...parseReviewContent(
        JSON.stringify({
          content: 'Two directions.',
          question: 'Which one?',
          choices: ['First design', 'Second design'],
        }),
      ),
    },
  });
  const state = StateSchema.parse(
    applySession({ ...initialState(), employees: [employee] }, employee.id, session),
  );
  assert.equal(state.approvals[0].question, 'Which one?');
  assert.deepEqual(state.approvals[0].choices, ['First design', 'Second design']);
});

test('hosted reviews request strict JSON, retain choices through revisions, and keep MCP permission separate', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ahq-review-envelope-'));
  const store = await SnapshotStore.open(directory);
  const originalFetch = globalThis.fetch;
  const requests: Record<string, unknown>[] = [];
  const envelopes = [
    { content: 'I can write either tone.', question: 'Which tone?', choices: ['Warm', 'Calm'] },
    {
      content: 'Welcome to our fictional book club. We look forward to reading together.',
      question: null,
      choices: null,
    },
    { content: 'I prepared a draft task.', question: 'Which wording?', choices: ['Short', 'Detailed'] },
  ];
  globalThis.fetch = async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    const index = requests.length - 1;
    return new Response(
      JSON.stringify({
        id: `review-response-${index}`,
        status: 'completed',
        output: [
          { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(envelopes[index]) }] },
          ...(index === 2
            ? [
                {
                  type: 'mcp_approval_request',
                  id: 'permission-1',
                  name: 'create_task',
                  server_label: 'integration_tracker',
                  arguments: '{"title":"Book club draft"}',
                },
              ]
            : []),
        ],
      }),
    );
  };
  try {
    const config = {
      key: 'test-key',
      model: 'gpt-6-astra',
      integrations: [
        { id: 'tracker', name: 'Tracker', url: 'https://example.com/mcp', key: 'private-test-key' },
      ],
    };
    const engine = new HostedEmployees(store, async () => config);
    const employee = { ...sampleState().employees[0], skills: 'Tracker', sessionId: undefined };
    const first = await engine.start(employee, 'Ask me to choose a tone.', initialState());
    assert.deepEqual(first.output?.choices, ['Warm', 'Calm']);
    assert.equal(first.output?.question, 'Which tone?');
    assert.equal(first.output?.content, 'I can write either tone.');
    const revised = await engine.decide(first.id, 1, 'request_changes', 'Calm. Write the note.');
    assert.equal(revised.output?.version, 2);
    assert.equal(revised.output?.choices, undefined);
    assert.match(revised.output!.content, /Welcome to our fictional book club/);
    for (const request of requests)
      assert.deepEqual(request.text, {
        format: { type: 'json_schema', name: 'employee_review', strict: true, schema: reviewOutputSchema },
      });
    const permission = await engine.start(employee, 'Prepare a draft task.', initialState());
    assert.equal(permission.status, 'waiting_for_approval');
    assert.equal(permission.output?.choices, undefined);
    assert.match(permission.output!.content, /I prepared a draft task/);
    assert.match(permission.output!.content, /permission to create task/);
    assert.ok(!permission.output!.content.includes('"question"'));
    assert.equal(permission.output?.recipient, 'Connected integration');
  } finally {
    globalThis.fetch = originalFetch;
    await store.drain();
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
