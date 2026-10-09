"""Reproducible M0 probes against unmodified sift-kg, with no LLM calls.

Fixtures below are deliberately synthetic, not claims about the pilot papers.
Run with experiments/envs/sift-kg/bin/python experiments/scripts/sift-contract-probe.py
"""
from pathlib import Path
import hashlib
import json
import os
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
VENDOR = ROOT / "experiments/vendor/sift-kg"
RUN = VENDOR / "m0-artifacts"
RUN.mkdir(exist_ok=True)
ENV = {
    "PATH": "/usr/bin:/bin:/usr/sbin:/sbin",
    "LANG": "en_US.UTF-8",
    "HF_HUB_OFFLINE": "1",
    "HF_HOME": str(RUN / "hf-cache"),
    "LITELLM_LOCAL_MODEL_COST_MAP": "True",
    "TOKENIZERS_PARALLELISM": "false",
    "SIFT_OUTPUT_DIR": str(RUN / "scratch-output"),
    "PYTHONDONTWRITEBYTECODE": "1",
}
# Restrict subprocess/import environment to prevent reading provider keys.
os.environ.clear()
os.environ.update(ENV)

from sift_kg.domains.loader import DomainLoader
from sift_kg.extract.models import DocumentExtraction, ExtractedEntity, ExtractedRelation
from sift_kg.graph.builder import build_graph
from sift_kg.graph.knowledge_graph import KnowledgeGraph

SIFT = str(ROOT / "experiments/envs/sift-kg/bin/sift")
commands = []
results = {"fixture_kind": "synthetic_contract_fixture_not_llm_extraction", "llm_calls": 0}


def cli(name, *args):
    proc = subprocess.run([SIFT, *args], cwd=RUN, env=ENV, capture_output=True, text=True, timeout=120)
    log = RUN / f"{name}.log"
    log.write_text(proc.stdout + "\nSTDERR\n" + proc.stderr)
    commands.append({"name": name, "command": [SIFT, *args], "returncode": proc.returncode, "log": str(log.relative_to(ROOT))})
    return proc


def entity(name, typ, doc, **attrs):
    return ExtractedEntity(name=name, entity_type=typ, context=f"Synthetic context in {doc}", attributes=attrs)


def relation(typ, source, target, doc):
    return ExtractedRelation(relation_type=typ, source_entity=source, target_entity=target, confidence=0.6,
                             evidence=f"Synthetic evidence for {typ} in {doc}")


domain = DomainLoader().load_bundled("academic")
results["academic_schema"] = {"entities": list(domain.entity_types), "relations": list(domain.relation_types)}
fixtures = []
for letter in "AB":
    doc = f"fixture-{letter}"
    fixtures.append(DocumentExtraction(
        document_id=doc, document_path=str(RUN / f"{doc}.txt"), model_used="manual-fixture",
        domain_name=domain.name, chunk_size=10000,
        entities=[entity(f"Fixture Paper {letter}", "PUBLICATION", doc),
                  entity(f"Fixture System {letter}", "SYSTEM", doc),
                  entity("Shared Method", "METHOD", doc),
                  entity(f"Isolated Definition {letter}", "CONCEPT", doc)],
        relations=[relation("USES_METHOD", f"Fixture System {letter}", "Shared Method", doc),
                   relation("IMPLEMENTS", f"Fixture System {letter}", "Shared Method", doc),
                   relation("PROPOSED_BY", f"Fixture System {letter}", f"Fixture Paper {letter}", doc)],
    ))

for kind in ("default", "no-postprocess"):
    folder = RUN / kind / "extractions"
    folder.mkdir(parents=True, exist_ok=True)
    for fixture in fixtures:
        (folder / f"{fixture.document_id}.json").write_text(fixture.model_dump_json(indent=2))

cli("help", "--help")
cli("domains", "domains")
cli("build-default", "build", "--domain-name", "academic", "-o", str(RUN / "default"))
cli("build-no-postprocess", "build", "--domain-name", "academic", "--no-postprocess", "-o", str(RUN / "no-postprocess"))
default = KnowledgeGraph.load(RUN / "default/graph_data.json")
kept = KnowledgeGraph.load(RUN / "no-postprocess/graph_data.json")
results["isolated_nodes"] = {
    "default_keeps_isolated": default.get_entity("concept:isolated_definition_a") is not None,
    "no_postprocess_keeps_isolated": kept.get_entity("concept:isolated_definition_a") is not None,
}
results["cross_document_shared_entity"] = kept.get_entity("method:shared_method")
pair = kept.graph.get_edge_data("system:fixture_system_a", "method:shared_method")
results["same_pair_relation_types"] = sorted(x["relation_type"] for x in pair.values())

out = str(RUN / "no-postprocess")
cli("info", "info", "--json", "-o", out)
cli("search", "search", "Shared Method", "--json", "--relations", "-o", out)
cli("query", "query", "method:shared_method", "-o", out)
cli("topology", "topology", "-o", out)
for fmt in ("json", "sqlite", "graphml", "gexf", "csv"):
    cli(f"export-{fmt}", "export", fmt, "-o", out)
cli("view", "view", "--no-open", "-o", out)

restored = KnowledgeGraph.load(RUN / "no-postprocess/graph.json")
results["json_roundtrip"] = {"same_nodes": list(restored.graph.nodes(data=True)) == list(kept.graph.nodes(data=True)),
                             "same_edges": list(restored.graph.edges(data=True)) == list(kept.graph.edges(data=True))}
import networkx as nx
gml = nx.read_graphml(RUN / "no-postprocess/graph.graphml")
results["graphml_export"] = {"document_nodes": sum(d.get("entity_type") == "DOCUMENT" for _, d in gml.nodes(data=True)),
                            "merged_pair": gml.get_edge_data("system:fixture_system_a", "method:shared_method")}
import sqlite3
with sqlite3.connect(RUN / "no-postprocess/graph.sqlite") as con:
    results["sqlite_export"] = {"nodes": con.execute("select count(*) from nodes").fetchone()[0],
                                "edges": con.execute("select count(*) from edges").fetchone()[0],
                                "document_nodes": con.execute("select count(*) from nodes where entity_type='DOCUMENT'").fetchone()[0]}

extra_fields = dict(evidence_id="ev-fixture", page=2, bbox=[1, 2, 3, 4], source_sha256="fixture-hash",
                    basis="ai_inferred", verification_status="unverified")
r = ExtractedRelation(relation_type="EXTENDS", source_entity="A", target_entity="B", evidence="test", **extra_fields)
e = ExtractedEntity(name="A", entity_type="METHOD", **extra_fields)
results["extraction_schema_extra_fields"] = {"submitted": list(extra_fields),
                                           "relation_preserved": [k for k in extra_fields if k in r.model_dump()],
                                           "entity_preserved": [k for k in extra_fields if k in e.model_dump()]}

# Rebuild starts from extraction JSON and therefore discards a manual graph correction.
kept.graph.nodes["method:shared_method"]["human_note"] = "Keep this manual correction"
kept.graph.remove_edge("system:fixture_system_a", "method:shared_method", key=next(iter(pair)))
kept.save(RUN / "no-postprocess/graph_data.json")
cli("rebuild-after-edit", "build", "--domain-name", "academic", "--no-postprocess", "-o", out)
rebuilt = KnowledgeGraph.load(RUN / "no-postprocess/graph_data.json")
results["rebuild_after_manual_edit"] = {
    "human_note_preserved": "human_note" in rebuilt.get_entity("method:shared_method"),
    "removed_relation_reappears": len(rebuilt.graph.get_edge_data("system:fixture_system_a", "method:shared_method")) == 2,
}

kg = KnowledgeGraph()
kg.add_entity("a", "METHOD", "A")
kg.add_entity("b", "METHOD", "B")
for _ in range(2):
    kg.add_relation("exact-same-id", "a", "b", "EXTENDS", confidence=0.6, source_document="same-doc", evidence="exact same quote")
results["duplicate_relation_insert"] = next(iter(kg.graph.get_edge_data("a", "b").values()))

same_name = []
for version in ("v1", "v2"):
    same_name.append(DocumentExtraction(document_id=f"same-title-{version}", document_path=f"{version}.pdf",
       entities=[ExtractedEntity(name="Same Model", entity_type="SYSTEM", attributes={"version": version})]))
collision = build_graph(same_name, postprocess=False)
results["same_name_version_collision"] = collision.get_entity("system:same_model")

# No live LLM is supplied. The cached path must return before trying to call this object.
from sift_kg.extract.extractor import extract_document
from types import SimpleNamespace
cache_dir = RUN / "incremental"
(cache_dir / "extractions").mkdir(parents=True, exist_ok=True)
source = RUN / "mutable.txt"
source.write_text("This document was replaced with completely different content.")
cached = DocumentExtraction(document_id="mutable", document_path=str(source), model_used="manual-fixture",
                             domain_name=domain.name, chunk_size=10000,
                             entities=[ExtractedEntity(name="OLD CONTENT", entity_type="CONCEPT")])
(cache_dir / "extractions/mutable.json").write_text(cached.model_dump_json())
result = extract_document(source, SimpleNamespace(model="manual-fixture"), domain, cache_dir, backend="pdfplumber")
results["changed_file_cache"] = {"reused_old_content": result.entities[0].name == "OLD CONTENT", "llm_called": False}
other_path = RUN / "other-folder/mutable.txt"
other_path.parent.mkdir(exist_ok=True)
other_path.write_text("An entirely unrelated file with the same stem.")
result2 = extract_document(other_path, SimpleNamespace(model="manual-fixture"), domain, cache_dir, backend="pdfplumber")
results["same_stem_collision"] = {"returned_first_document_path": result2.document_path == str(source)}

# Real pilot text extraction, but explicitly no scientific entity/relation extraction.
pdf = ROOT / "experiments/corpus/qwen-image-2.0-v1.pdf"
if pdf.exists():
    from sift_kg.ingest.pdfplumber_extractor import PdfPlumberExtractor
    extracted = PdfPlumberExtractor().extract(pdf)
    (RUN / "qwen-image-2.0-pdfplumber.txt").write_text(extracted.content)
    results["real_pilot_pdf"] = {"path": str(pdf), "sha256": hashlib.sha256(pdf.read_bytes()).hexdigest(),
        "text_characters": len(extracted.content), "pages_field": extracted.pages,
        "has_swiglu": "swiglu" in extracted.content.lower(),
        "has_bbox": "bbox" in extracted.__dict__, "metadata": extracted.metadata.__dict__}
else:
    results["real_pilot_pdf"] = {"status": "not available"}

# Verify refusal before any provider/client import or network operation.
cli("extract-no-credentials", "extract", str(RUN), "--domain-name", "academic", "--extractor", "pdfplumber")

results["commands"] = commands
(RUN / "probe-results.json").write_text(json.dumps(results, ensure_ascii=False, indent=2))
print(json.dumps({"results": str(RUN / "probe-results.json"), "commands": len(commands),
                  "nonzero_commands": [(x["name"], x["returncode"]) for x in commands if x["returncode"]]}, indent=2))
