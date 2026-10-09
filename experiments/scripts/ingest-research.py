#!/usr/bin/env python3
"""Merge a curated deep-research selection into the local graph and PDF corpus.

Selections are reviewed JSON, not automatically inferred relations. The script
checks fixed PDF bytes, exact text lines and graph references before writing.
"""
import argparse
from datetime import datetime, timezone
import hashlib
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import tempfile
from urllib.request import Request, urlopen

import pymupdf

ROOT = Path(__file__).resolve().parents[2]
CORPUS = ROOT / "experiments/corpus"
ARXIV_RE = re.compile(r"\d{4}\.\d{4,5}\Z")


class CitationMeta(HTMLParser):
    def __init__(self):
        super().__init__()
        self.values = {}

    def handle_starttag(self, tag, attrs):
        if tag.lower() != "meta":
            return
        attrs = dict(attrs)
        name = attrs.get("name", "").lower()
        if name.startswith("citation_"):
            self.values.setdefault(name, []).append(attrs.get("content", ""))


def normalized(value):
    return "".join(c for c in value.casefold() if c.isalnum())


def load_json(name):
    return json.loads((CORPUS / name).read_text())


def write_json_atomic(path, value):
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, prefix=".ingest-", delete=False) as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
        scratch = Path(handle.name)
    os.replace(scratch, path)


def metadata_for(spec):
    version_id = spec["arxiv_id"] + spec["version"]
    target = CORPUS / f'{spec["paper_id"]}-{spec["version"]}-abs.html'
    url = "https://arxiv.org/abs/" + version_id
    if target.exists():
        body = target.read_bytes()
    else:
        request = Request(url, headers={"User-Agent": "ShowMeGraph-Research/0.1 (local literature archive)"})
        with urlopen(request, timeout=60) as response:
            body = response.read()
        if not body.startswith(b"<!DOCTYPE") and b"citation_title" not in body:
            raise ValueError("Unexpected arXiv metadata response for " + version_id)
    parser = CitationMeta()
    parser.feed(body.decode("utf-8", errors="replace"))
    title = next(iter(parser.values.get("citation_title", [])), "")
    date = next(iter(parser.values.get("citation_date", [])), "")
    if normalized(title) != normalized(spec["expected_title"]) or not date:
        raise ValueError("Versioned arXiv metadata title/date mismatch for " + version_id)
    return target, body, title, date


def pdf_for(spec):
    relative = Path(spec["artifact_path"])
    path = (ROOT / relative).resolve()
    if not path.is_relative_to(ROOT / "research/corpus") or not path.is_file():
        raise ValueError("Selected PDF is absent or outside research/corpus: " + str(relative))
    data = path.read_bytes()
    if not data.startswith(b"%PDF-"):
        raise ValueError("Selected artifact is not a PDF: " + str(relative))
    digest = hashlib.sha256(data).hexdigest()
    if digest != spec["sha256"]:
        raise ValueError("Selected PDF SHA-256 differs: " + spec["paper_id"])
    doc = pymupdf.open(path)
    if not doc.page_count:
        raise ValueError("Empty PDF: " + spec["paper_id"])
    return path, data, doc, digest


def evidence_for(spec, paper, doc):
    pn = spec["page"]
    if not isinstance(pn, int) or not 1 <= pn <= doc.page_count:
        raise ValueError("Invalid evidence page: " + spec["id"])
    page = doc[pn - 1]
    lines = [line for block in page.get_text("dict")["blocks"] if "lines" in block for line in block["lines"]]
    indices = spec["line_indices"]
    if not indices or any(not isinstance(i, int) or i < 0 or i >= len(lines) for i in indices):
        raise ValueError("Invalid evidence line indices: " + spec["id"])
    selected = [lines[i] for i in indices]
    quote = "\n".join("".join(span["text"] for span in line["spans"]) for line in selected)
    bboxes = [[round(v, 4) for v in line["bbox"]] for line in selected]
    if not quote.strip() or any(not (0 <= b[0] < b[2] <= page.rect.width + .01 and 0 <= b[1] < b[3] <= page.rect.height + .01) for b in bboxes):
        raise ValueError("Empty/out-of-bounds evidence: " + spec["id"])
    if spec.get("expected_excerpt") and normalized(spec["expected_excerpt"]) not in normalized(quote):
        raise ValueError("Expected excerpt absent from selected PDF lines: " + spec["id"])
    return {"id": spec["id"], "paper_id": paper["paper_id"], "artifact_path": paper["pdf"]["artifact_path"],
            "sha256": paper["pdf"]["sha256"], "page": pn,
            "width": round(page.rect.width, 4), "height": round(page.rect.height, 4),
            "title": spec["title"], "section": spec.get("section", ""), "quote": quote,
            "bboxes": bboxes, "source_url": paper["pdf"]["requested_url"],
            "method": "PyMuPDF get_text(dict); Agent-selected exact lines", "line_indices": indices,
            "validation": {"file_hash_match": True, "text_exact_to_pdf_extraction": True,
                           "bboxes_within_page": True,
                           "visual_review": spec.get("visual_review", "pending"),
                           "semantic_review": "agent_curated_not_independent_human_review"}}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("selection", type=Path)
    ap.add_argument("--check-only", action="store_true")
    args = ap.parse_args()
    selection = json.loads(args.selection.read_text())
    manifest, evidence, graph = (load_json(name) for name in ("manifest.json", "evidence.json", "propositions.json"))
    known_papers = {p["paper_id"]: p for p in manifest["papers"]}
    existing_evidence = {e["id"]: e for e in evidence["evidence"]}
    known_entities = {e["id"]: e for e in graph["entities"]}
    known_relations = {r["id"]: r for r in graph["relations"]}
    downloads = []
    documents = {}
    for spec in selection.get("papers", []):
        if not ARXIV_RE.fullmatch(spec["arxiv_id"]) or not re.fullmatch(r"v\d+", spec["version"]):
            raise ValueError("Invalid arXiv ID/version: " + spec["paper_id"])
        path, data, doc, digest = pdf_for(spec)
        metadata_path, meta_bytes, title, date = metadata_for(spec)
        documents[spec["paper_id"]] = doc
        record = {"paper_id": spec["paper_id"], "arxiv_id": spec["arxiv_id"],
                  "version": spec["version"], "version_id": spec["arxiv_id"] + spec["version"],
                  "expected_title": spec["expected_title"], "verified_title": title,
                  "citation_date": date, "version_policy": "fixed selected version; not claimed latest",
                  "metadata_verification": "arxiv versioned abstract metadata retrieved",
                  "license_urls": sorted(set(re.findall(rb'href="(https?://creativecommons\.org/[^\"]+)"', meta_bytes.decode("utf-8", errors="replace").encode()))),
                  "metadata": {"requested_url": "https://arxiv.org/abs/" + spec["arxiv_id"] + spec["version"],
                               "artifact_path": str(metadata_path.relative_to(ROOT)),
                               "status": "downloaded", "sha256": hashlib.sha256(meta_bytes).hexdigest(), "bytes": len(meta_bytes)},
                  "pdf": {"requested_url": "https://arxiv.org/pdf/" + spec["arxiv_id"] + spec["version"],
                          "artifact_path": str(path.relative_to(ROOT)), "status": "downloaded",
                          "sha256": digest, "bytes": len(data), "pages": doc.page_count,
                          "parse_status": "opened_and_text_extracted"}}
        record["license_urls"] = [v.decode() for v in record["license_urls"]]
        if record["paper_id"] in known_papers:
            old = known_papers[record["paper_id"]]
            if old["version_id"] != record["version_id"] or old["pdf"]["sha256"] != digest:
                raise ValueError("Existing paper identity/version differs: " + record["paper_id"])
            documents[record["paper_id"]] = doc
        else:
            manifest["papers"].append(record)
            known_papers[record["paper_id"]] = record
            downloads.append((metadata_path, meta_bytes))
    new_evidence = []
    for spec in selection.get("evidence", []):
        pid = spec["paper_id"]
        if pid not in known_papers:
            raise ValueError("Evidence references unknown paper: " + spec["id"])
        doc = documents.get(pid)
        if doc is None:
            doc = pymupdf.open(ROOT / known_papers[pid]["pdf"]["artifact_path"])
            documents[pid] = doc
        anchor = evidence_for(spec, known_papers[pid], doc)
        if spec["id"] in existing_evidence:
            old = existing_evidence[spec["id"]]
            if (old["sha256"], old["page"], old["quote"]) != (anchor["sha256"], anchor["page"], anchor["quote"]):
                raise ValueError("Existing evidence identity differs: " + spec["id"])
        else:
            evidence["evidence"].append(anchor)
            existing_evidence[spec["id"]] = anchor
            new_evidence.append(anchor["id"])
    for entity in selection.get("entities", []):
        if not set(entity.get("paper_ids", [])) <= set(known_papers) or not set(entity.get("source_ids", [])) <= set(existing_evidence):
            raise ValueError("Entity has missing paper/evidence: " + entity["id"])
        if entity["id"] in known_entities:
            if entity != known_entities[entity["id"]]:
                raise ValueError("Existing entity differs: " + entity["id"])
        else:
            graph["entities"].append(entity)
            known_entities[entity["id"]] = entity
    for relation in selection.get("relations", []):
        if relation["source"] not in known_entities or relation["target"] not in known_entities or not set(relation.get("source_ids", [])) <= set(existing_evidence):
            raise ValueError("Relation has missing endpoint/evidence: " + relation["id"])
        if not relation.get("source_ids") or relation.get("basis") not in ("explicit", "derived", "unresolved"):
            raise ValueError("Relation lacks evidence/status: " + relation["id"])
        if relation["id"] in known_relations:
            if relation != known_relations[relation["id"]]:
                raise ValueError("Existing relation differs: " + relation["id"])
        else:
            graph["relations"].append(relation)
            known_relations[relation["id"]] = relation
    for key in ("conflicts", "negative_examples"):
        existing = {row["id"]: row for row in graph.get(key, [])}
        for row in selection.get(key, []):
            if not set(row.get("source_ids", [])) <= set(existing_evidence):
                raise ValueError("Conflict/negative case lacks evidence: " + row["id"])
            if row["id"] in existing:
                if row != existing[row["id"]]:
                    raise ValueError("Existing conflict/negative case differs: " + row["id"])
            else:
                graph.setdefault(key, []).append(row)
    summary = {"selected_papers": len(selection.get("papers", [])), "new_papers": len(downloads),
               "new_evidence": len(new_evidence), "total_papers": len(known_papers),
               "total_evidence": len(existing_evidence), "total_entities": len(known_entities),
               "total_relations": len(known_relations), "check_only": args.check_only}
    if not args.check_only:
        for path, body in downloads:
            path.write_bytes(body)
        evidence["generated_at"] = datetime.now(timezone.utc).isoformat()
        graph["coverage"] = selection.get("coverage", graph.get("coverage", ""))
        for name, value in (("manifest.json", manifest), ("evidence.json", evidence), ("propositions.json", graph)):
            write_json_atomic(CORPUS / name, value)
        write_json_atomic(ROOT / "research/integration-validation.json", summary)
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
