"""Turn Release Please release notes (markdown) into plain-text changelog lines for OrcaCloud.

OrcaCloud shows the changelog as plain text, so headings, links and commit hashes look like noise.
Reads markdown on stdin and prints "- Fix: message" style lines.

    gh release view v1.2.3 --json body -q .body | python release_notes.py
"""
import re
import sys

PREFIX = {"features": "New", "bug fixes": "Fix", "performance improvements": "Faster",
          "documentation": "Docs", "reverts": "Revert"}


def plain_changelog(md: str) -> str:
    out, prefix = [], ""
    for line in md.splitlines():
        line = line.strip()
        if line.startswith("### "):
            prefix = PREFIX.get(line[4:].strip().lower(), "")
            continue
        m = re.match(r"^[*-]\s+(.*)", line)
        if not m:
            continue  # version heading, compare link, blank lines
        text = m.group(1)
        text = re.sub(r"\s*\(\[[0-9a-f]{7,40}\]\([^)]*\)\)", "", text)  # ([abc1234](…/commit/…))
        text = re.sub(r"\s*\(\[#\d+\]\([^)]*\)\)", "", text)  # ([#17](…/issues/17))
        text = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", text)  # any other link -> its text
        text = re.sub(r"^\*\*([^*]+):\*\*\s*", r"\1: ", text)  # **scope:** -> scope:
        text = text.replace("`", "").strip()
        if not text:
            continue
        text = text[0].upper() + text[1:]
        out.append(f"- {prefix}: {text}" if prefix else f"- {text}")
    return "\n".join(out)


if __name__ == "__main__":
    sys.stdout.write(plain_changelog(sys.stdin.read()))
