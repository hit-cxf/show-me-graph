#!/usr/bin/env python3
"""Idempotently add fixed-version corpus PDFs as Zotero child attachments.

Uses only Zotero 10's official local API and its three-phase full-upload flow.
The local authorization key is kept in memory, never logged or persisted.
Run zotero-m0.py apply for paper metadata/collection membership first.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import Request

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
spec = importlib.util.spec_from_file_location("zotero_m0", HERE / "zotero-m0.py")
z = importlib.util.module_from_spec(spec)
spec.loader.exec_module(z)


def attachment_key(client, paper):
    alphabet = "23456789ABCDEFGHIJKLMNPQRSTUVWXYZ"
    digest = hashlib.sha256(("show-me-graph:attachment:" + client.server_id + ":arxiv:" + paper["version_id"]).encode()).digest()
    number = int.from_bytes(digest[:5], "big")
    return "".join(alphabet[(number >> (5 * i)) & 31] for i in range(8))


def checked_pdf(paper):
    pdf = paper.get("pdf", {})
    if pdf.get("status") != "downloaded" or not pdf.get("sha256"):
        raise z.Failure("Fixed-version PDF unavailable for " + paper["paper_id"])
    path = (ROOT / pdf["artifact_path"]).resolve()
    if not any(path.is_relative_to(ROOT / part) for part in ("experiments/corpus", "research/corpus")) or not path.is_file():
        raise z.Failure("PDF path is absent or outside allowed corpus")
    data = path.read_bytes()
    if not data.startswith(b"%PDF-") or hashlib.sha256(data).hexdigest() != pdf["sha256"]:
        raise z.Failure("PDF bytes differ from manifest for " + paper["paper_id"])
    return path, data


def attachment_state(client, paper, parent_key, md5):
    key = attachment_key(client, paper)
    try:
        existing, _ = client.get("users/0/items/" + key)
    except z.ApiError as error:
        if error.status != 404:
            raise
        existing = None
    if existing:
        row = existing["data"]
        if row.get("itemType") != "attachment" or row.get("parentItem") != parent_key or row.get("linkMode") != "imported_file":
            raise z.Failure("Deterministic attachment-key collision")
        if row.get("md5") and row["md5"].lower() != md5:
            raise z.Failure("Existing fixed-version attachment has different bytes; refusing overwrite")
        return key, "already_attached" if row.get("md5", "").lower() == md5 else "resume_upload"
    rows, headers = client.get("users/0/items/" + parent_key + "/children", format="json", limit=100)
    if len(rows) >= 100 or int(headers.get("Total-Results", len(rows))) > 100:
        raise z.Failure("Child attachments truncated; cannot safely check duplicates")
    for child in rows:
        row = child["data"]
        if row.get("itemType") == "attachment" and row.get("contentType") == "application/pdf" and str(row.get("md5", "")).lower() == md5:
            return child["key"], "already_attached"
    return key, "create_and_upload"


def plan_one(client, paper, collection_key):
    path, data = checked_pdf(paper)
    parent = z.find_existing(client, paper)
    if not parent or collection_key not in parent["data"].get("collections", []):
        raise z.Failure("Metadata item is missing from target collection: " + paper["paper_id"])
    md5 = hashlib.md5(data).hexdigest()
    key, action = attachment_state(client, paper, parent["key"], md5)
    return {"paper_id": paper["paper_id"], "parent_item": parent["key"], "attachment_item": key,
            "action": action, "filename": path.name, "bytes": len(data), "md5": md5,
            "mtime_ms": path.stat().st_mtime_ns // 1_000_000}, data


def form_post(client, route, form, if_none_match="*"):
    if not client.secret:
        raise z.Failure("No in-memory Zotero authorization")
    if not route.startswith("users/0/items/") or not route.endswith("/file"):
        raise z.Failure("Invalid attachment route")
    headers = {"Zotero-API-Version": "3", "Zotero-Server-ID": client.server_id,
               "Zotero-API-Key": client.secret, "Content-Type": "application/x-www-form-urlencoded",
               "If-None-Match": if_none_match}
    try:
        with client.opener.open(Request(client.base + route, data=urlencode(form).encode(),
                                        headers=headers, method="POST"), timeout=120) as response:
            body = response.read()
            if response.headers.get("Zotero-Server-ID") != client.server_id:
                raise z.Failure("Zotero server identity changed during PDF upload")
            return json.loads(body) if body else None
    except HTTPError as error:
        error.close()
        raise z.ApiError(error.code, route) from None
    except (URLError, TimeoutError):
        raise z.Failure("Zotero upload request timed out; rerun plan before retrying") from None


def create_attachment(client, row, paper):
    parent, headers = client.get("users/0/items/" + row["parent_item"])
    version = headers.get("Last-Modified-Version")
    if not version or parent["key"] != row["parent_item"]:
        raise z.Failure("Parent changed before attachment creation")
    payload = {"itemType": "attachment", "key": row["attachment_item"],
               "parentItem": row["parent_item"], "linkMode": "imported_file",
               "title": paper["verified_title"] + " (arXiv " + paper["version_id"] + " PDF)",
               "accessDate": "", "url": "", "note": "", "contentType": "application/pdf",
               "charset": "", "filename": row["filename"], "md5": None, "mtime": None,
               "tags": [], "relations": {}}
    response, _ = client.request("POST", "users/0/items", [payload],
                                  headers={"If-Unmodified-Since-Version": str(version)})
    if not isinstance(response, dict) or response.get("failed") or "0" not in response.get("successful", {}):
        raise z.Failure("Attachment item create was not acknowledged; reconcile before retrying")
    created, _ = client.get("users/0/items/" + row["attachment_item"])
    if created["data"].get("parentItem") != row["parent_item"] or created["data"].get("linkMode") != "imported_file":
        raise z.Failure("Attachment parent/link mode not verified")


def upload_file(client, row, data):
    route = "users/0/items/" + row["attachment_item"] + "/file"
    auth = form_post(client, route, {"md5": row["md5"], "filename": row["filename"],
                                    "filesize": str(len(data)), "mtime": str(row["mtime_ms"])})
    if auth == {"exists": 1}:
        pass
    else:
        if not isinstance(auth, dict):
            raise z.Failure("Invalid upload authorization")
        upload_url = auth.get("url", "")
        parts = urlsplit(upload_url)
        if parts.scheme != "http" or parts.hostname not in {"127.0.0.1", "localhost", "::1"} or parts.port != 23119 or not parts.path.startswith("/api/local/uploads/") or parts.query or parts.fragment or parts.username or parts.password:
            raise z.Failure("Refusing non-local or unexpected Zotero upload URL")
        prefix, suffix, upload_key = auth.get("prefix"), auth.get("suffix"), auth.get("uploadKey")
        if not all(isinstance(v, str) for v in (prefix, suffix, upload_key)) or not upload_key:
            raise z.Failure("Malformed Zotero upload authorization")
        try:
            with client.opener.open(Request(upload_url, data=prefix.encode() + data + suffix.encode(),
                                            headers={"Content-Type": auth.get("contentType", "application/octet-stream")},
                                            method="POST"), timeout=180) as response:
                response.read()
                if response.status != 201:
                    raise z.Failure("Zotero did not acknowledge PDF byte upload")
        except HTTPError as error:
            error.close()
            raise z.ApiError(error.code, "local/uploads/<redacted>") from None
        except (URLError, TimeoutError):
            raise z.Failure("PDF byte upload timed out; rerun plan before retrying") from None
        form_post(client, route, {"upload": upload_key})
    item, _ = client.get("users/0/items/" + row["attachment_item"])
    if item["data"].get("parentItem") != row["parent_item"] or str(item["data"].get("md5", "")).lower() != row["md5"]:
        raise z.Failure("Zotero attachment hash/parent read-back failed")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("plan", "apply"))
    parser.add_argument("--collection-key", required=True)
    parser.add_argument("--manifest", type=Path, default=z.DEFAULT_MANIFEST)
    parser.add_argument("--paper", action="append")
    args = parser.parse_args()
    try:
        if not z.KEY_RE.fullmatch(args.collection_key):
            raise z.Failure("Invalid collection key")
        client = z.Client()
        client.get("users/0/collections/" + args.collection_key)
        papers = z.load_papers(args.manifest, args.paper)
        planned = [plan_one(client, paper, args.collection_key)[0] for paper in papers]
        if args.mode == "plan":
            result = {"mode": "plan", "read_only": True, "papers": planned}
        else:
            if any(row["action"] != "already_attached" for row in planned):
                client.authorize()
            results = []
            try:
                for paper in papers:
                    row, data = plan_one(client, paper, args.collection_key)
                    if row["action"] == "create_and_upload":
                        create_attachment(client, row, paper)
                    if row["action"] != "already_attached":
                        upload_file(client, row, data)
                    results.append({"paper_id": row["paper_id"], "action": row["action"],
                                    "attachment_item": row["attachment_item"], "status": "hash_and_parent_verified"})
            finally:
                client.secret = None
            result = {"mode": "apply", "papers": results}
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except (z.Failure, OSError, ValueError, KeyError) as error:
        print(json.dumps({"error": str(error)}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
