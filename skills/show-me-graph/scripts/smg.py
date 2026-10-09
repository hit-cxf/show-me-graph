#!/usr/bin/env python3
"""Small, dependency-free client for the Show Me Graph local knowledge API."""

import argparse
import json
import os
import sys
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen


RESOURCES = ("papers", "entities", "relations", "evidence", "conflicts",
             "negative_examples", "notes", "tags", "groups")


def payload(path):
    try:
        raw = sys.stdin.read() if path == "-" else Path(path).read_text(encoding="utf-8")
        value = json.loads(raw)
    except (OSError, ValueError) as exc:
        raise ValueError(f"Cannot read JSON payload: {exc}") from exc
    if not isinstance(value, dict):
        raise ValueError("Payload must be a JSON object")
    return value


def request(base, method, endpoint, body=None, if_match=None, timeout=20):
    headers = {"Accept": "application/json"}
    data = None
    if body is not None:
        headers["Content-Type"] = "application/json; charset=utf-8"
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
    if if_match is not None:
        headers["If-Match"] = f'"{if_match}"'
    req = Request(base.rstrip("/") + endpoint, data=data, headers=headers, method=method)
    try:
        with urlopen(req, timeout=timeout) as response:
            raw = response.read()
            return json.loads(raw) if raw else {"status": response.status}
    except HTTPError as exc:
        raw = exc.read().decode("utf-8", "replace")
        try:
            detail = json.loads(raw)
        except ValueError:
            detail = {"error": raw or exc.reason}
        raise RuntimeError(json.dumps({"http_status": exc.code, "response": detail}, ensure_ascii=False)) from exc
    except URLError as exc:
        raise RuntimeError(f"Cannot reach Show Me Graph at {base}: {exc.reason}") from exc


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default=os.environ.get("SMG_BASE_URL", "http://127.0.0.1:4317"),
                        help="Show Me Graph service URL (default: http://127.0.0.1:4317)")
    parser.add_argument("--timeout", type=float, default=20, help="Request timeout in seconds")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("health", help="Check service stage and write capability")
    commands.add_parser("snapshot", help="Read the whole knowledge snapshot and revision")
    commands.add_parser("get-state", help="Read shared paper selection and active group")
    commands.add_parser("get-preferences", help="Read shared knowledge-maintenance preferences")
    commands.add_parser("manifest", help="Read the compatibility paper manifest")
    commands.add_parser("graph", help="Read the compatibility entity and relation graph")
    list_cmd = commands.add_parser("list", help="List records in one resource")
    list_cmd.add_argument("resource", choices=RESOURCES)
    get_cmd = commands.add_parser("get", help="Read one record")
    get_cmd.add_argument("resource", choices=RESOURCES)
    get_cmd.add_argument("id")
    ev_cmd = commands.add_parser("locate", help="Validate evidence and get the local PDF URL")
    ev_cmd.add_argument("evidence_id")
    for name in ("create", "patch", "delete"):
        cmd = commands.add_parser(name, help=f"{name.capitalize()} a knowledge record")
        cmd.add_argument("resource", choices=RESOURCES)
        if name != "create":
            cmd.add_argument("id")
        if name != "delete":
            cmd.add_argument("--file", required=True, metavar="JSON_PATH_OR_-", help="JSON object file or - for stdin")
        cmd.add_argument("--if-match", metavar="REVISION", help="Optimistic concurrency revision")
    state_cmd = commands.add_parser("state", help="Set the shared paper selection/group")
    state_cmd.add_argument("--file", required=True, metavar="JSON_PATH_OR_-")
    state_cmd.add_argument("--if-match", metavar="REVISION")
    preferences_cmd = commands.add_parser("preferences", help="Set the user-requested maintenance prompt")
    preferences_cmd.add_argument("--file", required=True, metavar="JSON_PATH_OR_-",
                                 help='JSON object with maintenance_prompt; empty string clears it')
    preferences_cmd.add_argument("--if-match", required=True, metavar="REVISION",
                                 help="Revision from a fresh snapshot or get-preferences read")
    batch_cmd = commands.add_parser("batch", help="Submit an atomic multi-resource change")
    batch_cmd.add_argument("--file", required=True, metavar="JSON_PATH_OR_-")
    args = parser.parse_args()

    endpoint = "/api/knowledge"
    method = "GET"
    body = None
    if args.command == "health":
        endpoint = "/api/health"
    elif args.command == "get-state":
        endpoint += "/state"
    elif args.command == "get-preferences":
        endpoint += "/preferences"
    elif args.command == "manifest":
        endpoint = "/api/manifest"
    elif args.command == "graph":
        endpoint = "/api/graph"
    elif args.command == "list":
        endpoint += "/" + args.resource
    elif args.command == "get":
        endpoint += "/" + args.resource + "/" + quote(args.id, safe="")
    elif args.command == "locate":
        endpoint = "/api/evidence/" + quote(args.evidence_id, safe="")
    elif args.command in ("create", "patch", "delete"):
        endpoint += "/" + args.resource
        if args.command != "create":
            endpoint += "/" + quote(args.id, safe="")
        method = {"create": "POST", "patch": "PATCH", "delete": "DELETE"}[args.command]
        if args.command != "delete":
            body = payload(args.file)
    elif args.command == "state":
        endpoint += "/state"
        method = "PUT"
        body = payload(args.file)
    elif args.command == "preferences":
        endpoint += "/preferences"
        method = "PUT"
        body = payload(args.file)
    elif args.command == "batch":
        endpoint += "/batch"
        method = "POST"
        body = payload(args.file)

    try:
        result = request(args.base, method, endpoint, body,
                         getattr(args, "if_match", None), args.timeout)
        print(json.dumps(result, ensure_ascii=False, indent=2))
    except (RuntimeError, ValueError) as exc:
        print(str(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
