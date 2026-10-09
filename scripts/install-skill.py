#!/usr/bin/env python3
"""Install the portable Show Me Graph skill for a local coding agent."""

import argparse
import shutil
from pathlib import Path


AGENT_DIRS = {
    "codex": ".agents/skills",
    "claude": ".claude/skills",
    "codebuddy": ".codebuddy/skills",
}
SKILL = Path(__file__).resolve().parents[1] / "skills" / "show-me-graph"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("agent", choices=AGENT_DIRS)
    parser.add_argument(
        "--project",
        type=Path,
        help="install into this project's skill directory (default: user-wide)",
    )
    args = parser.parse_args()

    root = args.project.expanduser().resolve() if args.project else Path.home()
    target = root / AGENT_DIRS[args.agent] / SKILL.name
    if target.exists() or target.is_symlink():
        if target.is_symlink() and target.resolve() == SKILL:
            print(f"Already available: {target}")
            return
        parser.error(f"{target} already exists; move it aside before installing")

    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(SKILL, target)
    print(f"Installed {args.agent} skill: {target}")
    print("Start a new agent session and ask it to use the show-me-graph skill.")


if __name__ == "__main__":
    main()
