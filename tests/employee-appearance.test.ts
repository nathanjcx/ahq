import assert from 'node:assert/strict';
import test from 'node:test';
import { AppearanceSchema, EmployeeSchema } from '../shared/schemas';
import { randomEmployeeAppearance } from '../src/lib/employeeAppearance';

test('random avatars stay compatible with stored employee and renderer appearance fields', () => {
  for (const value of [0, 0.2, 0.4, 0.6, 0.8, 0.999999]) {
    const result = randomEmployeeAppearance(() => value);
    assert.deepEqual(AppearanceSchema.parse(result.appearance), result.appearance);
    const employee = EmployeeSchema.parse({
      ...result,
      id: 'new-employee',
      name: 'Alex',
      jobTitle: 'Researcher',
      personality: 'Curious and clear.',
      skills: 'Astra session',
      status: 'ready',
      activity: 'Ready for a first assignment.',
      location: 'desk',
    });
    assert.deepEqual(employee.appearance, result.appearance);
    assert.match(result.color, /^#[0-9a-f]{6}$/);
    assert.ok(result.avatar >= 0 && result.avatar < 7);
  }
});

test('creation can produce different hats, clothing, hair and body choices without role or name bias', () => {
  const variants = [0, 0.4, 0.8].map((value) => randomEmployeeAppearance(() => value));
  for (const field of ['hat', 'hairstyle', 'gender', 'clothing', 'hair', 'skin'] as const) {
    assert.equal(new Set(variants.map(({ appearance }) => appearance[field])).size, 3, field);
  }
  assert.equal(new Set(variants.map(({ appearance }) => appearance.glasses)).size, 2);
  const copy = structuredClone(variants[0]);
  variants[1].appearance.hat = 'none';
  assert.deepEqual(variants[0], copy);
});
