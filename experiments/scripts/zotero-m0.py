#!/usr/bin/env python3
"""Zotero 10 Local API M0: read-only probe/plan and explicitly invoked apply.

Python standard library only. No SQLite access, credential files, remote writes,
or automatic target collection. PDF attachment upload is not implemented.
"""
import argparse
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler, ProxyHandler

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_MANIFEST = ROOT / "experiments/corpus/manifest.json"
KEY_RE = re.compile(r"[23456789ABCDEFGHIJKLMNPQRSTUVWXYZ]{8}\Z")
ARXIV_RE = re.compile(r"(?<!\d)(\d{4}\.\d{4,5})(?:v\d+)?(?!\d)", re.I)


class Failure(Exception):
    pass


class ApiError(Failure):
    def __init__(self, status, route):
        self.status = status
        super().__init__(f"Local API HTTP {status} at {route.split('?')[0]}; no response body or credentials logged")


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise Failure("Local API redirect refused")


class Client:
    def __init__(self, base="http://127.0.0.1:23119/api/"):
        parts = urlsplit(base)
        if parts.scheme != "http" or parts.hostname not in {"127.0.0.1", "localhost", "::1"} or parts.port != 23119 or parts.path != "/api/" or parts.query or parts.fragment or parts.username:
            raise Failure("Only the local Zotero /api/ endpoint on port 23119 is supported")
        self.base = base
        self.server_id = None
        self.secret = None
        self.opener = build_opener(ProxyHandler({}), NoRedirect())
        _, self.info = self.request("GET", "", raw=True)
        self.server_id = self.info.get("Zotero-Server-ID")
        if not self.server_id:
            raise Failure("Zotero-Server-ID missing; this adapter requires Zotero 10+")

    def request(self, method, route, payload=None, headers=None, raw=False, timeout=15):
        if route.startswith(("/", "http:" ,"https:")) or ".." in route.split("?")[0]:
            raise Failure("Invalid local API route")
        request_headers = {"Zotero-API-Version": "3"}
        if self.server_id:
            request_headers["Zotero-Server-ID"] = self.server_id
        if headers:
            request_headers.update(headers)
        if method != "GET":
            if not self.server_id:
                raise Failure("Writes require a pinned server identity")
            request_headers["Content-Type"] = "application/json"
            if route != "local/authorize":
                if not self.secret:
                    raise Failure("No in-memory local authorization key")
                request_headers["Zotero-API-Key"] = self.secret
        data = None if payload is None else json.dumps(payload).encode()
        try:
            with self.opener.open(Request(self.base + route, data=data, headers=request_headers, method=method), timeout=timeout) as response:
                body = response.read()
                observed = response.headers.get("Zotero-Server-ID")
                if self.server_id and observed != self.server_id:
                    raise Failure("Zotero server identity changed; discard this plan and rerun")
                return (body.decode() if raw else (json.loads(body) if body else None)), response.headers
        except HTTPError as error:
            error.close()
            raise ApiError(error.code, route) from None
        except (URLError, TimeoutError):
            raise Failure("Local API unavailable or timed out; for an apply timeout rerun plan to reconcile before retrying") from None

    def get(self, route, **query):
        return self.request("GET", route + ("?" + urlencode(query) if query else ""))

    def authorize(self):
        # The response and key must never be printed, persisted, or put in a URL.
        print("Zotero will ask to authorize Show Me Graph M0; the key stays in memory.", file=sys.stderr)
        result, _ = self.request("POST", "local/authorize", {"appName": "Show Me Graph M0"}, timeout=300)
        key = result.get("key") if isinstance(result, dict) else None
        if not isinstance(key, str) or len(key) != 32:
            raise Failure("No valid local authorization key returned")
        self.secret = key


class CitationMeta(HTMLParser):
    def __init__(self):
        super().__init__()
        self.values = {}

    def handle_starttag(self, tag, attrs):
        if tag.lower() == "meta":
            attrs = dict(attrs)
            name = attrs.get("name", "").lower()
            if name.startswith("citation_"):
                self.values.setdefault(name, []).append(attrs.get("content", ""))


def normalized_title(value):
    return "".join(ch for ch in value.casefold() if ch.isalnum())


def identity_matches(data, paper):
    fields = " ".join(str(data.get(k, "")) for k in ("archiveID", "url", "DOI", "extra"))
    ids = set(ARXIV_RE.findall(fields))
    if ids:
        return paper["arxiv_id"] in ids
    return normalized_title(data.get("title", "")) == normalized_title(paper["verified_title"])


def stable_item_key(server_id, paper):
    alphabet = "23456789ABCDEFGHIJKLMNPQRSTUVWXYZ"
    digest = hashlib.sha256(("show-me-graph:m0:" + server_id + ":arxiv:" + paper["arxiv_id"]).encode()).digest()
    number = int.from_bytes(digest[:5], "big")
    return "".join(alphabet[(number >> (5 * i)) & 31] for i in range(8))


def load_papers(manifest, selected):
    papers = json.loads(Path(manifest).read_text())["papers"]
    if selected:
        unknown = set(selected) - {p["paper_id"] for p in papers}
        if unknown:
            raise Failure("Unknown paper id: " + ", ".join(sorted(unknown)))
        papers = [p for p in papers if p["paper_id"] in selected]
    if not 1 <= len(papers) <= 50 or len({p["arxiv_id"] for p in papers}) != len(papers):
        raise Failure("Require 1–50 distinct arXiv papers per run")
    for paper in papers:
        if not paper.get("verified_title") or not re.fullmatch(r"\d{4}\.\d{4,5}", paper["arxiv_id"]):
            raise Failure("Manifest has missing verified title or unsupported arXiv ID")
    return papers


def new_metadata(paper, collection, supported_fields):
    parser = CitationMeta()
    metadata_path = (ROOT / paper["metadata"]["artifact_path"]).resolve()
    if not metadata_path.is_relative_to(ROOT / "experiments/corpus"):
        raise Failure("Metadata source must be in experiments/corpus")
    parser.feed(metadata_path.read_text())
    meta = parser.values
    first = lambda key: next(iter(meta.get(key, [])), "")
    if normalized_title(first("citation_title")) != normalized_title(paper["verified_title"]):
        raise Failure("Local abstract metadata title differs from manifest")
    fields = {
        "title": paper["verified_title"],
        "date": paper["citation_date"].replace("/", "-"),
        "repository": "arXiv",
        "archiveID": paper["arxiv_id"],
        "url": "https://arxiv.org/abs/" + paper["version_id"],
        "DOI": first("citation_doi"),
        "rights": "; ".join(paper.get("license_urls", [])),
        "extra": "arXiv: " + paper["version_id"] + "\nSource: Show Me Graph M0 versioned corpus",
    }
    unsupported = set(fields) - supported_fields
    if unsupported:
        raise Failure("Local preprint schema lacks fields: " + ", ".join(sorted(unsupported)))
    return {
        "itemType": "preprint", **fields,
        "creators": [{"creatorType": "author", "name": name} for name in meta.get("citation_author", [])],
        "tags": [], "collections": [collection], "relations": {},
    }


def find_existing(client, paper):
    candidates = {}
    reserved = stable_item_key(client.server_id, paper)
    try:
        existing, _ = client.get("users/0/items/" + reserved)
    except ApiError as error:
        if error.status != 404:
            raise
    else:
        if not identity_matches(existing["data"], paper):
            raise Failure("Deterministic item-key collision; refusing to overwrite")
        candidates[existing["key"]] = existing
    # Narrow server-side searches only; never fetch the entire library.
    for term, mode in [(paper["arxiv_id"], "everything"), (paper["verified_title"], "titleCreatorYear")]:
        rows, headers = client.get("users/0/items/top", q=term, qmode=mode, format="json", limit=50)
        if len(rows) >= 50 or int(headers.get("Total-Results", len(rows))) > 50:
            raise Failure("Search result truncated; narrow duplicate resolution before applying")
        for row in rows:
            if row["data"].get("itemType") not in {"attachment", "note", "annotation"} and identity_matches(row["data"], paper):
                candidates[row["key"]] = row
    if len(candidates) > 1:
        raise Failure("Multiple matching Zotero items for " + paper["paper_id"] + ": " + ", ".join(sorted(candidates)))
    return next(iter(candidates.values()), None)


def make_plan(client, collection_key, papers):
    if not KEY_RE.fullmatch(collection_key):
        raise Failure("Invalid collection key")
    collection, headers = client.get("users/0/collections/" + collection_key)
    library_version = headers.get("Last-Modified-Version")
    if library_version is None:
        raise Failure("Missing local library version; cannot safely apply")
    field_rows, _ = client.get("itemTypeFields", itemType="preprint")
    fields = {row["field"] for row in field_rows}
    plan = {"mode": "plan", "read_only": True, "collection": {"key": collection_key, "name": collection["data"]["name"]}, "library_version": int(library_version), "pdf_upload": "not_implemented", "papers": []}
    payloads = []
    for paper in papers:
        existing = find_existing(client, paper)
        entry = {"paper_id": paper["paper_id"], "title": paper["verified_title"], "arxiv_id": paper["arxiv_id"]}
        if existing:
            data = existing["data"]
            current = data.get("collections", [])
            entry.update(item_key=existing["key"], action="unchanged" if collection_key in current else "add_collection", collections_before=current, collections_after=list(dict.fromkeys(current + [collection_key])), existing_children=existing.get("meta", {}).get("numChildren"))
            if entry["action"] != "unchanged":
                payloads.append({"key": existing["key"], "version": data["version"], "collections": entry["collections_after"]})
        else:
            data = new_metadata(paper, collection_key, fields)
            data["key"] = stable_item_key(client.server_id, paper)
            entry.update(item_key=data["key"], action="create_preprint", collections_before=[], collections_after=[collection_key], metadata={"date": data["date"], "url": data["url"], "author_count": len(data["creators"]), "DOI": data["DOI"]})
            payloads.append(data)
        plan["papers"].append(entry)
    plan["write_count"] = len(payloads)
    return plan, payloads


def apply_plan(client, collection_key, papers):
    plan, payloads = make_plan(client, collection_key, papers)
    if not payloads:
        return {**plan, "mode": "apply", "read_only": False, "status": "already_present_no_write"}
    client.authorize()
    # Re-read after the user has spent time in the authorization dialog.
    plan, payloads = make_plan(client, collection_key, papers)
    if not payloads:
        client.secret = None
        return {**plan, "mode": "apply", "read_only": False, "status": "already_present_no_write"}
    try:
        response, _ = client.request("POST", "users/0/items", payloads, headers={"If-Unmodified-Since-Version": str(plan["library_version"])})
    finally:
        client.secret = None
    if not isinstance(response, dict):
        raise Failure("Unexpected write response; rerun plan to reconcile")
    failures = response.get("failed", {})
    if failures:
        codes = {i: entry.get("code") for i, entry in failures.items()}
        raise Failure("Some writes failed (successful entries may already exist); rerun plan. Failed index/status: " + json.dumps(codes))
    successful = response.get("successful", response.get("success", {}))
    acknowledged = set(successful) | set(response.get("unchanged", {}))
    if acknowledged != {str(i) for i in range(len(payloads))}:
        raise Failure("Incomplete write acknowledgement; rerun plan to reconcile")
    # A 200 alone is not proof of the desired collection membership.
    for entry in plan["papers"]:
        row, _ = client.get("users/0/items/" + entry["item_key"])
        if not set(entry["collections_after"]).issubset(set(row["data"].get("collections", []))):
            raise Failure("Read-back did not preserve expected collection memberships")
    return {**plan, "mode": "apply", "read_only": False, "status": "metadata_membership_verified", "applied_count": len(payloads)}


def probe(client, parent=None):
    route = "users/0/collections/top" if parent is None else "users/0/collections/" + parent + "/collections"
    if parent is not None and not KEY_RE.fullmatch(parent):
        raise Failure("Invalid parent collection key")
    rows, _ = client.get(route, format="json", limit=100)
    return {"zotero_version": client.info.get("X-Zotero-Version"), "api_version": client.info.get("Zotero-API-Version"), "schema_version": client.info.get("Zotero-Schema-Version"), "collections": [{"key": row["key"], "name": row["data"]["name"], "parent": row["data"].get("parentCollection")} for row in rows], "limit": 100}


def ensure_collection(client, parent_key, name):
    """Create one named child if absent, then verify its parent by read-back."""
    if not KEY_RE.fullmatch(parent_key) or not name or name.strip() != name or len(name) > 100:
        raise Failure("Invalid parent collection key or child name")

    def inspect():
        parent, headers = client.get("users/0/collections/" + parent_key)
        rows, list_headers = client.get("users/0/collections/" + parent_key + "/collections", format="json", limit=100)
        if len(rows) >= 100 or int(list_headers.get("Total-Results", len(rows))) > 100:
            raise Failure("Child collection list truncated; cannot safely check duplicates")
        matches = [row for row in rows if row["data"].get("name") == name and row["data"].get("parentCollection") == parent_key]
        if len(matches) > 1:
            raise Failure("Multiple child collections have the requested name")
        version = headers.get("Last-Modified-Version")
        if version is None:
            raise Failure("Missing local library version; cannot safely create collection")
        return parent, matches[0] if matches else None, int(version)

    parent, existing, _ = inspect()
    if existing:
        return {"status": "already_present_no_write", "parent": {"key": parent_key, "name": parent["data"]["name"]}, "collection": {"key": existing["key"], "name": name}}
    client.authorize()
    try:
        parent, existing, version = inspect()
        if existing:
            result_key = existing["key"]
            status = "already_present_no_write"
        else:
            response, _ = client.request("POST", "users/0/collections", [{"name": name, "parentCollection": parent_key}], headers={"If-Unmodified-Since-Version": str(version)})
            if not isinstance(response, dict) or response.get("failed"):
                raise Failure("Collection create was not acknowledged; inspect Zotero before retrying")
            created = response.get("successful", {}).get("0")
            result_key = created.get("key") if isinstance(created, dict) else None
            if not result_key or not KEY_RE.fullmatch(result_key):
                raise Failure("Collection key missing from acknowledgement; inspect Zotero before retrying")
            status = "created_and_verified"
        row, _ = client.get("users/0/collections/" + result_key)
        if row["data"].get("name") != name or row["data"].get("parentCollection") != parent_key:
            raise Failure("Created collection did not match requested parent/name")
        return {"status": status, "parent": {"key": parent_key, "name": parent["data"]["name"]}, "collection": {"key": result_key, "name": name}}
    finally:
        client.secret = None


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:23119/api/")
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("probe", help="Read version and collection names only")
    p.add_argument("--parent-key")
    p = sub.add_parser("ensure-collection", help="Create a child collection only if absent; Zotero prompts for write authorization")
    p.add_argument("--parent-key", required=True)
    p.add_argument("--name", required=True)
    for command in ("plan", "apply"):
        p = sub.add_parser(command, help="Read-only plan" if command == "plan" else "Authorize in Zotero and apply metadata/collection changes")
        p.add_argument("--collection-key", required=True)
        p.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
        p.add_argument("--paper", action="append", help="Manifest paper_id; may be repeated; default all papers")
        if command == "plan":
            p.add_argument("--show-payload", action="store_true", help="Include complete public bibliographic write payload; no secret")
    args = parser.parse_args(argv)
    try:
        client = Client(args.base_url)
        if args.command == "probe":
            result = probe(client, args.parent_key)
        elif args.command == "ensure-collection":
            result = ensure_collection(client, args.parent_key, args.name)
        else:
            papers = load_papers(args.manifest, args.paper)
            if args.command == "plan":
                result, payload = make_plan(client, args.collection_key, papers)
                if args.show_payload:
                    result["payload"] = payload
            else:
                result = apply_plan(client, args.collection_key, papers)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except (Failure, OSError, ValueError, KeyError) as error:
        # Never dump HTTP request objects, headers, API responses, or tracebacks.
        print(json.dumps({"error": str(error)}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
