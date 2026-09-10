import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveOfficePresence } from '../src/lib/office-presence';
import { initialState } from '../src/lib/store';
import type { OfficeEvent } from '../shared/office-events';

const employees = initialState()
  .employees.slice(0, 2)
  .map((employee) => ({ ...employee, sessionId: `session-${employee.id}` }));
function event(
  sequence: number,
  kind: OfficeEvent['kind'],
  at: number,
  extra: Partial<OfficeEvent> = {},
): OfficeEvent {
  return {
    id: `event-${sequence}`,
    version: 1,
    sequence,
    kind,
    source: 'tool',
    summary: kind,
    employeeId: employees[0].id,
    occurredAt: new Date(at).toISOString(),
    recordedAt: new Date(at).toISOString(),
    hash: 'a'.repeat(64),
    previousHash: null,
    ...extra,
  };
}

test('real employees never get invented activity and fixed replay time yields identical poses', () => {
  const noEvents = deriveOfficePresence(employees, [], 1000, true);
  assert.ok(
    Object.values(noEvents.employees).every(
      (employee) => !employee.observed && !employee.sample && !employee.walking,
    ),
  );
  const events = [
    event(1, 'session.started', 1000),
    event(2, 'tool.started', 2000, { toolName: 'memory_search' }),
  ];
  const scene = deriveOfficePresence(employees, events, 3500);
  assert.equal(scene.employees[employees[0].id].station, 'archive');
  assert.equal(scene.employees[employees[0].id].walking, true);
  assert.deepEqual(scene, deriveOfficePresence(employees, [...events].reverse(), 3500));
  assert.deepEqual(scene, deriveOfficePresence(employees, events, 3500));
});

test('a committed typed memory remains visible after its tool receipt and proposals never become filing', () => {
  const events = [
    event(1, 'memory.saved', 2000, { memoryKind: 'procedural' }),
    event(2, 'tool.completed', 2001, { toolName: 'memory_remember' }),
  ];
  const station = deriveOfficePresence(employees, events, 2100).stations.archive!;
  assert.equal(station.kind, 'memory.saved');
  assert.equal(station.memoryKind, 'procedural');
  assert.equal(station.active, true);
  assert.equal(
    deriveOfficePresence(employees, [event(1, 'memory.proposed', 2000)], 2100).stations.archive?.kind,
    'memory.proposed',
  );
});

test('handoffs remain queued until recorded delivery and acknowledgment, including late-recorded events', () => {
  const destination = { messageId: 'letter-1', targetEmployeeId: employees[1].id };
  const events = [
    event(1, 'message.queued', 1000, destination),
    event(2, 'message.delivered', 2000, { ...destination, recordedAt: new Date(5000).toISOString() }),
    event(3, 'message.acknowledged', 6000, destination),
  ];
  assert.equal(deriveOfficePresence(employees, events, 4000).handoffs[0].status, 'queued');
  const delivered = deriveOfficePresence(employees, events, 5000).handoffs[0];
  assert.equal(delivered.status, 'delivered');
  assert.equal(delivered.occurredAtMs, 5000);
  assert.equal(deriveOfficePresence(employees, events, 6500).handoffs[0].status, 'acknowledged');
});

test('failed operations raise a help cue without a completed reaction', () => {
  const scene = deriveOfficePresence(
    employees,
    [event(1, 'tool.failed', 1000, { toolName: 'artifact_write' })],
    2000,
  );
  assert.equal(scene.employees[employees[0].id].cue, 'error');
  assert.notEqual(scene.employees[employees[0].id].status, 'completed');
});
