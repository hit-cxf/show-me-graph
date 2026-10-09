# Show Me Graph local knowledge API

The Web UI and coding agents use the same persisted knowledge database. The service binds to `127.0.0.1` (default port `4317`). Only requests with a `127.0.0.1` or `localhost` Host header are accepted. Browser requests from another Origin are rejected. CLI clients can omit `Origin`. Mutations must send `Content-Type: application/json`. There is no remote authentication; do not expose the local port to a public network.

On first startup, the service copies `experiments/corpus/{manifest,propositions,evidence}.json` into `experiments/prototype/.runtime/knowledge.json`. Subsequent requests read and atomically update this persisted file; the source corpus remains unchanged. Set `SMG_KNOWLEDGE_PATH` to an alternate absolute path for an isolated database. `GET /api/health` reports the current integer revision. Each successful mutation advances it once and emits an SSE notice.

## Reading

| Route | Response |
| --- | --- |
| `GET /api/knowledge` | Full `{schema_version,revision,updated_at,manifest,graph,evidence,notes,tags,groups,state,preferences}` snapshot. `graph` contains `entities`, `relations`, `conflicts`, and `negative_examples`; `manifest.papers` and `evidence.evidence` retain their corpus shapes. |
| `GET /api/knowledge/{resource}` | `{revision,items:[...]}` |
| `GET /api/knowledge/{resource}/{id}` | `{revision,item}` |
| `GET /api/knowledge/state` | `{revision,state}` |
| `GET /api/knowledge/preferences` | `{revision,preferences:{maintenance_prompt}}`; the prompt defaults to an empty string. |
| `GET /api/knowledge/events` | Server-sent `revision` events; `data` is `{"revision": N}` on connection and each committed mutation. |

Allowed resources are `papers`, `entities`, `relations`, `evidence`, `notes`, `tags`, `groups`, `conflicts`, and `negative_examples`. The resource ID is `paper_id` for papers and `id` for all others. URL-encode IDs in a route segment. The older `GET /api/graph`, `/api/manifest`, and `/api/evidence` routes are views of this **same** persisted snapshot. `GET /api/evidence/{id}` still verifies the fixed PDF hash and returns `pdf_url`; `GET /api/artifacts/{paper_id}/file` still serves only a hash-verified local PDF under the allowed corpus directories.

## Writing

| Route | Body | Success |
| --- | --- | --- |
| `POST /api/knowledge/{resource}` | Direct record with an explicit ID | `201 {revision,item}` |
| `PATCH /api/knowledge/{resource}/{id}` | Partial object, or a full record with the same ID | `200 {revision,item}` |
| `DELETE /api/knowledge/{resource}/{id}` | Empty | `200 {revision,deleted:id}` |
| `PUT /api/knowledge/state` | Partial `{selected_paper_ids?,active_group_id?}` | `200 {revision,state}` |
| `PUT /api/knowledge/preferences` | `{maintenance_prompt:string}` | `200 {revision,preferences}` |
| `POST /api/knowledge/batch` | `{operations:[{op,resource,id?,value?}],expected_revision?}` | `200 {revision,results}` |

`op` is `create`, `patch`, or `delete`. For `create`, put the direct record in `value`; for `patch`, put the partial record in `value` and supply `id`; for `delete`, supply `id`. A batch commits all operations together only if its final state passes validation; a failed batch changes nothing. At most 1000 operations are accepted per batch. For any write, optionally send `If-Match: "<revision>"`; a stale revision receives `409`, so a client can re-read and reconcile. A batch can instead carry `expected_revision` in JSON. The JSON body limit is 20 MiB. Write responses have `ETag: "<revision>"`.

For author attribution, send `X-SMG-Actor: human` from human UI operations. Other calls default to `agent`. New papers, entities, relations, evidence, conflicts, and negative examples receive `provenance` with immutable `origin` and `created_at`, `review_status: "unreviewed"`, `evidence_status: "linked"` or `"unlinked"`, and `updated_at`. The evidence state is linked when an entity or relationship has evidence IDs, or when a paper/evidence record links a fixed PDF hash. Relations also receive `inference_status: "source_explicit"` when `basis` is `explicit`, or `"ai_inferred"` otherwise. `basis: "inferred"` is accepted. A reviewer can patch `provenance.review_status` to `human_verified`; the original `origin` remains visible. These are attribution and workflow states, not automatic semantic verification.

## Agent maintenance preferences

`preferences.maintenance_prompt` stores the user's instructions for agents maintaining this knowledge base. The Web UI and agents read and update the same field; this is not browser-local storage. Agents should read it before maintenance and follow it within the current user's instructions and evidence requirements. Saving this prompt does not itself launch an agent or rewrite existing research records.

Use `GET /api/knowledge/preferences` to read the prompt and current revision, then `PUT` with `If-Match` to save changes. The body must contain only `maintenance_prompt`, a string of at most 20,000 JavaScript string code units (matching the Web UI character limit); an empty string clears it. Unknown fields, missing strings, non-string values, and longer prompts return `400` without changing the database. A successful update uses the same atomic persistence, serialized revision checks, and SSE notification as other writes. Ordinary knowledge CRUD preserves the prompt. Older database files without `preferences` expose the empty default in memory and acquire the field on the next successful mutation; reading or starting the service does not rewrite those files.

## Referential rules

- Papers require `paper_id` and a nonempty `verified_title` or `expected_title`. A paper may omit `pdf` until a fixed local copy is available.
- Entities require `id`, `label`, `kind`, and unique `paper_ids` referring to existing papers. A `kind: "paper"` entity refers to exactly one paper.
- Relations require `id`, `source`, `target`, and `type`; both endpoints must be existing entity IDs.
- Evidence requires `id` and an existing `paper_id`. If the paper has a PDF SHA-256 and the evidence supplies one, the hashes must match. A supplied `page` must be a positive integer.
- `source_ids` on entities, relations, conflicts, and negative examples refer to existing evidence IDs. `tag_ids` on papers, entities, relations, conflicts, and negative examples refer to existing tags. Both arrays must have unique nonempty strings.
- Notes have `{id,target_type,target_id,body}`. `target_type` is `paper`, `entity`, `relation`, or `evidence`; the referenced record must exist.
- Tags have `{id,label,color?}`. Groups have `{id,name,paper_ids}` with existing paper IDs. Shared state has `selected_paper_ids` (existing paper IDs) and `active_group_id` (existing group ID or `null`).
- Conflicts and negative examples retain the corpus record shapes. `conflicts.subject`, when present, refers to an entity. A negative example's `source` and `target` refer to entities.

IDs are immutable. A referenced record cannot be deleted until links to it are removed, including notes, evidence links, group membership, tags, graph edges, and shared selection. A single batch can remove the links and record atomically. Custom JSON fields are preserved, allowing richer research metadata without changing API routes.

All errors are JSON: `{ "error": "Human-readable message", "code": "machine_code" }`. `400` means malformed or invalid data; `404` means missing record; `409` means stale revision, duplicate ID, or another conflict; `413` means body too large; `415` means the write was not JSON. Evidence citation routes verify local artifact hashes, but a newly submitted quote or bounding box is **not** automatically checked against the PDF text layer; agents must validate such annotations before submission.

## Minimal examples

```bash
curl -s http://127.0.0.1:4317/api/knowledge
curl -s -X POST http://127.0.0.1:4317/api/knowledge/tags \
  -H 'Content-Type: application/json' \
  -d '{"id":"vae","label":"VAE"}'
curl -s -X PATCH http://127.0.0.1:4317/api/knowledge/entities/qwen2-vae \
  -H 'Content-Type: application/json' \
  -d '{"tag_ids":["vae"]}'
```
