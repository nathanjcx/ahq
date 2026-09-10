import assert from 'node:assert/strict';
import test from 'node:test';
import type { Commitment } from '../shared/types';
import { dependencyCandidates, validateDependencies } from '../src/lib/roadmap';

function milestone(id: string, dependencies: string[] = []): Commitment {
  return {
    id,
    title: id,
    description: '',
    ownerId: '',
    recipient: '',
    deadline: '',
    firm: false,
    status: 'planned',
    progress: 0,
    nextStep: '',
    dependencies,
    source: '',
    definitionOfDone: '',
  };
}
const ids = (items: Commitment[]) => items.map((item) => item.id);

test('editing excludes the milestone and every downstream branch while preserving valid dependencies', () => {
  const items = [
    milestone('research'),
    milestone('draft', ['research']),
    milestone('design', ['draft']),
    milestone('review', ['draft']),
    milestone('launch', ['design', 'review']),
    milestone('budget'),
  ];
  const before = JSON.stringify(items);
  assert.deepEqual(ids(dependencyCandidates(items, 'draft')), ['research', 'budget']);
  assert.equal(validateDependencies(items, 'draft', ['research', 'budget']), true);
  assert.equal(validateDependencies(items, 'draft', ['launch']), false);
  assert.equal(JSON.stringify(items), before);
});

test('saving rejects missing references, duplicate selections, self references, and cycles', () => {
  const items = [milestone('a'), milestone('b', ['a']), milestone('c', ['b'])];
  assert.equal(validateDependencies(items, 'a', ['missing']), false);
  assert.equal(validateDependencies(items, 'c', ['a', 'a']), false);
  assert.equal(validateDependencies(items, 'a', ['a']), false);
  assert.equal(validateDependencies(items, 'a', ['b']), false);
  assert.equal(validateDependencies(items, 'a', ['c']), false);
  assert.equal(validateDependencies(items, 'c', []), true);
  assert.equal(validateDependencies(items, '', []), false);
});

test('new milestones can use existing work but cannot close a cycle through a previously missing reference', () => {
  const items = [milestone('research'), milestone('launch', ['new-milestone'])];
  assert.equal(validateDependencies(items, 'new-milestone', ['research']), true);
  assert.equal(validateDependencies(items, 'new-milestone', ['launch']), false);
  assert.deepEqual(ids(dependencyCandidates(items, 'new-milestone')), ['research']);
  assert.deepEqual(dependencyCandidates([]), []);
  assert.equal(validateDependencies([], 'first', []), true);
});

test('existing cycles and dangling references terminate without hiding unrelated work', () => {
  const items = [
    milestone('a', ['b']),
    milestone('b', ['a']),
    milestone('after-cycle', ['b']),
    milestone('independent', ['missing']),
  ];
  assert.deepEqual(ids(dependencyCandidates(items, 'a')), ['independent']);
  assert.equal(validateDependencies(items, 'a', ['after-cycle']), false);
  // A separate imported cycle does not create a path back to a new milestone.
  assert.equal(validateDependencies(items, 'new', ['a', 'independent']), true);
});

test('duplicate records appear once and all their edges participate in cycle checks', () => {
  const first = milestone('a');
  const items = [first, milestone('b'), milestone('a', ['b']), milestone('c', ['a'])];
  const candidates = dependencyCandidates(items);
  assert.deepEqual(ids(candidates), ['a', 'b', 'c']);
  assert.equal(candidates[0], first);
  assert.deepEqual(dependencyCandidates(items, 'b'), []);
  assert.equal(validateDependencies(items, 'b', ['c']), false);
});

test('long dependency chains are traversed without recursion', () => {
  const items = Array.from({ length: 1000 }, (_, index) =>
    milestone(String(index), index ? [String(index - 1)] : []),
  );
  assert.deepEqual(dependencyCandidates(items, '0'), []);
  assert.equal(validateDependencies(items, '0', ['999']), false);
  assert.equal(validateDependencies(items, '999', ['0']), true);
});
