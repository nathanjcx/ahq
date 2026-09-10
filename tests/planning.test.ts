import assert from 'node:assert/strict';
import test from 'node:test';
import { generatePersonality, generateRoadmap } from '../desktop/planning';
import type { Employee } from '../shared/types';

const employee: Employee = {
  id: 'employee-1',
  name: 'River',
  jobTitle: 'Product designer',
  personality: 'Thoughtful and direct, with a habit of testing assumptions early.',
  skills: 'Astra session',
  color: '#279486',
  avatar: 1,
  status: 'ready',
  activity: 'Ready for an assignment.',
  location: 'desk',
};
const input = { goal: 'Design a simpler appointment booking experience.', employees: [employee] };
function roadmap() {
  return {
    milestones: [
      {
        key: 'research',
        title: 'Understand the booking problem',
        description: 'Produce a short brief describing the booking problem and assumptions to confirm.',
        ownerId: employee.id,
        dayOffset: 1,
        dependencies: [] as string[],
        definitionOfDone: 'The brief identifies the audience, problem, and assumptions for review.',
        nextStep: 'Draft the audience and problem statement from the goal.',
      },
      {
        key: 'design',
        title: 'Draft the booking flow',
        description: 'Produce a step-by-step booking flow with copy for each screen.',
        ownerId: employee.id,
        dayOffset: 3,
        dependencies: ['research'],
        definitionOfDone: 'Every booking step and error state is covered in the proposed flow.',
        nextStep: 'Use the approved brief to sketch the shortest booking path.',
      },
      {
        key: 'handoff',
        title: 'Review and prepare the handoff',
        description: 'Check the proposed booking flow against the brief and prepare a final handoff.',
        ownerId: employee.id,
        dayOffset: 4,
        dependencies: ['design'],
        definitionOfDone: 'The handoff contains the flow, review findings, and remaining decisions.',
        nextStep: 'Check the approved flow against the audience needs and acceptance criteria.',
      },
    ],
  };
}

test('personality uses the generator with name and job and returns its actual writing', async () => {
  const personality =
    'River explores a few clear options before choosing a direction. They share concise progress notes and ask for judgment when a decision changes the experience.';
  let calls = 0;
  const result = await generatePersonality(async (prompt, schema) => {
    calls++;
    assert.match(prompt, /Product designer/);
    assert.match(prompt, /River/);
    assert.match(prompt, /do not use tools/i);
    assert.match(prompt, /Do not infer gender/);
    assert.equal(schema.additionalProperties, false);
    assert.deepEqual(schema.required, ['personality']);
    return JSON.stringify({ personality });
  }, employee);
  assert.equal(result, personality);
  assert.equal(calls, 1);
});

test('personality requires identity, propagates provider failure, and rejects malformed output', async () => {
  let called = false;
  await assert.rejects(
    generatePersonality(
      async () => {
        called = true;
        return '';
      },
      { name: ' ', jobTitle: 'Designer' },
    ),
    /Enter a name and job/,
  );
  assert.equal(called, false);
  await assert.rejects(
    generatePersonality(async () => {
      throw new Error('Sign in first.');
    }, employee),
    /Sign in first/,
  );
  for (const raw of [
    'not JSON',
    '{}',
    '{"personality":"kind"}',
    JSON.stringify({ personality: 'x'.repeat(1201) }),
    JSON.stringify({ personality: 'x'.repeat(50), skills: 'unexpected' }),
  ]) {
    await assert.rejects(
      generatePersonality(async () => raw, employee),
      /valid personality/,
    );
  }
});

test('roadmap calls AI with roster, preserves deliverables, and maps dependency keys to new IDs', async () => {
  const modelPlan = roadmap();
  const before = Date.now();
  const result = await generateRoadmap(async (prompt, schema) => {
    assert.match(prompt, /Design a simpler appointment booking experience/);
    assert.match(prompt, /Product designer/);
    assert.match(prompt, /employee-1/);
    assert.match(prompt, /do not use tools/i);
    assert.equal(schema.additionalProperties, false);
    const properties = schema.properties as Record<string, Record<string, unknown>>;
    const items = properties.milestones.items as Record<string, unknown>;
    const fields = items.properties as Record<string, Record<string, unknown>>;
    assert.deepEqual(fields.ownerId.enum, ['', 'employee-1']);
    return JSON.stringify(modelPlan);
  }, input);
  assert.equal(result.length, 3);
  assert.equal(new Set(result.map((milestone) => milestone.id)).size, 3);
  for (const [index, milestone] of result.entries()) {
    assert.match(milestone.id, /^[\da-f-]{36}$/);
    assert.equal(milestone.title, modelPlan.milestones[index].title);
    assert.equal(milestone.definitionOfDone, modelPlan.milestones[index].definitionOfDone);
    assert.equal(milestone.ownerId, employee.id);
    assert.equal(milestone.status, 'planned');
    assert.equal(milestone.progress, 0);
    assert.equal(milestone.firm, false);
    assert.ok(Date.parse(milestone.deadline) >= before + modelPlan.milestones[index].dayOffset * 86_400_000);
  }
  assert.deepEqual(result[0].dependencies, []);
  assert.deepEqual(result[1].dependencies, [result[0].id]);
  assert.deepEqual(result[2].dependencies, [result[1].id]);
  const second = await generateRoadmap(async () => JSON.stringify(modelPlan), input);
  assert.notEqual(second[0].id, result[0].id);
});

test('empty office gets a full unassigned roadmap and cannot invent an employee', async () => {
  const modelPlan = roadmap();
  modelPlan.milestones.forEach((milestone) => {
    milestone.ownerId = '';
  });
  const empty = { ...input, employees: [] };
  const result = await generateRoadmap(async (_prompt, schema) => {
    const properties = schema.properties as Record<string, Record<string, unknown>>;
    const items = properties.milestones.items as Record<string, unknown>;
    const fields = items.properties as Record<string, Record<string, unknown>>;
    assert.deepEqual(fields.ownerId.enum, ['']);
    return JSON.stringify(modelPlan);
  }, empty);
  assert.equal(result.length, 3);
  assert.ok(result.every((milestone) => milestone.ownerId === ''));
  modelPlan.milestones[0].ownerId = 'imaginary-employee';
  await assert.rejects(
    generateRoadmap(async () => JSON.stringify(modelPlan), empty),
    /unknown employee/,
  );
});

test('roadmap rejects invalid graph edges, cycles, duplicates, and impossible dependency timing', async () => {
  const cases: Array<[(plan: ReturnType<typeof roadmap>) => void, RegExp]> = [
    [
      (plan) => {
        plan.milestones[0].key = 'design';
      },
      /repeated a milestone/,
    ],
    [
      (plan) => {
        plan.milestones[1].dependencies = ['missing'];
      },
      /missing milestone/,
    ],
    [
      (plan) => {
        plan.milestones[1].dependencies = ['research', 'research'];
      },
      /repeated a dependency/,
    ],
    [
      (plan) => {
        plan.milestones[0].dependencies = ['research'];
      },
      /circular dependencies/,
    ],
    [
      (plan) => {
        plan.milestones.forEach((milestone) => {
          milestone.dayOffset = 5;
        });
        plan.milestones[0].dependencies = ['handoff'];
      },
      /circular dependencies/,
    ],
    [
      (plan) => {
        plan.milestones[0].dayOffset = 5;
      },
      /before its prerequisites/,
    ],
    [
      (plan) => {
        plan.milestones[0].ownerId = 'outsider';
      },
      /unknown employee/,
    ],
  ];
  for (const [alter, expected] of cases) {
    const modelPlan = roadmap();
    alter(modelPlan);
    await assert.rejects(
      generateRoadmap(async () => JSON.stringify(modelPlan), input),
      expected,
    );
  }
});

test('roadmap bounds generated content and requires complete structured milestones', async () => {
  const two = roadmap();
  two.milestones.pop();
  const extra = { ...roadmap(), inventedEmployees: ['someone'] };
  const incomplete = roadmap();
  incomplete.milestones[0].definitionOfDone = '';
  const long = roadmap();
  long.milestones[0].description = 'x'.repeat(2001);
  for (const raw of [
    '```json\n{}\n```',
    '{}',
    JSON.stringify(two),
    JSON.stringify(extra),
    JSON.stringify(incomplete),
    JSON.stringify(long),
    'x'.repeat(128_001),
  ]) {
    await assert.rejects(
      generateRoadmap(async () => raw, input),
      /roadmap/,
    );
  }
  let called = false;
  await assert.rejects(
    generateRoadmap(
      async () => {
        called = true;
        return '';
      },
      { ...input, goal: ' ' },
    ),
    /Enter a goal/,
  );
  assert.equal(called, false);
  await assert.rejects(
    generateRoadmap(async () => '{}', { ...input, employees: [employee, employee] }),
    /duplicate IDs/,
  );
});
