# Current local API

This reference describes the **implemented knowledge-service contract** at `http://127.0.0.1:4317`. Check `health` first, because an old read-only M0 process may still occupy that port. The Python client is under `../scripts/smg.py`; every command also accepts `--base URL` before the subcommand. No third-party Python package is required.

```sh
python3 scripts/smg.py health
python3 scripts/smg.py snapshot
python3 scripts/smg.py get-preferences
python3 scripts/smg.py list entities
python3 scripts/smg.py get entities qwen2-model
python3 scripts/smg.py locate q2-architecture
```

`GET /api/knowledge` returns `{revision, manifest, graph, evidence, notes, tags, groups, state, preferences}`; `graph` also contains `conflicts` and `negative_examples`. CRUD resources are `papers`, `entities`, `relations`, `evidence`, `conflicts`, `negative_examples`, `notes`, `tags`, `groups`. List responses have `{revision,items}`. A paper's identity field is `paper_id`; other records use `id`. `GET /api/knowledge/<resource>/<id>` reads one record. Mutations use `POST /api/knowledge/<resource>`, `PATCH` and `DELETE /api/knowledge/<resource>/<id>`. The POST/PATCH JSON body is the record or partial record; the response includes the new revision and item.

For single-record changes, send `If-Match: "<revision>"` via `--if-match`. `POST /api/knowledge/batch` takes `{"expected_revision":N,"operations":[{"op":"create|patch|delete","resource":"entities","id":"...","value":{...}}]}` and commits all operations together or none. The `value` for create/patch is a record/partial record; `id` identifies patch/delete. Test against the live schema; a 400 means the payload was rejected and nothing should be claimed as saved. A 409 means revision mismatch or broken source version, requiring a fresh read and reconciliation.

```sh
# The JSON file contains one record, e.g. {"id":"tag-text-rendering","label":"文字渲染"}.
python3 scripts/smg.py create tags --file /tmp/tag.json --if-match 42

# The JSON file contains {"selected_paper_ids":["qwen-image-2.0"],"active_group_id":null}.
python3 scripts/smg.py state --file /tmp/selection.json --if-match 43

# Only when the user asks to change preferences. JSON: {"maintenance_prompt":"优先使用原始论文，并用中文记录备注。"}.
python3 scripts/smg.py preferences --file /tmp/preferences.json --if-match 44

# The JSON file contains expected_revision and operations as above.
python3 scripts/smg.py batch --file /tmp/graph-change.json
```

The CLI accepts `--file -` to read JSON from stdin. It prints JSON to stdout and structured HTTP errors to stderr, exits nonzero on failure, and can be used by any agent able to run Python 3. When constructing JSON from arbitrary paper text, write it with a JSON serializer or a safely quoted file; do not interpolate untrusted text into a shell command.

## Maintenance preferences

`preferences` is a knowledge-base setting shared by the WebUI and Agent clients, not a per-browser setting. `GET /api/knowledge/preferences` returns `{revision,preferences:{maintenance_prompt:string}}`. `PUT /api/knowledge/preferences` takes `{"maintenance_prompt":"..."}` with the current `If-Match` revision and returns the updated preferences and revision. The prompt is at most 20,000 characters; `""` clears it. The setting survives a service restart and uses the same revision/event stream as knowledge records. Use this dedicated endpoint rather than a CRUD resource or batch operation.

Read the prompt before each maintenance task and reread the latest snapshot before writing results. If preferences changed during research, adjust the pending result before submitting it with the latest revision. A 409 requires a fresh read and reconciliation, including any preference changes. Reading preferences does not run an Agent; the loaded skill supplies the workflow that applies them.

## Stored record shapes

Existing `manifest.papers` records include `paper_id`, bibliographic IDs/version, title, source metadata, and a fixed PDF object with `sha256` and local artifact path. Existing `graph.entities` records include `id`, `label`, `kind`, `paper_ids`, `source_ids`, `description`, and optional `tag_ids`. Existing `graph.relations` include `id`, `source`, `target`, `type`, `label`, `basis`, `source_ids`, and `description`. `basis=explicit` means directly stated in original material; use a distinct inferred value for an Agent interpretation, and explain why. Keep both relation endpoints as existing entity IDs.

Evidence records include `id`, `paper_id`, fixed PDF `sha256`, `page`, `quote`, `section`/`title` when known, and coordinates plus validation status when available. `GET /api/evidence/<id>` checks the fixed file hash and returns the PDF link; `GET /api/artifacts/<paper_id>/file` serves that PDF. A response from `locate` with `artifact_verified:true` confirms the stored file version, **not** the academic interpretation of the passage.

Notes use `{id,target_type:"paper"|"entity"|"relation"|"evidence",target_id,body}`. Tags use `{id,label,color?}` and are assigned through `tag_ids` on papers, entities, relations, conflicts, and negative examples. Groups use `{id,name,paper_ids}`. `GET /api/knowledge/state` reads the current shared state; `PUT /api/knowledge/state` sets `{selected_paper_ids,active_group_id}`. `GET /api/knowledge/events` streams revision events for clients that need live notifications. `conflicts` preserve opposing source statements, with `subject` referring to an entity if supplied. `negative_examples` preserve tempting but rejected relation types, such as a citation that is not evidence of use; their `source` and `target` refer to entities.

The service adds provenance to papers, entities, relations, evidence, conflicts, and negative examples: `origin`, `review_status`, `evidence_status`, timestamps, and for relations an `inference_status` derived from `basis`. `origin=agent` and `review_status=unreviewed` are defaults for Agent-created records. Do not alter them to claim human review. An `evidence_status=linked` value only says `source_ids` were linked; inspect the anchor and interpretation before calling a claim verified.

No API operation here is a web search, PDF parser, automatic Zotero importer, task scheduler, backup service, or proof that a claim was human-verified. Prefer read-only calls when a request only asks for an explanation. Use the API for all mutations, not the service's `.runtime/knowledge.json` or seed files.
