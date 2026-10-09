import test from 'node:test';
import assert from 'node:assert/strict';
import { relationOccurrencePairs, entityOrigins, layoutWarningText } from './src/relation-view.js';
import { layoutPapers } from './src/paper-layout.js';

const occurrence = (entity, paper) => ({ id: `${paper}::${entity}`, entity_id: entity, paper_id: paper });
const pairIds = pairs => pairs.map(pair => pair.map(node => node.id));

test('cross-paper lineage follows the supporting paper, independent of selected paper order', () => {
  const entities = [{ id: 'paper-origin', kind: 'paper', paper_ids: ['origin'] }];
  const relations = [{ source: 'paper-origin', target: 'method', type: 'presents' }];
  const origins = entityOrigins(entities, relations);
  const evidence = new Map([['proof', { paper_id: 'origin' }]]);
  const relation = { source: 'method', target: 'prior', source_ids: ['proof'] };
  const shared = [occurrence('method', 'consumer'), occurrence('method', 'origin')];
  const view = new Map([['method', shared], ['prior', [occurrence('prior', 'prior-paper')]]]);
  const expected = [['origin::method', 'prior-paper::prior']];
  assert.deepEqual(pairIds(relationOccurrencePairs(relation, view, { evidence, origins })), expected);
  view.set('method', [...shared].reverse());
  assert.deepEqual(pairIds(relationOccurrencePairs(relation, view, { evidence, origins })), expected);
});

test('shared identities remain connected when the source paper is hidden, and no unsupported owner is selected', () => {
  const relation = { source: 'shared', target: 'prior', source_ids: [] };
  const view = new Map([['shared', [occurrence('shared', 'b'), occurrence('shared', 'a')]], ['prior', [occurrence('prior', 'c')]]]);
  const pairs = pairIds(relationOccurrencePairs(relation, view));
  assert.deepEqual(pairs, [['a::shared', 'c::prior'], ['b::shared', 'c::prior']]);
  view.delete('prior');
  assert.deepEqual(relationOccurrencePairs(relation, view), []);
});

test('local occurrences keep local method edges without unnecessary cross-paper duplicates', () => {
  const relation = { source: 'module', target: 'method', source_ids: ['proof'] };
  const view = new Map([['module', [occurrence('module', 'consumer')]],
    ['method', [occurrence('method', 'origin'), occurrence('method', 'consumer')]]]);
  assert.deepEqual(pairIds(relationOccurrencePairs(relation, view, { evidence: new Map([['proof', { paper_id: 'origin' }]]) })), [['consumer::module', 'consumer::method']]);
});

test('cross-branch sequence is not falsely reported as a cycle', () => {
  assert.equal(layoutWarningText([{ type: 'sequence-between-branches' }]), '1 处跨分支顺序保留箭头');
  assert.match(layoutWarningText([{ type: 'multiple-containment' }, { type: 'sequence-cycle' }]), /1 处包含或顺序循环待核对；1 处多重归属/);
});

test('evaluation edges do not make a benchmark an ancestor in the paper layer', () => {
  const papers = ['later', 'base', 'benchmark'].map(paper_id => ({ paper_id }));
  const source = { source: 'paper-later', target: 'paper-base', type: 'reports_post_training_of' };
  const evaluation = { source: 'paper-later', target: 'paper-benchmark', type: 'evaluates_on' };
  const positions = layoutPapers(papers, [source, evaluation]);
  assert.equal(positions.get('base').depth, positions.get('later').depth + 1);
  assert.equal(positions.get('benchmark').depth, 0);
  assert.deepEqual(positions, layoutPapers([...papers].reverse(), [evaluation, source]));
});

test('paper citation cycles stay finite and side relations do not invent a tree', () => {
  const papers = ['a', 'b', 'c'].map(paper_id => ({ paper_id }));
  const edges = [{ source: 'paper-a', target: 'paper-b', type: 'cites' },
    { source: 'paper-b', target: 'paper-a', type: 'cites' },
    { source: 'paper-b', target: 'paper-c', type: 'compares_with' }];
  const positions = layoutPapers(papers, edges);
  assert.equal(positions.size, 3);
  assert.equal(positions.get('a').depth, positions.get('b').depth);
  assert.equal(positions.get('c').depth, 0);
  assert.equal(new Set([...positions.values()].map(point => `${point.x},${point.z}`)).size, 3);
});
