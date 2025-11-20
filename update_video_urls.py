#!/usr/bin/env python3
r"""
update_video_urls.py

Read a JSON file, replace all occurrences of the old video host
"sophieassets.blob.core.windows.net/videos" (with or without scheme and with any number of slashes after
"videos") with "https://assets.iasophia.com/videos/" ensuring exactly one slash after "videos",
then write the updated content to the output path.

Supports two modes:
- text (default): Fast, regex-based replacement on the raw file text.
- json: Parse JSON and recursively transform only string values.

Usage (PowerShell):
  python C:\Users\leona\projects\Moodle-Dashboard\moodle-api-proxy\update_video_urls.py \
    --in "C:\Users\leona\Proyectos\Curso AI\production.course.json" \
    --out "C:\Users\leona\Proyectos\Curso AI\production.course-updated.json" \
    --mode text

Switch to JSON mode if you prefer a structure-aware rewrite:
  --mode json
"""

import argparse
import json
import os
import re
import sys
from typing import Any, Tuple

OLD_PREFIX_RE = re.compile(r"(?i)(?:https?://)?sophieassets\.blob\.core\.windows\.net/videos/*")
NEW_PREFIX = "https://assets.iasophia.com/videos/"


def replace_in_string(s: str) -> Tuple[str, int]:
    """Replace old host prefix in a single string, returning (new_string, replacements_count)."""
    return OLD_PREFIX_RE.subn(NEW_PREFIX, s)


def walk_json(node: Any) -> Tuple[Any, int]:
    """Recursively walk a JSON-serializable structure, replacing in strings only."""
    if isinstance(node, str):
        return replace_in_string(node)
    if isinstance(node, list):
        total = 0
        out = []
        for item in node:
            new_item, c = walk_json(item)
            out.append(new_item)
            total += c
        return out, total
    if isinstance(node, dict):
        total = 0
        out = {}
        for k, v in node.items():
            new_v, c = walk_json(v)
            out[k] = new_v
            total += c
        return out, total
    # int, float, bool, None
    return node, 0


def ensure_parent_dir(path: str) -> None:
    parent = os.path.dirname(path)
    if parent and not os.path.exists(parent):
        os.makedirs(parent, exist_ok=True)


def process_text_mode(in_path: str, out_path: str, indent: int) -> Tuple[int, int]:
    """Fast regex replacement over the raw text."""
    with open(in_path, "r", encoding="utf-8") as f:
        raw = f.read()
    before = len(OLD_PREFIX_RE.findall(raw))
    updated, replaced = OLD_PREFIX_RE.subn(NEW_PREFIX, raw)
    ensure_parent_dir(out_path)
    with open(out_path, "w", encoding="utf-8", newline="\n") as f:
        f.write(updated)
    after = len(OLD_PREFIX_RE.findall(updated))
    return before, after


def process_json_mode(in_path: str, out_path: str, indent: int) -> Tuple[int, int]:
    """Parse JSON, replace only in string values, and write pretty JSON."""
    with open(in_path, "r", encoding="utf-8") as f:
        raw = f.read()
    before = len(OLD_PREFIX_RE.findall(raw))

    data = json.loads(raw)
    updated_data, replaced = walk_json(data)

    ensure_parent_dir(out_path)
    with open(out_path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(updated_data, f, ensure_ascii=False, indent=indent)
        f.write("\n")  # ensure trailing newline

    with open(out_path, "r", encoding="utf-8") as f:
        updated_raw = f.read()
    after = len(OLD_PREFIX_RE.findall(updated_raw))
    return before, after


def main(argv) -> int:
    parser = argparse.ArgumentParser(description="Replace old video host with new host in JSON content.")
    parser.add_argument("--in", dest="in_path", default=r"C:\Users\leona\Proyectos\Curso AI\production.course.json",
                        help="Input JSON file path")
    parser.add_argument("--out", dest="out_path", default=r"C:\Users\leona\Proyectos\Curso AI\production.course-updated.json",
                        help="Output JSON file path")
    parser.add_argument("--indent", dest="indent", type=int, default=2,
                        help="Indent to use when writing JSON in --mode json (default: 2)")
    parser.add_argument("--mode", choices=["text", "json"], default="text",
                        help="Replacement mode: 'text' for fast raw text replace (default), 'json' to parse and walk the structure")

    args = parser.parse_args(argv)

    in_path = args.in_path
    out_path = args.out_path
    indent = args.indent

    if not os.path.exists(in_path):
        print(f"Input file not found: {in_path}", file=sys.stderr)
        return 1

    try:
        if args.mode == "text":
            before, after = process_text_mode(in_path, out_path, indent)
        else:
            before, after = process_json_mode(in_path, out_path, indent)
    except json.JSONDecodeError as e:
        print(f"Failed to parse JSON (try --mode text): {e}", file=sys.stderr)
        return 2

    print(f"Updated file written to: {out_path}")
    print(f"Occurrences before: {before}, after: {after}")
    if after != 0:
        print("Warning: Some occurrences remain. They may be in comments or unexpected formats.", file=sys.stderr)
        return 3
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

