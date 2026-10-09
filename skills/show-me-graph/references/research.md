# Research and provenance workflow

## Fast mode

Start with the reading question, paper/version, and location if supplied. Search existing records and source IDs. Read the cited original passage, then only the external definitions or comparison papers needed to answer. Separate (a) the direct answer, (b) source-defined terms or equations, (c) what the anchor paper says it uses, and (d) contextual background. Add newly established findings to the graph. Stop when the specific answer is supported or the source gap is explicit.

## Deep mode

The host Agent, not the API service, currently conducts the investigation. Record a scope and checklist before extraction: anchor version, sections/tables/figures/references, central architecture, training pipeline, inference, evaluation, findings, limitations, and bibliography trails. For each section of the anchor report, identify systems, methods, components, concepts, definitions, configurations, benchmark/evaluation claims, and negative or uncertain findings. Include auxiliary works that explain important dependencies; avoid promoting every citation into an adoption edge. Follow meaningful branches, list exclusions and inaccessible sources, and report what remains unexamined. Store accepted results through the shared API as you go; do not delay all graph changes until the final prose survey.

## Each graph claim

- Choose an entity identity reusable across papers for a genuinely shared method; use `paper_ids` to record occurrences without merging distinct versions. Treat a named system, a model family, its component, and a measured finding as separate items where they make different claims.
- Choose a precise directed relation. `cites` says one paper references another; `uses` says an implementation actually employs a technique; `builds_on` or `adapts` asserts a stronger technical lineage. Do not infer the stronger edge solely from citation order or a comparison table.
- Attach `source_ids` to the original passage. Check the fixed PDF version, hash, page, quote, and optional coordinates. If provenance is unavailable, preserve the gap in description/status and avoid a fabricated source ID.
- Distinguish direct original statements (`basis=explicit`) from Agent inference (`basis=inferred`), user annotation, and unsupported hypotheses. Keep unresolved contradictions in `conflicts` and rejected tempting relations in `negative_examples`. Automatic entry into the main graph does not imply scientific verification.
- A paper's own technical slice may contain both proposed and adopted concepts plus isolated items. An external method discussed as background should not be represented as a component of that paper unless supported.

## Analyze relationships before drawing

Apply this protocol when extracting, maintaining, or restructuring a paper's technical graph. A three-dimensional drawing is a view of the knowledge graph; its arrangement must follow the relationships established from the source.

1. **Identify the roles and claims.** Separate systems, implemented components, adopted methods, training stages, evaluation resources, observations, motivations, and conclusions. Check existing identities and fixed source versions first. Sharing a topic, appearing in the same paragraph, or having similar names does not establish a parent/child relation.
2. **Classify each directed relation before placing nodes.** Use the table below to distinguish structural branches from dependencies, sequence, and reasoning. Record the precise `type`, endpoints, `basis`, `description`, and `source_ids` through the shared API. If a source supports only a weaker relation, retain that weaker relation or leave the nodes unconnected.
3. **Review the proposed structure.** For each parent, ask whether the child is genuinely a constituent or stage of that parent. Reject containment cycles. Check `precedes` edges for cycles and contradictory order claims; retain unresolved evidence conflicts rather than forcing an order. Verify each relation's own evidence, not merely evidence that its endpoints exist. Check multiple parents and shared methods without discarding supported relations to force one tree.
4. **Arrange and inspect the view.** Use supported containment for the structural backbone. Place same-parent stages as peers ordered by `precedes`; show dependency and reasoning edges separately, without converting their targets into nested components. Preserve other supported edges and isolated nodes. A tree or forest chosen for layout is a projection of the graph, not proof of a unique academic hierarchy. Spacing, staggering, and camera position may change for readability; stored relation types, direction, identity, and stage order may not change just for appearance.

| Meaning | Typed relation and direction | Visual interpretation |
| --- | --- | --- |
| Strict containment | Whole → part: `has_component`, `contains`, `composed_of`; curriculum/pipeline → constituent stage: `has_stage` | Parent/child structure only when the source supports the composition. `includes` also needs explicit containment semantics before it is used this way. |
| Adoption or dependency | User system/component → adopted method or resource: `uses`, `adopts`, `trained_with`; evaluated model → benchmark/evaluator: `evaluated_on`, `evaluated_by`, `evaluated_with` | Dependency links. Using a method or being evaluated on a benchmark does not make that method or benchmark a contained submodule. |
| Sequence | Earlier stage → later stage: `precedes` | Order peer stages or operations. A later stage is not a child of the previous stage merely because it follows it. |
| Claims and reasoning | Reporter → finding: `reports`; method → addressed problem: `mitigates`; qualification → claim it limits: `qualifies` | Side relationships that explain results, motivation, or scope; never implicit containment. For other relation names, state their direction and meaning explicitly. |
| Technical lineage or citation | Derivative → predecessor: `builds_on`, `adapts`; citing paper → cited paper: `cites` | Preserve lineage and citation semantics independently of composition. Citation alone does not demonstrate adoption. |

Reuse existing semantic relation types when they fit; do not choose a type merely because the current renderer happens to treat it as a branch. If the renderer cannot represent a supported distinction, report that display limitation instead of changing the academic claim. A stored dependency graph may have valid cycles; review those in context rather than deleting edges solely to obtain a tree. Strict containment and a claimed linear stage order require their own cycle checks.

### Examples that distinguish the relationships

- **Qwen-Image-2.0 data curriculum:** its six data-filtering/training-data stages are six peer constituents of that curriculum, connected by `has_stage` and ordered stage 1 → 2 → 3 → 4 → 5 → 6 with `precedes` where the source supports that order. Their different numbers of filters or substeps do not make one stage contain another. The separate three-stage backbone training recipe—pretraining, continual pretraining, supervised fine-tuning—has its own parent and stages; do not merge the two schemes merely because both use the word “stage.”
- **Activation design:** a multilayer perceptron (MLP，多层感知机) adopts SwiGLU (Swish-Gated Linear Unit，Swish 门控线性单元) as a method, so record the adoption with `uses` or the supported equivalent. The observation of excessively large activations is a motivation for adopting the method, not a submodule inside SwiGLU. Represent the observation as a finding and the supported mitigation or motivation relationship as a side edge; preserve whether this reasoning is explicit in the report or an Agent inference.
- **Shared methods:** a method used by several papers retains one canonical entity ID and all applicable `paper_ids`. Its occurrence in each paper's displayed slice keeps its name. A UI may use separate occurrence identifiers for drawing, but these must resolve to that same entity; do not create duplicate knowledge identities or blank labels because a cross-paper link already exists.

### Whole-graph audit checks

Audit all existing relations in the requested scope, including nodes outside the user's examples. Record the checked relation IDs, evidence, corrections, and unresolved cases. Check both stored assertions and their displayed occurrences; a mechanically valid, well-spaced graph can still express the wrong logic.

- Distinguish a notation definition from a concrete configuration (`uses_notation`), a model initialization source from a contained module (`initialized_from`), and a generalized mathematical role from an actual model instance (`instance_of`, marked inferred when it is the Agent's interpretation).
- Distinguish a training algorithm (`trained_with`), training data (`trained_on`), and a generator that supplies training samples (`trained_on_samples_from`). The latter does not mean the generator itself is a dataset. A formula describing an algorithm may be `formulation_of` that algorithm without being its full implementation.
- A benchmark `reports_result_for` a tested model; this does not make the benchmark a component of the model. A limiting statement `qualifies` the result it limits. Check the endpoint roles before deciding which node belongs beside which; do not reverse the stored assertion to fit a drawing convention.
- A later report may establish that an earlier implementation is an `intermediate_variant_of` a framework. Preserve that retrospective evidence and its date; do not turn it into a claim that the earlier paper cited a later paper, or that the intermediate implementation used every feature of the final framework.
- Preserve a paper's explicitly presented systems as separate entry points unless real containment evidence says otherwise. Optimization, use, and support links between those systems must not silently turn one into a contained submodule of the other.
- Trace cross-paper links from the appropriate evidence/definition occurrence of a shared entity. The order of selected papers must not decide which paper appears to originate a technical lineage. Only citation/source relations establish paper-layer ancestry; evaluation or comparison edges remain distinct.
- Scope operation order to the actual process. When multiple stages share a filter identity, do not apply one stage's local order as a universal `precedes` relation on that shared method. Record the scope in the assertion or retain a precise textual sequence until scoped occurrences are represented.
- Check actual directed cycles in containment and sequence independently of the layout forest. Multiple parents, valid feedback loops, and sequence edges between branches are not automatically cycles or errors. Reconcile duplicate assertions without losing notes or provenance; reuse an existing relation ID for a more precise supported relation only when that correction preserves its intended subject.

## Revising and reporting

Read current revision before a write; use an atomic batch when creating mutually dependent records. On conflict, compare current records before changing them; preserve human notes and corrections. Verify the saved graph and `locate` every evidence anchor cited in the answer. Report scope, material conclusions, original-source paths/IDs, inferred edges, missing PDFs or anchors, and incomplete checklist items. Never claim full-field coverage solely because the planned pass was completed.
