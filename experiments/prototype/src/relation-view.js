// A shared entity has one identity but several visible occurrences. Prefer the
// paper that supports the assertion when routing a cross-paper edge; array order
// (and therefore the current selection order) must not change its apparent source.
export function relationOccurrencePairs(relation, byEntity, { evidence = new Map(), origins = new Map() } = {}) {
  const sources = byEntity.get(relation.source) || [], targets = byEntity.get(relation.target) || [];
  const local = sources.flatMap(source => targets.filter(target => source.paper_id === target.paper_id).map(target => [source, target]));
  if (local.length) return local;
  const evidencePapers = new Set((relation.source_ids || []).map(id => evidence.get(id)?.paper_id).filter(Boolean));
  function preferred(occurrences, entityId) {
    const originPapers = origins.get(entityId) || new Set();
    const score = occurrence => (evidencePapers.has(occurrence.paper_id) ? 2 : 0) + (originPapers.has(occurrence.paper_id) ? 1 : 0);
    const best = Math.max(...occurrences.map(score));
    // Keep equally supported occurrences rather than inventing a unique owner.
    return occurrences.filter(occurrence => score(occurrence) === best).sort((a, b) => a.id.localeCompare(b.id));
  }
  return preferred(sources, relation.source).flatMap(source => preferred(targets, relation.target).map(target => [source, target]));
}

export function entityOrigins(entities, relations) {
  const papers = new Map(entities.filter(entity => entity.kind === 'paper').map(entity => [entity.id, entity.paper_ids?.[0]]));
  const origins = new Map();
  for (const relation of relations) {
    if (!['presents', 'proposes'].includes(relation.type) || !papers.get(relation.source)) continue;
    if (!origins.has(relation.target)) origins.set(relation.target, new Set());
    origins.get(relation.target).add(papers.get(relation.source));
  }
  return origins;
}

export function layoutWarningText(warnings) {
  const count = type => warnings.filter(warning => warning.type === type).length;
  const parts = [];
  const cycles = count('containment-cycle') + count('sequence-cycle');
  if (cycles) parts.push(`${cycles} 处包含或顺序循环待核对`);
  if (count('multiple-containment')) parts.push(`${count('multiple-containment')} 处多重归属保留交叉边`);
  if (count('sequence-between-branches')) parts.push(`${count('sequence-between-branches')} 处跨分支顺序保留箭头`);
  const known = new Set(['containment-cycle', 'sequence-cycle', 'multiple-containment', 'sequence-between-branches']);
  const other = warnings.filter(warning => !known.has(warning.type)).length;
  if (other) parts.push(`${other} 处布局提示待核对`);
  return parts.join('；');
}
