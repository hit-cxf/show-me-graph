import assert from 'node:assert/strict';
import test from 'node:test';
import { layoutTechnical, technicalRelationRole } from './src/technical-layout.js';

const node = (id, extra = {}) => ({ id, label: id, kind: 'method', paper_ids: ['paper'], ...extra });
const edge = (source, target, type = 'has_component') => ({ id: `${source}-${target}-${type}`, source, target, type });
function noOverlaps(result, diameter = 160) {
  const points = [...result.positions];
  for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
    const [a, p] = points[i], [b, q] = points[j];
    assert.ok(Math.hypot(p.x - q.x, p.y - q.y) >= diameter, `${a} overlaps ${b}`);
  }
}
function depthBandsHaveBlankRows(result, nodeHeight = 160) {
  for (let i = 0; i < result.depthBands.length; i++) {
    const band = result.depthBands[i];
    const points = [...result.positions.values()].filter(point => point.depth === band.depth);
    assert.equal(band.rowCount, new Set(points.map(point => point.y)).size);
    assert.equal(band.minY, Math.min(...points.map(point => point.y)) - nodeHeight / 2);
    assert.equal(band.maxY, Math.max(...points.map(point => point.y)) + nodeHeight / 2);
    for (const point of points) {
      assert.ok(point.y - nodeHeight / 2 >= band.minY);
      assert.ok(point.y + nodeHeight / 2 <= band.maxY);
    }
    if (i) {
      const blankHeight = result.depthBands[i - 1].minY - band.maxY;
      assert.ok(blankHeight >= nodeHeight, `depth ${band.depth} has only ${blankHeight}px of blank space`);
    }
  }
}
function centered(parent, children) {
  assert.ok(Math.abs(parent.x - (children[0].x + children.at(-1).x) / 2) < 1e-8);
}
test('containment, dependencies and reasoning retain distinct meanings independent of input order', () => {
  const nodes = ['system', 'vae', 'dit', 'loss', 'gating', 'finding'].map(id => node(id, { kind: id === 'system' ? 'system' : 'method' }));
  const edges = [edge('system', 'vae'), edge('system', 'dit'), edge('vae', 'loss', 'uses'), edge('dit', 'gating', 'uses'), edge('gating', 'finding', 'reports')];
  const graph = layoutTechnical(nodes, edges, { paperId: 'paper' });
  assert.deepEqual(graph.roots, ['system']);
  assert.equal(graph.positions.get('finding').depth, 2);
  assert.equal(graph.positions.get('finding').y, graph.positions.get('gating').y);
  assert.equal(graph.positions.get('finding').placementRole, 'rationale');
  assert.equal(graph.positions.get('finding').structuralParentId, null);
  assert.equal(graph.positions.get('gating').placementRole, 'dependency');
  assert.equal(graph.positions.get('gating').structuralParentId, null);
  assert.equal(graph.positions.get('gating').parentRelationId, 'dit-gating-uses');
  assert.equal(graph.positions.get('finding').parentId, 'gating');
  centered(graph.positions.get('system'), [graph.positions.get('vae'), graph.positions.get('dit')]);
  assert.equal(graph.positions.get('vae').depth, graph.positions.get('dit').depth);
  assert.notEqual(graph.positions.get('vae').y, graph.positions.get('dit').y);
  assert.equal(graph.treeRelationIds.size, 2);
  assert.equal(graph.relationRoles.get('gating-finding-reports'), 'rationale');
  assert.deepEqual(graph, layoutTechnical([...nodes].reverse(), [...edges].reverse(), { paperId: 'paper' }));
  noOverlaps(graph);
  depthBandsHaveBlankRows(graph);
});
test('cycles, multiple parents and unrelated nodes preserve a finite forest', () => {
  const nodes = ['system', 'a', 'b', 'c', 'isolated'].map(id => node(id, { kind: id === 'system' ? 'system' : 'method' }));
  nodes.push(node('external', { paper_ids: ['other'] }));
  const edges = [edge('system', 'a'), edge('a', 'b'), edge('b', 'a'), edge('system', 'b', 'uses'), edge('b', 'system'), edge('b', 'c', 'related_to'), edge('a', 'external')];
  const graph = layoutTechnical(nodes, edges, { paperId: 'paper' });
  assert.equal(graph.positions.size, 5);
  assert.deepEqual(graph.roots, ['system', 'c', 'isolated']);
  assert.equal(graph.treeRelationIds.size, 2);
  assert.equal(graph.positions.get('b').parentId, 'a');
  assert.equal(graph.positions.get('system').parentId, null);
  assert.ok(!graph.treeRelationIds.has('b-c-related_to'));
  noOverlaps(graph);
  depthBandsHaveBlankRows(graph);
});
test('six uneven stages share a logical band and preserve semantic sequence and ancestry', () => {
  // Reverse IDs ensure the order really comes from precedes, not alphabetic IDs.
  const stages = ['z', 'y', 'x', 'w', 'v', 'u'];
  const nodes = [node('curriculum', { kind: 'system' }), ...stages.map(id => node(id))];
  const edges = stages.map(id => edge('curriculum', id, 'has_stage'));
  stages.slice(1).forEach((id, i) => edges.push(edge(stages[i], id, 'precedes')));
  for (let i = 0; i < 8; i++) {
    nodes.push(node(`filter-${i}`)); edges.push(edge('z', `filter-${i}`, 'uses'));
  }
  nodes.push(node('last-child')); edges.push(edge('u', 'last-child'));
  const graph = layoutTechnical(nodes, edges);
  assert.equal(new Set(stages.map(id => graph.positions.get(id).depth)).size, 1);
  assert.equal(new Set(stages.map(id => graph.positions.get(id).y)).size, 1);
  assert.deepEqual(stages.map(id => graph.positions.get(id).bandRow), [0, 0, 0, 0, 0, 0]);
  assert.deepEqual(graph.sequenceGroups[0].nodeIds, stages);
  assert.equal(graph.sequenceGroups[0].cyclic, false);
  for (let i = 1; i < stages.length; i++) assert.ok(graph.positions.get(stages[i - 1]).x < graph.positions.get(stages[i]).x);
  for (const id of stages) assert.equal(graph.positions.get(id).parentId, 'curriculum');
  assert.equal(graph.treeRelationIds.size, 7);
  assert.ok(!graph.treeRelationIds.has('z-y-precedes'));
  assert.equal(graph.treeRoutes.size, 0, 'no orthogonal routes should be emitted');
  noOverlaps(graph);
  depthBandsHaveBlankRows(graph);
  assert.deepEqual(graph, layoutTechnical([...nodes].reverse(), [...edges].reverse()));
});
test('an automatically preferred system does not detach the busiest component from its parent', () => {
  const nodes = ['root', 'component', 'a', 'b', 'c'].map(id => node(id,
    { kind: id === 'root' || id === 'component' ? 'system' : 'method' }));
  const edges = [edge('root', 'component'), ...['a', 'b', 'c'].map(id => edge('component', id))];
  const graph = layoutTechnical(nodes, edges);
  assert.deepEqual(graph.roots, ['root']);
  assert.equal(graph.positions.get('component').parentId, 'root');
  noOverlaps(graph);
  depthBandsHaveBlankRows(graph);
});
test('broad families stagger within a band to reduce width without changing logical depth', () => {
  const nodes = [node('root', { kind: 'system' }), ...Array.from({ length: 40 }, (_, i) => node(`child-${String(i).padStart(2, '0')}`))];
  const edges = nodes.slice(1).map(item => edge('root', item.id));
  const graph = layoutTechnical(nodes, edges, { rootId: 'root' });
  const baseline = layoutTechnical(nodes, edges, { rootId: 'root', stagger: false });
  assert.equal(new Set(nodes.slice(1).map(item => graph.positions.get(item.id).y)).size, 2);
  assert.equal(new Set(nodes.slice(1).map(item => baseline.positions.get(item.id).y)).size, 1);
  for (const item of nodes.slice(1)) { assert.equal(graph.positions.get(item.id).parentId, 'root'); assert.equal(graph.positions.get(item.id).depth, 1); }
  assert.ok(graph.width < baseline.width * 0.65, `${graph.width} is not substantially narrower than ${baseline.width}`);
  assert.equal(graph.depthBands[0].rowCount, 1, 'the singleton root must not reserve a second row');
  assert.deepEqual(graph.roots, baseline.roots);
  assert.deepEqual(graph.treeRelationIds, baseline.treeRelationIds);
  centered(graph.positions.get('root'), nodes.slice(1).map(item => graph.positions.get(item.id)));
  noOverlaps(graph);
  depthBandsHaveBlankRows(graph);
  depthBandsHaveBlankRows(baseline);
});
test('contour packing uses narrow stems without overlapping asymmetric branches', () => {
  const nodes = [node('root', { kind: 'system' })], edges = [];
  for (let i = 0; i < 8; i++) {
    const id = `branch-${i}`; nodes.push(node(id)); edges.push(edge('root', id));
    for (let j = 0; j <= i % 4; j++) {
      const leaf = `${id}-leaf-${j}`; nodes.push(node(leaf)); edges.push(edge(id, leaf));
      if (j % 2 === 0) { nodes.push(node(`${leaf}-detail`)); edges.push(edge(leaf, `${leaf}-detail`)); }
    }
  }
  const graph = layoutTechnical(nodes, edges);
  noOverlaps(graph);
  depthBandsHaveBlankRows(graph);
  for (const id of nodes.map(item => item.id)) {
    const children = [...graph.positions.values()].filter(point => point.parentId === id);
    if (children.length) centered(graph.positions.get(id), children);
  }
  assert.deepEqual(graph, layoutTechnical([...nodes].reverse(), [...edges].reverse()));
});
test('filtered subsets and cyclic sequence remain stable without losing nodes', () => {
  const edges = [edge('absent-parent', 'leaf-a'), edge('leaf-a', 'leaf-b', 'precedes'), edge('leaf-b', 'leaf-a', 'precedes')];
  const nodes = [node('leaf-a'), node('leaf-b')];
  const graph = layoutTechnical(nodes, edges);
  assert.deepEqual(graph.roots, ['leaf-a', 'leaf-b']);
  assert.equal(graph.positions.size, 2);
  assert.equal(graph.treeRelationIds.size, 0);
  assert.equal(graph.sequenceGroups[0].cyclic, true);
  assert.ok(graph.warnings.some(warning => warning.type === 'sequence-cycle'));
  assert.equal(layoutTechnical([], []).width, 0);
  assert.deepEqual(layoutTechnical([], []).depthBands, []);
  assert.deepEqual(graph, layoutTechnical([...nodes].reverse(), [...edges].reverse()));
  noOverlaps(graph);
  depthBandsHaveBlankRows(graph);
});
test('band gaps use node outer edges and custom dimensions, even after a two-row depth', () => {
  const nodes = [node('root', { kind: 'system' }), node('a'), node('b'), node('aa'), node('bb')];
  const edges = [edge('root', 'a'), edge('root', 'b'), edge('a', 'aa'), edge('b', 'bb')];
  const graph = layoutTechnical(nodes, edges, { nodeWidth: 210, nodeHeight: 210, levelGap: 240 });
  assert.deepEqual(graph.depthBands.map(band => band.rowCount), [1, 2, 2]);
  assert.equal(graph.depthBands[1].minY - graph.depthBands[2].maxY, 210);
  noOverlaps(graph, 210);
  depthBandsHaveBlankRows(graph, 210);
});

test('shared stage filters keep every dependency without claiming exclusive ownership', () => {
  const nodes = ['course', 'early', 'quality', 'hires', 'resolution', 'broken', 'compression'].map(id => node(id));
  const edges = [edge('course', 'early', 'has_stage'), edge('course', 'quality', 'has_stage'), edge('course', 'hires', 'has_stage'),
    edge('early', 'quality', 'precedes'), edge('quality', 'hires', 'precedes'),
    edge('early', 'resolution', 'uses'), edge('quality', 'resolution', 'uses'), edge('hires', 'resolution', 'uses'),
    edge('early', 'broken', 'uses'), edge('quality', 'compression', 'uses')];
  const graph = layoutTechnical(nodes, edges);
  assert.equal(graph.positions.size, nodes.length);
  assert.equal(graph.positions.get('resolution').placementRole, 'shared_dependency');
  assert.equal(graph.positions.get('resolution').structuralParentId, null);
  assert.equal(graph.positions.get('resolution').depth, 2);
  for (const id of ['early', 'quality', 'hires']) {
    assert.equal(graph.positions.get(id).structuralParentId, 'course');
    assert.equal(graph.relationRoles.get(`${id}-resolution-uses`), 'dependency');
    assert.ok(!graph.treeRelationIds.has(`${id}-resolution-uses`));
  }
  assert.equal(graph.positions.get('broken').parentId, 'early');
  assert.equal(graph.positions.get('compression').parentId, 'quality');
  noOverlaps(graph); depthBandsHaveBlankRows(graph);
});
test('SwiGLU motivation is alongside the chosen operator rather than a false component', () => {
  const nodes = ['model', 'backbone', 'mlp', 'swiglu', 'saturation'].map(id => node(id));
  const edges = [edge('model', 'backbone'), edge('backbone', 'mlp'), edge('mlp', 'swiglu', 'uses'), edge('swiglu', 'saturation', 'mitigates'), edge('backbone', 'saturation', 'reports')];
  const graph = layoutTechnical(nodes, edges);
  assert.equal(graph.positions.get('swiglu').parentId, 'mlp');
  assert.equal(graph.positions.get('swiglu').placementRole, 'dependency');
  assert.equal(graph.positions.get('saturation').placementRole, 'rationale');
  assert.equal(graph.positions.get('saturation').parentId, 'swiglu');
  assert.equal(graph.positions.get('saturation').structuralParentId, null);
  assert.equal(graph.positions.get('saturation').y, graph.positions.get('swiglu').y);
  assert.equal(graph.positions.get('saturation').depth, graph.positions.get('swiglu').depth);
  assert.equal(graph.relationRoles.get('swiglu-saturation-mitigates'), 'rationale');
  assert.equal(graph.treeRelationIds.size, 2);
  noOverlaps(graph); depthBandsHaveBlankRows(graph);
});
test('a cross-branch sequence stays an explicit constraint without inventing common ownership', () => {
  const nodes = ['root', 'left', 'right', 'a', 'b'].map(id => node(id));
  const edges = [edge('root', 'left'), edge('root', 'right'), edge('left', 'a'), edge('right', 'b'), edge('a', 'b', 'precedes')];
  const graph = layoutTechnical(nodes, edges);
  assert.equal(graph.positions.get('a').structuralParentId, 'left');
  assert.equal(graph.positions.get('b').structuralParentId, 'right');
  assert.equal(graph.sequenceGroups.length, 0);
  assert.ok(graph.warnings.some(warning => warning.type === 'sequence-between-branches'));
  assert.equal(technicalRelationRole('builds_on'), 'reference');
  assert.equal(technicalRelationRole('arbitrary_new_relationship'), 'association');
  noOverlaps(graph);
});

test('paper-declared methods remain independent under weak optimization or reuse links', () => {
  const nodes = ['pipeline', 'routing', 'prompt'].map(id => node(id));
  const edges = [edge('paper', 'prompt', 'presents'), edge('pipeline', 'routing'), edge('routing', 'prompt', 'uses')];
  const graph = layoutTechnical(nodes, edges, { paperEntityId: 'paper' });
  assert.equal(graph.positions.get('prompt').parentId, null);
  assert.equal(graph.positions.get('prompt').declaredEntryPoint, true);
  assert.equal(graph.relationRoles.get('routing-prompt-uses'), 'dependency');
  assert.equal(graph.positions.get('routing').structuralParentId, 'pipeline');
  const withOwnership = layoutTechnical(nodes, [...edges, edge('pipeline', 'prompt')], { paperEntityId: 'paper' });
  assert.equal(withOwnership.positions.get('prompt').structuralParentId, 'pipeline', 'explicit ownership remains authoritative');
  noOverlaps(graph);
});
test('benchmark reports retain the benchmark as their subject, while result statements sit beside the model', () => {
  const nodes = [node('benchmark', { kind: 'benchmark' }), node('model', { kind: 'system' }), node('judge'), node('finding', { kind: 'finding' })];
  const edges = [edge('benchmark', 'model', 'reports_result_for'), edge('benchmark', 'judge', 'scored_by'), edge('finding', 'model', 'reports_result_for')];
  const graph = layoutTechnical(nodes, edges);
  assert.equal(graph.positions.get('benchmark').parentId, null);
  assert.equal(graph.positions.get('model').parentId, 'benchmark');
  assert.equal(graph.positions.get('finding').parentId, 'model');
  assert.equal(graph.positions.get('finding').y, graph.positions.get('model').y);
  assert.equal(graph.positions.get('judge').parentId, 'benchmark');
  assert.equal(graph.treeRelationIds.size, 0);
  noOverlaps(graph);
});
test('qualifications and supporting evidence are placed beside their existing claim without reversing assertions', () => {
  const nodes = ['system', 'claim', 'caveat', 'evidence'].map(id => node(id));
  const edges = [edge('system', 'claim', 'reports'), edge('caveat', 'claim', 'qualifies'), edge('evidence', 'claim', 'supports')];
  const graph = layoutTechnical(nodes, edges);
  for (const id of ['caveat', 'evidence']) {
    assert.equal(graph.positions.get(id).parentId, 'claim');
    assert.equal(graph.positions.get(id).structuralParentId, null);
    assert.equal(graph.positions.get(id).y, graph.positions.get('claim').y);
  }
  assert.deepEqual(edges.slice(1).map(e => [e.source, e.target]), [['caveat', 'claim'], ['evidence', 'claim']]);
  noOverlaps(graph);
});
test('notation, mathematical concepts and local lineage are connected without invented ownership', () => {
  const nodes = ['method', 'notation', 'quantity', 'refinement'].map(id => node(id));
  const edges = [edge('method', 'notation', 'uses_notation'), edge('method', 'quantity', 'models'), edge('refinement', 'method', 'refines')];
  const graph = layoutTechnical(nodes, edges, { entryPointIds: ['method'] });
  assert.deepEqual(graph.roots, ['method']);
  assert.equal(graph.positions.get('notation').placementRole, 'dependency');
  assert.equal(graph.positions.get('quantity').placementRole, 'rationale');
  assert.equal(graph.positions.get('refinement').placementRole, 'reference');
  assert.equal(graph.positions.get('refinement').structuralParentId, null);
  assert.equal(graph.positions.get('refinement').y, graph.positions.get('method').y);
  assert.equal(graph.treeRelationIds.size, 0);
  noOverlaps(graph);
});
test('cycle diagnostics distinguish real directed cycles, repeated assertions, multiple parents and root overrides', () => {
  const nodes = ['a', 'b', 'c', 'self'].map(id => node(id));
  const edges = [edge('a', 'b'), {...edge('a', 'b'), id:'repeat'}, edge('c', 'b'), edge('self', 'self')];
  const graph = layoutTechnical(nodes, edges, { rootId: 'b' });
  assert.deepEqual(graph.diagnostics.containmentCycles.map(c => c.nodeIds), [['self']]);
  assert.deepEqual(graph.warnings.filter(w => w.type === 'multiple-containment').map(w => w.parentIds), [['a', 'c']]);
  assert.equal(graph.warnings.filter(w => w.type === 'containment-cycle').length, 1);
  assert.deepEqual(graph.positions.get('b').containmentParentIds, ['a', 'c']);
  const cyclic = layoutTechnical(nodes, [edge('a', 'b'), edge('b', 'c'), edge('c', 'a')]);
  assert.deepEqual(cyclic.diagnostics.containmentCycles[0].nodeIds, ['a', 'b', 'c']);
  noOverlaps(graph); noOverlaps(cyclic);
});
test('sequence cycles spanning separate branches are still diagnosed and feedback is not mistaken for precedence', () => {
  const nodes = ['root', 'left', 'right', 'a', 'b'].map(id => node(id));
  const edges = [edge('root', 'left'), edge('root', 'right'), edge('left', 'a'), edge('right', 'b'), edge('a', 'b', 'precedes'), edge('b', 'a', 'precedes')];
  const graph = layoutTechnical(nodes, edges);
  assert.deepEqual(graph.diagnostics.sequenceCycles[0].nodeIds, ['a', 'b']);
  assert.equal(graph.warnings.filter(w => w.type === 'sequence-cycle').length, 1);
  assert.equal(graph.warnings.filter(w => w.type === 'sequence-between-branches').length, 2);
  const feedback = layoutTechnical(nodes, [...edges.slice(0, -1), edge('b', 'a', 'feeds_back')]);
  assert.equal(feedback.diagnostics.sequenceCycles.length, 0);
  assert.equal(feedback.relationRoles.get('b-a-feeds_back'), 'feedback');
  noOverlaps(graph);
});
test('a shared configuration exposes its consumers even while retaining genuine containment', () => {
  const nodes = ['course', 'early', 'late', 'config'].map(id => node(id));
  const graph = layoutTechnical(nodes, [edge('course', 'early', 'has_stage'), edge('course', 'late', 'has_stage'), edge('course', 'config', 'has_configuration'), edge('early', 'config', 'configured_by'), edge('late', 'config', 'configured_by')]);
  const config = graph.positions.get('config');
  assert.equal(config.structuralParentId, 'course');
  assert.equal(config.sharedDependency, true);
  assert.deepEqual(config.dependencySourceIds, ['early', 'late']);
  assert.equal(graph.warnings.length, 0);
  noOverlaps(graph);
});

test('conditional routing and optimization or data dependencies do not become ownership or sequence', () => {
  const nodes = ['router', 'policy', 'data-route', 'optimizer', 'loss', 'data', 'reward'].map(id => node(id));
  const edges = [edge('router', 'policy', 'routes_to'), edge('router', 'data-route', 'routes_to'),
    edge('optimizer', 'loss', 'optimized_with'), edge('data-route', 'data', 'uses_data_from'),
    edge('policy', 'reward', 'adjusts_reward_policy_for'), edge('loss', 'reward', 'shares_evaluation_dimension')];
  const graph = layoutTechnical(nodes, edges);
  assert.equal(graph.positions.get('policy').parentId, 'router');
  assert.equal(graph.positions.get('data-route').parentId, 'router');
  assert.equal(graph.positions.get('policy').depth, graph.positions.get('data-route').depth);
  assert.equal(graph.positions.get('loss').parentId, 'optimizer');
  assert.equal(graph.positions.get('data').parentId, 'data-route');
  assert.equal(graph.treeRelationIds.size, 0);
  assert.equal(graph.sequenceGroups.length, 0);
  assert.equal(graph.relationRoles.get('policy-reward-adjusts_reward_policy_for'), 'rationale');
  assert.equal(graph.relationRoles.get('loss-reward-shares_evaluation_dimension'), 'association');
  noOverlaps(graph);
});
test('result_for keeps a dated result beside its model and never demotes the model under an evaluation result', () => {
  const nodes = [node('model', {kind:'system'}), node('protocol'), node('result', {kind:'finding'})];
  const edges = [edge('model', 'protocol', 'evaluated_with'), edge('protocol', 'result', 'reports'), edge('result', 'model', 'result_for')];
  const graph = layoutTechnical(nodes, edges, {entryPointIds:['model']});
  assert.equal(graph.positions.get('model').parentId, null);
  assert.equal(graph.positions.get('result').parentId, 'model');
  assert.equal(graph.positions.get('result').y, graph.positions.get('model').y);
  assert.equal(graph.positions.get('result').parentRelationId, 'result-model-result_for');
  assert.equal(graph.positions.get('protocol').parentId, 'model');
  noOverlaps(graph);
});
