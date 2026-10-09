const HIERARCHY_RELATIONS = new Set(['cites', 'builds_on', 'adapts', 'refines', 'uses',
  'reports_post_training_of', 'retrospectively_describes_component_of', 'extends', 'post_trained_from']);

// A benchmark being used is not an ancestor of the evaluated model. Only
// citation/source relations set levels; all other real edges are still rendered.
export function paperHierarchyRelation(relation) { return HIERARCHY_RELATIONS.has(relation.type); }

// Coordinates express citation/source direction, not technical containment.
export function layoutPapers(papers, relations, { anchorId = 'qwen-image-2.0' } = {}) {
  const compare = (a, b) => a === b ? 0 : a === anchorId ? -1 : b === anchorId ? 1 : a.localeCompare(b);
  const ids = [...new Set(papers.map(paper => paper.paper_id))].sort(compare);
  const result = new Map();
  if (!ids.length) return result;
  const outgoing = new Map(ids.map(id => [id, new Set()]));
  const incoming = new Map(ids.map(id => [id, new Set()]));
  for (const relation of relations) {
    if (!paperHierarchyRelation(relation)) continue;
    if (typeof relation.source !== 'string' || typeof relation.target !== 'string'
      || !relation.source.startsWith('paper-') || !relation.target.startsWith('paper-')) continue;
    const source = relation.source.slice(6), target = relation.target.slice(6);
    if (!outgoing.has(source) || !outgoing.has(target)) continue;
    outgoing.get(source).add(target);
    incoming.get(target).add(source);
  }

  // Tarjan condensation keeps cyclic data finite without removing its real edges.
  const index = new Map(), low = new Map(), stack = [], onStack = new Set(), components = [];
  let nextIndex = 0;
  function visit(id) {
    index.set(id, nextIndex); low.set(id, nextIndex++); stack.push(id); onStack.add(id);
    for (const target of [...outgoing.get(id)].sort(compare)) {
      if (!index.has(target)) { visit(target); low.set(id, Math.min(low.get(id), low.get(target))); }
      else if (onStack.has(target)) low.set(id, Math.min(low.get(id), index.get(target)));
    }
    if (low.get(id) === index.get(id)) {
      const group = []; let member;
      do { member = stack.pop(); onStack.delete(member); group.push(member); } while (member !== id);
      components.push(group.sort(compare));
    }
  }
  ids.forEach(id => { if (!index.has(id)) visit(id); });
  const componentOf = new Map();
  components.forEach((group, i) => group.forEach(id => componentOf.set(id, i)));
  const componentEdges = components.map(() => new Set()), indegree = components.map(() => 0);
  for (const source of ids) for (const target of outgoing.get(source)) {
    const from = componentOf.get(source), to = componentOf.get(target);
    if (from !== to && !componentEdges[from].has(to)) { componentEdges[from].add(to); indegree[to]++; }
  }
  const componentCompare = (a, b) => compare(components[a][0], components[b][0]);
  const depth = components.map(() => 0), ready = components.map((_, i) => i).filter(i => indegree[i] === 0);
  while (ready.length) {
    ready.sort(componentCompare); const source = ready.shift();
    for (const target of componentEdges[source]) {
      depth[target] = Math.max(depth[target], depth[source] + 1);
      if (--indegree[target] === 0) ready.push(target);
    }
  }

  // Separate disconnected citation families, including isolated papers, so an
  // absent edge never acquires a misleading parent just to complete the tree.
  const seen = new Set(), families = [];
  for (const root of ids) {
    if (seen.has(root)) continue;
    const family = [], queue = [root]; seen.add(root);
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i]; family.push(id);
      for (const neighbor of [...outgoing.get(id), ...incoming.get(id)]) {
        if (!seen.has(neighbor)) { seen.add(neighbor); queue.push(neighbor); }
      }
    }
    families.push(family.sort(compare));
  }

  const horizontalGap = 620, levelGap = 520;
  let cursor = 0;
  for (const family of families) {
    const layers = new Map();
    for (const id of family) {
      const level = depth[componentOf.get(id)];
      if (!layers.has(level)) layers.set(level, []);
      layers.get(level).push(id);
    }
    const levels = [...layers.keys()].sort((a, b) => a - b);
    const positions = () => new Map([...layers.values()].flatMap(layer => layer.map((id, i) => [id, i - (layer.length - 1) / 2])));
    // A few barycenter sweeps reduce crossings while preserving fixed spacing.
    for (let pass = 0; pass < 4; pass++) {
      const forward = pass % 2 === 0;
      for (const level of forward ? levels : [...levels].reverse()) {
        const previous = positions(), neighbors = forward ? incoming : outgoing;
        const score = id => {
          const connected = [...neighbors.get(id)].filter(other => depth[componentOf.get(other)] !== level);
          return connected.length ? connected.reduce((sum, other) => sum + previous.get(other), 0) / connected.length : previous.get(id);
        };
        layers.get(level).sort((a, b) => score(a) - score(b) || compare(a, b));
      }
    }
    const familyX = new Map();
    for (const level of levels) {
      const layer = layers.get(level);
      const desired = layer.map((id, i) => {
        const parents = [...incoming.get(id)].filter(parent => familyX.has(parent));
        return parents.length ? parents.reduce((sum, parent) => sum + familyX.get(parent), 0) / parents.length : (i - (layer.length - 1) / 2) * horizontalGap;
      });
      // Keep siblings apart, while a lone descendant stays under its parent.
      const placed = desired.map((x, i) => x);
      for (let i = 1; i < placed.length; i++) placed[i] = Math.max(placed[i], placed[i - 1] + horizontalGap);
      const shift = placed.reduce((sum, x, i) => sum + x - desired[i], 0) / placed.length;
      layer.forEach((id, i) => familyX.set(id, placed[i] - shift));
    }
    const minX = Math.min(...familyX.values()), maxX = Math.max(...familyX.values()), width = maxX - minX;
    for (const [level, layer] of layers) layer.forEach(id => {
      result.set(id, { x: cursor + familyX.get(id) - minX, z: level * levelGap, depth: level });
    });
    cursor += width + horizontalGap;
  }
  const coordinates = [...result.values()];
  const centerX = (Math.min(...coordinates.map(point => point.x)) + Math.max(...coordinates.map(point => point.x))) / 2;
  const centerZ = (Math.min(...coordinates.map(point => point.z)) + Math.max(...coordinates.map(point => point.z))) / 2;
  for (const point of coordinates) { point.x -= centerX; point.z -= centerZ; }
  return result;
}
