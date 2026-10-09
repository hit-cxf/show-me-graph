#!/usr/bin/env python3
"""Combine independently checked deep-research graph selections without losing provenance."""
import argparse
import json
from pathlib import Path


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("output", type=Path)
    ap.add_argument("fragments", type=Path, nargs="+")
    args = ap.parse_args()
    merged = {"schema_version": "0.1", "coverage": "Qwen-Image-2.0 focused deep investigation: selected direct technical lineage, post-publication reports and evaluation caveats; not the entire image-generation field.",
              "source_fragments": [str(p) for p in args.fragments]}
    for key in ("papers", "evidence", "entities", "relations", "conflicts", "negative_examples"):
        merged[key] = []
        seen = {}
        for fragment in args.fragments:
            payload = json.loads(fragment.read_text())
            for item in payload.get(key, []):
                ident = item["paper_id"] if key == "papers" else item["id"]
                if ident in seen:
                    if item != seen[ident]:
                        raise ValueError(f"Conflicting {key} identity: {ident}")
                    continue
                seen[ident] = item
                merged[key].append(item)
    args.output.write_text(json.dumps(merged, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({key: len(merged[key]) for key in ("papers", "evidence", "entities", "relations", "conflicts", "negative_examples")}))


if __name__ == "__main__":
    main()
