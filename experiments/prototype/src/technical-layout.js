// Containment, dependency and reasoning are different assertions. Only genuine
// containment edges form the ownership tree; other edges may supply a clearly
// labelled placement anchor without changing what the graph claims.
const CONTAINMENT = new Set(['has_component', 'includes', 'contains', 'composed_of', 'has_stage', 'has_configuration']);
const DEPENDENCY = new Set(['routes_to', 'optimized_with', 'uses_data_from', 'configured_by', 'uses', 'adopts', 'implements', 'trained_with', 'trained_on', 'evaluated_by', 'evaluated_with', 'evaluated_on', 'evaluates_on', 'scored_by', 'produces', 'uses_notation', 'samples_from', 'trained_on_samples_from']);
const RATIONALE = new Set(['result_for', 'adjusts_reward_policy_for', 'has_capability', 'mitigates', 'supports', 'qualifies', 'reports', 'discusses', 'has_limitation', 'has_uncertainty', 'reports_result_for', 'models', 'optimizes', 'modulates']);
const REFERENCE = new Set(['intermediate_variant_of', 'initialized_from', 'formulation_of', 'instance_of', 'cites', 'builds_on', 'adapts', 'refines', 'post_trained_from', 'presents', 'proposes', 'reports_post_training_of', 'retrospectively_describes_component_of', 'describes_intermediate_variant']);
const CATEGORIES = ['architecture', 'data', 'training', 'evaluation'];
const textCompare = (a, b) => a === b ? 0 : a < b ? -1 : 1;
const endpoint = value => typeof value === 'string' ? value : value?.entity_id || value?.id;

export function technicalRelationRole(type) {
  if (CONTAINMENT.has(type)) return 'containment';
  if (DEPENDENCY.has(type)) return 'dependency';
  if (RATIONALE.has(type)) return 'rationale';
  if (type === 'precedes') return 'sequence';
  if (type === 'feeds_back') return 'feedback';
  if (REFERENCE.has(type)) return 'reference';
  return 'association';
}

/**
 * A deterministic semantic layout. Ownership establishes depth first. Unowned
 * dependencies are placed below a consumer, explicitly distinct from ownership;
 * explanations sit beside their subject. All original edges remain renderable.
 * Sequence constraints order peer nodes along one baseline. Only ordinary rows
 * stagger; successive logical depths retain one empty node-height of space.
 */
export function layoutTechnical(entities, relations, {
  paperId, paperEntityId, entryPointIds = [], rootId, nodeWidth = 160, nodeHeight = 160,
  siblingGap = 40, levelGap = 240, forestGap = 120, stagger = true,
} = {}) {
  const records = new Map(entities.filter(entity => entity.kind !== 'paper'
    && (!paperId || !entity.paper_ids || entity.paper_ids.includes(paperId)))
    .map(entity => [entity.id, entity]));
  const positions = new Map(), treeRelationIds = new Set(), treeRoutes = new Map();
  const relationRoles = new Map(relations.filter(relation => relation.id)
    .sort((a, b) => textCompare(a.id, b.id)).map(relation => [relation.id, technicalRelationRole(relation.type)]));
  const warnings = [], sequenceGroups = [];
  const diagnostics = { containmentCycles: [], sequenceCycles: [], dependencyCycles: [], semanticCycles: [], sharedDependencies: [], isolatedNodeIds: [], crossPaperOnlyNodeIds: [] };
  if (!records.size) return { positions, roots: [], treeRelationIds, treeRoutes, relationRoles, sequenceGroups, warnings, diagnostics,
    depthBands: [], width: 0, height: 0, bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0 } };
  const categoryRank = id => {
    const index = CATEGORIES.indexOf(records.get(id)?.category);
    return index < 0 ? CATEGORIES.length : index;
  };
  const compare = (a, b) => categoryRank(a) - categoryRank(b)
    || textCompare(records.get(a)?.section || '', records.get(b)?.section || '') || textCompare(a, b);
  const paperSources = new Set(entities.filter(entity => entity.kind === 'paper'
    && (!paperId || entity.paper_ids?.includes(paperId))).map(entity => entity.id));
  if (paperEntityId) paperSources.add(paperEntityId);
  const declaredRoots = new Set(entryPointIds.filter(id => records.has(id)));
  for (const relation of relations) if (paperSources.has(endpoint(relation.source))
    && ['presents', 'proposes'].includes(relation.type) && records.has(endpoint(relation.target))) declaredRoots.add(endpoint(relation.target));
  const edges = relations.map(relation => ({ relation, source: endpoint(relation.source), target: endpoint(relation.target),
    role: technicalRelationRole(relation.type) }))
    .filter(edge => records.has(edge.source) && records.has(edge.target))
    .sort((a, b) => compare(a.source, b.source) || compare(a.target, b.target) || textCompare(a.relation.id || '', b.relation.id || ''));
  // Diagnose directed assertions independently of the acyclic placement scaffold.
  // A rejected scaffold edge can be a legitimate second parent or root override;
  // only a strongly connected directed component proves an actual cycle.
  function directedCycles(selected) {
    const outgoing = new Map([...records.keys()].map(id => [id, []]));
    for (const edge of selected) outgoing.get(edge.source).push(edge.target);
    const indices = new Map(), lows = new Map(), stack = [], active = new Set(), result = [];
    let cursor = 0;
    function visit(id) {
      indices.set(id, cursor); lows.set(id, cursor++); stack.push(id); active.add(id);
      for (const next of outgoing.get(id)) {
        if (!indices.has(next)) { visit(next); lows.set(id, Math.min(lows.get(id), lows.get(next))); }
        else if (active.has(next)) lows.set(id, Math.min(lows.get(id), indices.get(next)));
      }
      if (lows.get(id) !== indices.get(id)) return;
      const component = []; let member;
      do { member = stack.pop(); active.delete(member); component.push(member); } while (member !== id);
      const members = new Set(component), internal = selected.filter(edge => members.has(edge.source) && members.has(edge.target));
      if (component.length > 1 || internal.some(edge => edge.source === edge.target)) result.push({
        nodeIds: component.sort(compare), relationIds: internal.map(edge => edge.relation.id).filter(Boolean).sort(textCompare),
        selfLoop: component.length === 1,
      });
    }
    for (const id of [...records.keys()].sort(compare)) if (!indices.has(id)) visit(id);
    return result.sort((a, b) => compare(a.nodeIds[0], b.nodeIds[0]));
  }
  const containment = edges.filter(edge => edge.role === 'containment');
  diagnostics.containmentCycles = directedCycles(containment);
  diagnostics.sequenceCycles = directedCycles(edges.filter(edge => edge.role === 'sequence'));
  diagnostics.dependencyCycles = directedCycles(edges.filter(edge => edge.role === 'dependency'));
  diagnostics.semanticCycles = directedCycles(edges).map(cycle => ({ ...cycle,
    containsFeedback: edges.some(edge => cycle.relationIds.includes(edge.relation.id) && edge.role === 'feedback'),
  }));
  warnings.push(...diagnostics.containmentCycles.map(cycle => ({ type: 'containment-cycle', ...cycle })),
    ...diagnostics.sequenceCycles.map(cycle => ({ type: 'sequence-cycle', ...cycle })));
  const ownerCandidates = new Map();
  for (const edge of containment) if (edge.source !== edge.target) {
    if (!ownerCandidates.has(edge.target)) ownerCandidates.set(edge.target, new Set());
    ownerCandidates.get(edge.target).add(edge.source);
  }
  for (const [id, owners] of [...ownerCandidates].sort(([a], [b]) => compare(a, b))) if (owners.size > 1) {
    warnings.push({ type: 'multiple-containment', nodeIds: [id], parentIds: [...owners].sort(compare),
      relationIds: containment.filter(edge => edge.target === id).map(edge => edge.relation.id).filter(Boolean).sort(textCompare) });
  }
  const touched = new Set(edges.flatMap(edge => [edge.source, edge.target]));
  diagnostics.isolatedNodeIds = [...records.keys()].filter(id => !touched.has(id)).sort(compare);
  diagnostics.crossPaperOnlyNodeIds = diagnostics.isolatedNodeIds.filter(id => relations.some(relation =>
    (endpoint(relation.source) === id && !records.has(endpoint(relation.target)) && !paperSources.has(endpoint(relation.target)))
    || (endpoint(relation.target) === id && !records.has(endpoint(relation.source)) && !paperSources.has(endpoint(relation.source)))));

  const outgoing = new Map([...records.keys()].map(id => [id, 0]));
  const incoming = new Set(edges.filter(edge => edge.role === 'containment' || edge.role === 'dependency').map(edge => edge.target));
  for (const { source } of containment) outgoing.set(source, outgoing.get(source) + 1);
  const preferred = records.has(rootId) ? rootId : [...records.keys()]
    .filter(id => records.get(id).kind === 'system' && outgoing.get(id))
    .sort((a, b) => Number(incoming.has(a)) - Number(incoming.has(b))
      || outgoing.get(b) - outgoing.get(a) || compare(a, b))[0];
  const parents = new Map(), children = new Map([...records.keys()].map(id => [id, []]));
  const attachments = new Map();
  const union = new Map([...records.keys()].map(id => [id, id]));
  function representative(id) {
    let root = id;
    while (union.get(root) !== root) root = union.get(root);
    while (union.get(id) !== id) { const next = union.get(id); union.set(id, root); id = next; }
    return root;
  }
  function attach(edge, source = edge.source, target = edge.target, placementRole = edge.role) {
    if (source === target || target === preferred || parents.has(target)
      || (declaredRoots.has(target) && edge.role !== 'containment')) return false;
    const sourceTree = representative(source), targetTree = representative(target);
    if (sourceTree === targetTree) return false;
    union.set(targetTree, sourceTree);
    parents.set(target, source); children.get(source).push(target);
    attachments.set(target, { role: placementRole, relationId: edge.relation.id || null });
    if (edge.role === 'containment' && edge.relation.id) treeRelationIds.add(edge.relation.id);
    return true;
  }
  const edgeCompare = (a, b) => Number(b.source === preferred) - Number(a.source === preferred)
    || Number(a.relation.basis === 'inferred') - Number(b.relation.basis === 'inferred')
    || compare(a.source, b.source) || compare(a.target, b.target) || textCompare(a.relation.id || '', b.relation.id || '');
  // Establish actual ownership before considering any weaker placement hint.
  for (const edge of containment.sort(edgeCompare)) attach(edge);
  const dependencies = edges.filter(edge => edge.role === 'dependency');
  const consumers = new Map();
  for (const edge of dependencies) {
    if (!consumers.has(edge.target)) consumers.set(edge.target, new Set());
    consumers.get(edge.target).add(edge.source);
  }
  for (const [id, sources] of [...consumers].sort(([a], [b]) => compare(a, b))) if (sources.size > 1) diagnostics.sharedDependencies.push({ nodeId: id, sourceIds: [...sources].sort(compare) });
  for (const edge of dependencies.sort(edgeCompare)) attach(edge, edge.source, edge.target,
    consumers.get(edge.target).size > 1 ? 'shared_dependency' : 'dependency');
  // Specific reasoning (operator mitigates problem; evidence supports claim)
  // is more informative than a general module reports observation link.
  // Preserve assertion direction; reverse only the placement of evidence.
  const rationalePriority = type => ['mitigates', 'qualifies', 'supports', 'result_for', 'reports_result_for', 'adjusts_reward_policy_for', 'has_limitation', 'has_uncertainty', 'reports', 'discusses', 'has_capability', 'models', 'optimizes', 'modulates'].indexOf(type);
  for (const edge of edges.filter(edge => edge.role === 'rationale').sort((a, b) => rationalePriority(a.relation.type) - rationalePriority(b.relation.type) || edgeCompare(a, b))) {
    const resultIsStatement = ['finding', 'claim', 'result'].includes(records.get(edge.source)?.kind);
    const reverse = ['qualifies', 'supports', 'result_for', 'optimizes', 'modulates', 'adjusts_reward_policy_for'].includes(edge.relation.type)
      || (edge.relation.type === 'reports_result_for' && resultIsStatement);
    attach(edge, reverse ? edge.target : edge.source, reverse ? edge.source : edge.target, 'rationale');
  }

  // A technical lineage can give an otherwise unplaced method a nearby anchor,
  // but never turns inheritance into containment. Both directions preserve the
  // original edge and its arrow; paper-declared entry points remain independent.
  for (const edge of edges.filter(edge => edge.role === 'reference').sort(edgeCompare)) {
    if (parents.has(edge.source) || declaredRoots.has(edge.source)) attach(edge, edge.source, edge.target, 'reference');
    else if (parents.has(edge.target) || declaredRoots.has(edge.target)) attach(edge, edge.target, edge.source, 'reference');
    else attach(edge, edge.source, edge.target, 'reference');
  }

  const sequenceEdges = edges.filter(edge => edge.role === 'sequence');
  const locked = new Set();
  for (const [id, attachment] of attachments) if (attachment.role === 'rationale' || attachment.role === 'reference') {
    locked.add(id); locked.add(parents.get(id));
  }
  // Order connected sequence groups as indivisible sibling blocks. This stops
  // unrelated peers being inserted midway through a numbered training course.
  function orderSiblings(ids, parentId = null, comparator = compare) {
    const members = new Set(ids), neighbours = new Map(ids.map(id => [id, new Set()]));
    const relevant = sequenceEdges.filter(edge => members.has(edge.source) && members.has(edge.target));
    for (const { source, target } of relevant) { neighbours.get(source).add(target); neighbours.get(target).add(source); }
    const remaining = new Set(ids), blocks = [];
    while (remaining.size) {
      const first = [...remaining].sort(comparator)[0], component = [], pending = [first];
      remaining.delete(first);
      while (pending.length) {
        const id = pending.pop(); component.push(id);
        for (const next of [...neighbours.get(id)].sort(compare)) if (remaining.delete(next)) pending.push(next);
      }
      const set = new Set(component), constraints = relevant.filter(edge => set.has(edge.source));
      if (!constraints.length) { blocks.push(component); continue; }
      const following = new Map(component.map(id => [id, new Set()]));
      const indegree = new Map(component.map(id => [id, 0]));
      for (const { source, target } of constraints) if (!following.get(source).has(target)) {
        following.get(source).add(target); indegree.set(target, indegree.get(target) + 1);
      }
      const todo = new Set(component), ordered = []; let cyclic = false;
      while (todo.size) {
        let ready = [...todo].filter(id => indegree.get(id) === 0).sort(comparator);
        if (!ready.length) { cyclic = true; ready = [...todo].sort(comparator); }
        const id = ready[0]; todo.delete(id); ordered.push(id);
        for (const target of following.get(id)) indegree.set(target, indegree.get(target) - 1);
      }
      const group = { parentId, nodeIds: ordered, relationIds: constraints.map(edge => edge.relation.id).filter(Boolean).sort(textCompare), cyclic };
      sequenceGroups.push(group); ordered.forEach(id => locked.add(id));
      blocks.push(ordered);
    }
    return blocks.sort((a, b) => comparator(a[0], b[0])).flat();
  }
  for (const [id, siblings] of [...children].sort(([a], [b]) => compare(a, b))) children.set(id, orderSiblings(siblings, id));
  const roots = orderSiblings([...records.keys()].filter(id => !parents.has(id)), null,
    (a, b) => Number(b === preferred) - Number(a === preferred) || compare(a, b));
  for (const edge of sequenceEdges) if ((parents.get(edge.source) || null) !== (parents.get(edge.target) || null)) {
    warnings.push({ type: 'sequence-between-branches', relationId: edge.relation.id, nodeIds: [edge.source, edge.target] });
  }
  const depths = new Map();
  function measureDepth(id, depth) {
    depths.set(id, depth);
    for (const child of children.get(id)) measureDepth(child, depth + (['rationale', 'reference'].includes(attachments.get(child).role) ? 0 : 1));
  }
  roots.forEach(id => measureDepth(id, 0));
  const lockedDepths = new Set([...locked].map(id => depths.get(id)));
  const horizontalScale = stagger ? 0.6 : 1;
  // Rows constrained to one baseline reserve their full diameter before the
  // compacting transform. A sequence must never overlap after horizontal scale.
  const widthAt = id => lockedDepths.has(depths.get(id)) ? nodeWidth / horizontalScale : nodeWidth;
  function pack(blocks, gap, recenter = true) {
    const left = [], right = [], offsets = [];
    for (const block of blocks) {
      let offset = 0;
      if (offsets.length) {
        offset = -Infinity;
        for (let depth = 0; depth < Math.min(right.length, block.left.length); depth++) {
          if (right[depth] !== undefined && block.left[depth] !== undefined) offset = Math.max(offset, right[depth] + gap - block.left[depth]);
        }
        if (!Number.isFinite(offset)) offset = 0;
      }
      offsets.push(offset);
      for (let depth = 0; depth < block.left.length; depth++) if (block.left[depth] !== undefined) {
        left[depth] = Math.min(left[depth] ?? Infinity, block.left[depth] + offset);
        right[depth] = Math.max(right[depth] ?? -Infinity, block.right[depth] + offset);
      }
    }
    const center = recenter && offsets.length ? (offsets[0] + offsets.at(-1)) / 2 : 0;
    return { offsets: offsets.map(x => x - center), left: left.map(x => x - center), right: right.map(x => x - center) };
  }
  function branch(id) {
    const descendants = children.get(id).filter(child => !['rationale', 'reference'].includes(attachments.get(child).role)).map(branch);
    const packed = pack(descendants, siblingGap), half = widthAt(id) / 2;
    const base = { id, children: descendants.map((block, index) => ({ block, x: packed.offsets[index], step: 1 })),
      left: [-half, ...packed.left], right: [half, ...packed.right] };
    const side = children.get(id).filter(child => ['rationale', 'reference'].includes(attachments.get(child).role)).map(branch);
    if (!side.length) return base;
    const beside = pack([base, ...side], siblingGap, false);
    base.children.push(...side.map((block, index) => ({ block, x: beside.offsets[index + 1], step: 0 })));
    base.left = beside.left; base.right = beside.right;
    return base;
  }
  function place(block, x, depth) {
    const attachment = attachments.get(block.id), parentId = parents.get(block.id) || null;
    positions.set(block.id, { x, y: 0, depth, parentId,
      structuralParentId: attachment?.role === 'containment' ? parentId : null,
      parentRelationId: attachment?.relationId || null, placementRole: attachment?.role || 'root',
      declaredEntryPoint: declaredRoots.has(block.id), containmentParentIds: [...(ownerCandidates.get(block.id) || [])].sort(compare), dependencySourceIds: [...(consumers.get(block.id) || [])].sort(compare),
      sharedDependency: (consumers.get(block.id)?.size || 0) > 1 });
    for (const child of block.children) place(child.block, x + child.x, depth + child.step);
  }
  const forest = roots.map(branch), packed = pack(forest, forestGap);
  forest.forEach((block, index) => place(block, packed.offsets[index], 0));
  const rows = new Map();
  for (const [id, point] of positions) {
    if (!rows.has(point.depth)) rows.set(point.depth, []);
    rows.get(point.depth).push({ id, point });
  }
  const depthBands = [], rowPitch = nodeHeight + siblingGap;
  const bandGap = Math.max(levelGap, nodeHeight * 2);
  let topCenter = 0;
  for (const [depth, members] of [...rows].sort(([a], [b]) => a - b)) {
    members.sort((a, b) => a.point.x - b.point.x || compare(a.id, b.id));
    let ordinaryIndex = 0;
    for (const { id, point } of members) {
      point.bandRow = locked.has(id) || !stagger ? 0 : ordinaryIndex++ % 2;
      point.x *= horizontalScale;
      point.y = topCenter - point.bandRow * rowPitch;
    }
    const rowCount = Math.max(...members.map(({ point }) => point.bandRow)) + 1;
    const bottomCenter = topCenter - (rowCount - 1) * rowPitch;
    depthBands.push({ depth, rowCount, minY: bottomCenter - nodeHeight / 2, maxY: topCenter + nodeHeight / 2 });
    topCenter = bottomCenter - bandGap;
  }
  const points = [...positions.values()];
  const minX = Math.min(...points.map(point => point.x - nodeWidth / 2));
  const maxX = Math.max(...points.map(point => point.x + nodeWidth / 2));
  const center = (minX + maxX) / 2;
  for (const point of points) point.x -= center;
  const bounds = { minX: minX - center, maxX: maxX - center,
    minY: Math.min(...points.map(point => point.y)) - nodeHeight / 2, maxY: nodeHeight / 2 };
  return { positions, roots, treeRelationIds, treeRoutes, relationRoles, sequenceGroups, warnings, diagnostics, depthBands,
    width: bounds.maxX - bounds.minX, height: bounds.maxY - bounds.minY, bounds };
}
