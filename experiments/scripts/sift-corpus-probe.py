"""Run sift-kg's native pdfplumber backend on the fixed shared M0 PDF corpus.

Each subprocess has a 55-second timeout and no provider credentials. This
extracts text only; it is not an LLM/graph accuracy benchmark.
"""
from datetime import datetime, timezone
from pathlib import Path
import hashlib
import json
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "experiments/corpus/manifest.json"
ARTIFACTS = ROOT / "experiments/vendor/sift-kg/m0-artifacts/corpus"
OUTPUT = ROOT / "experiments/results/sift-corpus.json"
ARTIFACTS.mkdir(parents=True, exist_ok=True)
ENV = {
    "PATH": "/usr/bin:/bin:/usr/sbin:/sbin",
    "LANG": "en_US.UTF-8",
    "HF_HUB_OFFLINE": "1",
    "HF_HOME": str(ARTIFACTS / "hf-cache"),
    "LITELLM_LOCAL_MODEL_COST_MAP": "True",
    "PYTHONDONTWRITEBYTECODE": "1",
}
CHILD = r"""
from pathlib import Path
import json,sys,time
from sift_kg.ingest.pdfplumber_extractor import PdfPlumberExtractor
import pdfplumber
pdf=Path(sys.argv[1]); text_out=Path(sys.argv[2])
start=time.perf_counter()
result=PdfPlumberExtractor(ocr=False).extract(pdf)
elapsed=time.perf_counter()-start
text_out.write_text(result.content)
with pdfplumber.open(pdf) as diagnostic:
    pages=len(diagnostic.pages)
print(json.dumps({
    'status':'success',
    'text_characters':len(result.content),
    'non_whitespace_characters':len(''.join(result.content.split())),
    'backend_elapsed_seconds':round(elapsed,3),
    'native_pages_field_available':result.pages is not None,
    'native_pages_count':len(result.pages) if result.pages is not None else None,
    'diagnostic_pdfplumber_page_count':pages,
    'diagnostic_page_count_note':'Separate pdfplumber.open inspection, not page metadata returned by sift native backend',
    'native_metadata':result.metadata.__dict__ if result.metadata else None,
    'native_bbox_available':'bbox' in result.__dict__,
}))
"""
manifest_bytes = MANIFEST.read_bytes()
manifest = json.loads(manifest_bytes)
report = {
    "schema_version": "m0-sift-corpus-1",
    "started_at": datetime.now(timezone.utc).isoformat(),
    "scope": "Real local PDF text ingestion only; no LLM calls, no entity/relation extraction, no Zotero writes",
    "upstream_commit": "d786991c024f5401f113fc0cb70aee96dd1bd3bf",
    "sift_version": "0.9.0",
    "backend": "sift_kg.ingest.pdfplumber_extractor.PdfPlumberExtractor(ocr=False).extract",
    "manifest_path": str(MANIFEST.relative_to(ROOT)),
    "manifest_sha256": hashlib.sha256(manifest_bytes).hexdigest(),
    "timeout_per_document_seconds": 55,
    "llm_calls": 0,
    "papers": [],
}
start_all = time.perf_counter()
for paper in manifest["papers"]:
    entry = {"paper_id": paper["paper_id"], "version_id": paper["version_id"],
             "artifact_path": paper["pdf"]["artifact_path"], "manifest_pages": paper["pdf"].get("pages")}
    path = ROOT / entry["artifact_path"]
    text_out = ARTIFACTS / f"{paper['paper_id']}.txt"
    started = time.perf_counter()
    try:
        entry["sha256"] = hashlib.sha256(path.read_bytes()).hexdigest()
        entry["sha256_matches_manifest"] = entry["sha256"] == paper["pdf"]["sha256"]
        if not entry["sha256_matches_manifest"]:
            raise ValueError("Input hash differs from fixed corpus manifest")
        proc = subprocess.run([sys.executable, "-c", CHILD, str(path), str(text_out)],
                              cwd=ARTIFACTS, env=ENV, capture_output=True, text=True, timeout=55)
        entry["returncode"] = proc.returncode
        (ARTIFACTS / f"{paper['paper_id']}.log").write_text(proc.stdout + "\nSTDERR\n" + proc.stderr)
        if proc.returncode:
            entry.update(status="failed", error=proc.stderr[-2500:])
        else:
            entry.update(json.loads(proc.stdout))
            entry["text_artifact"] = str(text_out.relative_to(ROOT))
            entry["diagnostic_page_count_matches_manifest"] = entry["diagnostic_pdfplumber_page_count"] == entry["manifest_pages"]
    except subprocess.TimeoutExpired:
        entry.update(status="timeout", error="Native backend subprocess exceeded 55-second limit")
    except Exception as exc:
        entry.update(status="failed", error=str(exc))
    entry["total_elapsed_seconds"] = round(time.perf_counter()-started, 3)
    report["papers"].append(entry)
    report["summary"] = {
        "attempted": len(report["papers"]),
        "success": sum(p["status"] == "success" for p in report["papers"]),
        "failed_or_timeout": sum(p["status"] != "success" for p in report["papers"]),
        "text_characters": sum(p.get("text_characters", 0) for p in report["papers"]),
        "elapsed_seconds": round(time.perf_counter()-start_all, 3),
    }
    OUTPUT.write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(json.dumps({k:entry.get(k) for k in ["paper_id","status","text_characters","backend_elapsed_seconds","native_pages_field_available"]}), flush=True)
report["completed_at"] = datetime.now(timezone.utc).isoformat()
OUTPUT.write_text(json.dumps(report, ensure_ascii=False, indent=2))
print(json.dumps(report["summary"]), flush=True)
