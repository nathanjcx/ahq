import assert from 'node:assert/strict';
import test from 'node:test';
import { CodexAppServer } from '../runtime/codex';
import type { SessionMessage } from '../shared/demo';

test('Codex captures early deltas and final messages before turn/start responds', async () => {
  const client = new CodexAppServer();
  const protocol = client as unknown as {
    request(method: string, params: unknown): Promise<unknown>;
    receive(line: string): void;
  };
  const messages: SessionMessage[] = [];
  const send = (method: string, params: Record<string, unknown>) =>
    protocol.receive(JSON.stringify({ method, params }));
  protocol.request = async (method) => {
    if (method === 'thread/start') return { thread: { id: 'thread-1' } };
    assert.equal(method, 'turn/start');
    send('item/agentMessage/delta', {
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'message-1',
      delta: 'Full ',
    });
    send('item/agentMessage/delta', {
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'message-1',
      delta: 'result',
    });
    await new Promise((resolve) => setTimeout(resolve, 230));
    send('item/completed', {
      threadId: 'thread-1',
      turnId: 'turn-1',
      item: { id: 'message-1', type: 'agentMessage', text: 'Full result' },
    });
    send('turn/completed', { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed', items: [] } });
    return { turn: { id: 'turn-1' } };
  };
  const result = await client.runTurn({
    cwd: '/tmp',
    model: 'gpt-6-astra',
    prompt: 'test',
    onMessage: (message) => messages.push(message),
  });
  assert.equal(result.message, 'Full result');
  assert.deepEqual(
    messages.map(({ text, complete }) => ({ text, complete })),
    [
      { text: 'Full result', complete: false },
      { text: 'Full result', complete: true },
    ],
  );
});
