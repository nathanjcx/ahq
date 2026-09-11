import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  mutate: vi.fn(),
  connectedMcp: vi.fn(),
  callTool: vi.fn(),
}));
vi.mock('../lib/server/backend', () => ({ query: mocks.query, mutate: mocks.mutate }));
vi.mock('../lib/server/mcp', () => ({ connectedMcp: mocks.connectedMcp }));
import { executeAction } from '../services/actions';
const job = {
  id: 'job',
  kind: 'execute_action',
  taskId: 'task',
  payload: { proposalId: 'proposal' },
  leaseToken: 'lease',
  attempts: 1,
};
const context = () => ({
  action: { id: 'proposal', tool: 'update_issue', arguments: '{"id":"issue","title":"Corrected"}' },
  connection: { id: 'connection', provider: 'linear', resourceScope: '', allowedTools: ['update_issue'] },
  task: { id: 'task', runToken: 'run' },
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.query.mockResolvedValue(context());
  mocks.mutate.mockResolvedValue(null);
  mocks.connectedMcp.mockImplementation(async (_connection, run) => run({ callTool: mocks.callTool }));
  mocks.callTool.mockResolvedValue({ content: [{ type: 'text', text: 'Updated' }] });
});
afterEach(() => {
  delete process.env.MCP_TOOL_POLICIES_JSON;
});
it('checks authorization again after connecting and before dispatch', async () => {
  mocks.query.mockResolvedValueOnce(context()).mockRejectedValueOnce(new Error('Grant revoked'));
  await executeAction(job);
  expect(mocks.callTool).not.toHaveBeenCalled();
  expect(mocks.mutate).toHaveBeenCalledWith(
    'services:recordActionResult',
    expect.objectContaining({ status: 'failed' }),
  );
});
it('never retries a write with an unknown network outcome', async () => {
  mocks.callTool.mockRejectedValue(new Error('Connection dropped'));
  await executeAction(job);
  expect(mocks.callTool).toHaveBeenCalledTimes(1);
  expect(mocks.mutate).toHaveBeenCalledWith(
    'services:recordActionResult',
    expect.objectContaining({ status: 'uncertain' }),
  );
});
it('does not mistake an upstream tool error for proof that no write happened', async () => {
  mocks.callTool.mockResolvedValue({ isError: true, content: [] });
  await executeAction(job);
  expect(mocks.mutate).toHaveBeenCalledWith(
    'services:recordActionResult',
    expect.objectContaining({ status: 'uncertain' }),
  );
});
it('sends only configured restoration fields with a provider version precondition', async () => {
  process.env.MCP_TOOL_POLICIES_JSON = JSON.stringify({
    'linear:update_issue': {
      mode: 'write',
      correction: {
        readTool: 'get_issue',
        idArgument: 'id',
        versionField: 'version',
        expectedVersionArgument: 'expectedVersion',
        fields: ['title'],
      },
    },
  });
  const value = {
    ...context(),
    action: { ...context().action, originalActionId: 'original' },
    original: {
      tool: 'update_issue',
      arguments: '{"id":"issue","title":"Corrected"}',
      beforeState: '{"title":"Original","privateOther":"Do not restore","version":1}',
      afterState: '{"title":"Corrected","version":2}',
    },
  };
  mocks.query.mockResolvedValue(value);
  await executeAction(job);
  expect(mocks.callTool).toHaveBeenCalledWith(
    { name: 'update_issue', arguments: { id: 'issue', title: 'Original', expectedVersion: 2 } },
    undefined,
    { timeout: 45000 },
  );
});
it('refuses corrections without a verified provider version', async () => {
  mocks.query.mockResolvedValue({
    ...context(),
    action: { ...context().action, originalActionId: 'original' },
  });
  await executeAction(job);
  expect(mocks.callTool).not.toHaveBeenCalled();
});
