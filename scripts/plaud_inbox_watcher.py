#!/usr/bin/env python3
"""
Plaud Inbox Watcher
Watches Google Drive Plaud folder for new transcripts.
Downloads, converts to markdown with frontmatter, writes to vault inbox.
Also creates Notion Super Inbox item (kept for existing workflow).
"""
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib import request

PLAUD_FOLDER_ID = "1LXegj0Gg3HILnERap6GJM6G71irzxrDH"
ACCOUNT = "tulio@weareliveengine.com"
SUPER_INBOX_DB = "61efc873-884b-4c11-925b-c096ba38ec55"
PROJECT_GRID_DS = "1bf768ee-90b5-4c2e-8c75-5fae1d7eea69"
STATE_PATH = Path.home() / ".openclaw" / "state" / "plaud-watcher-state.json"

# Vault inbox path (iCloud)
VAULT_INBOX = (
    Path.home()
    / "Library"
    / "Mobile Documents"
    / "iCloud~md~obsidian"
    / "Documents"
    / "tuls-vault"
    / "00_inbox"
    / "sources"
    / "plaud"
)

# gog CLI — try common locations
GOG_PATHS = [
    "/opt/homebrew/bin/gog",
    "/usr/local/bin/gog",
    os.path.expanduser("~/.local/bin/gog"),
]

def find_gog() -> str:
    for p in GOG_PATHS:
        if Path(p).exists():
            return p
    # fallback: try PATH
    try:
        result = subprocess.run(["which", "gog"], capture_output=True, text=True)
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout.strip()
    except Exception:
        pass
    raise RuntimeError("gog CLI not found. Checked: " + ", ".join(GOG_PATHS))


def notion_key() -> str:
    p = Path.home() / ".config" / "notion" / "api_key"
    return p.read_text().strip()


def run(cmd) -> str:
    p = subprocess.run(cmd, capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError(p.stderr.strip() or p.stdout.strip() or f"command failed: {' '.join(str(c) for c in cmd)}")
    return p.stdout


def list_folder_files(gog: str) -> list:
    out = run([
        gog, "drive", "ls",
        "--parent", PLAUD_FOLDER_ID,
        "--max", "200",
        "--json", "--results-only",
        "--account", ACCOUNT,
    ])
    return json.loads(out or "[]")


def download_text(gog: str, file_id: str, out_path: Path) -> str:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    run([gog, "drive", "download", file_id, "--account", ACCOUNT, "--out", str(out_path)])
    return out_path.read_text(errors="ignore")


def load_state() -> dict:
    if not STATE_PATH.exists():
        return {"processed_ids": [], "bootstrapped": False}
    return json.loads(STATE_PATH.read_text())


def save_state(state: dict):
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    STATE_PATH.write_text(json.dumps(state, indent=2))


def infer_context(name: str, text: str) -> tuple[str, str, str, str]:
    blob = f"{name}\n{text}".lower()
    project = "Unknown / needs HITL"
    area = "Ops"
    tags = ["HITL", "plaud", "transcript"]
    confidence = "low"

    if any(k in blob for k in ["2603", "wac26", "women's asian cup", "tara", "james"]):
        project = "2603"
        tags += ["inft", "2603"]
        confidence = "medium"
    elif any(k in blob for k in ["concacaf", "cwcc", "ccc finals"]):
        project = "2612"
        tags += ["inft", "concacaf"]
        confidence = "medium"
    elif any(k in blob for k in ["finalissima", "match for hope", "qvision"]):
        project = "2615/2616"
        tags += ["inft", "qvision"]
        confidence = "medium"

    if any(k in blob for k in ["budget", "invoice", "cost", "proposal", "margin"]):
        area = "Finance"
        tags.append("finance")

    summary = text.strip().replace("\n", " ")
    summary = re.sub(r"\s+", " ", summary)[:1200]
    return project, area, confidence, summary


def infer_meeting_date(name: str, file_obj: dict) -> str:
    """Try to extract a date from the filename or fall back to modifiedTime."""
    # Common Plaud filename patterns: "2026-03-04 Meeting Title.txt", "20260304_..."
    date_match = re.search(r"(\d{4})[-_]?(\d{2})[-_]?(\d{2})", name)
    if date_match:
        y, m, d = date_match.groups()
        return f"{y}-{m}-{d}"
    modified = file_obj.get("modifiedTime", "")
    if modified:
        return modified[:10]
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def infer_participants(text: str) -> list[str]:
    """Rough participant extraction from common transcript formats."""
    participants = []
    for line in text.splitlines()[:50]:
        # "Speaker: " or "Tulio:" or "TULIO:" prefixes
        m = re.match(r"^([A-Za-z][A-Za-z\s]{1,30}):\s", line)
        if m:
            name = m.group(1).strip().title()
            if name not in participants and len(name) < 30:
                participants.append(name)
    return participants[:8]


def build_vault_markdown(file_obj: dict, transcript: str, project: str, area: str, confidence: str) -> tuple[str, str]:
    """Build markdown content and slug for vault note."""
    name = file_obj.get("name", "plaud-transcript")
    file_id = file_obj.get("id", "")
    link = file_obj.get("webViewLink") or f"https://drive.google.com/file/d/{file_id}/view"
    meeting_date = infer_meeting_date(name, file_obj)
    participants = infer_participants(transcript)

    # Build clean title from filename
    title_base = re.sub(r"\.(txt|md)$", "", name, flags=re.IGNORECASE)
    title_base = re.sub(r"^\d{4}[-_]?\d{2}[-_]?\d{2}[-_\s]*", "", title_base).strip()
    if not title_base:
        title_base = f"Plaud Recording {meeting_date}"
    title = f"{meeting_date} {title_base}"

    # Slug for filename
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:80]

    # Determine domain
    domain_map = {"2603": "inft", "2612": "inft", "2615/2616": "inft"}
    domain = domain_map.get(project, "openclaw")

    # Build summary (first ~400 chars of transcript)
    summary_text = transcript.strip().replace("\n", " ")
    summary_text = re.sub(r"\s+", " ", summary_text)[:400]

    tags = ["plaud", "transcript"]
    if project != "Unknown / needs HITL":
        tags.append(project.replace("/", "-"))
    if area == "Finance":
        tags.append("finance")
    if confidence == "low":
        tags.append("needs-review")

    participant_str = ", ".join(participants) if participants else "Unknown"

    frontmatter = f"""---
title: "{title}"
source: plaud
origin: "{link}"
captured: {datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}
type: meeting
domain: {domain}
tags: {json.dumps(tags)}
status: inbox
project: "{project}"
confidence: {confidence}
participants: {json.dumps(participants)}
---"""

    body = f"""# {title}

**Date:** {meeting_date}
**Participants:** {participant_str}
**Project:** {project} (confidence: {confidence})
**Source:** [Google Drive]({link})

## Summary

{summary_text}{"..." if len(transcript) > 400 else ""}

## Connections

- 

## Raw Transcript

{transcript.strip()}
"""

    return slug, frontmatter + "\n\n" + body


def write_to_vault(slug: str, content: str) -> Path:
    """Write markdown file to vault inbox."""
    VAULT_INBOX.mkdir(parents=True, exist_ok=True)
    out_path = VAULT_INBOX / f"{slug}.md"
    # Avoid overwriting — append counter if collision
    counter = 1
    while out_path.exists():
        out_path = VAULT_INBOX / f"{slug}-{counter}.md"
        counter += 1
    out_path.write_text(content, encoding="utf-8")
    return out_path


def notion_api(method: str, url: str, key: str, payload=None) -> dict:
    body = json.dumps(payload).encode() if payload is not None else None
    req = request.Request(
        url,
        data=body,
        headers={
            "Authorization": f"Bearer {key}",
            "Notion-Version": "2025-09-03",
            "Content-Type": "application/json",
        },
        method=method,
    )
    with request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode())


def find_project_grid_page_id(code: str, key: str):
    q = notion_api("POST", f"https://api.notion.com/v1/data_sources/{PROJECT_GRID_DS}/query", key, {"page_size": 200})
    for r in q.get("results", []):
        props = r.get("properties", {})
        c = ((props.get("Code", {}).get("rich_text") or [{}])[0].get("plain_text") or "").strip()
        pname = ((props.get("Project name", {}).get("title") or [{}])[0].get("plain_text") or "")
        if c == code or code in pname:
            return r.get("id")
    return None


def create_super_inbox_item(file_obj: dict, transcript: str, key: str):
    name = file_obj.get("name", "Plaud transcript")
    file_id = file_obj.get("id")
    link = file_obj.get("webViewLink") or f"https://drive.google.com/file/d/{file_id}/view"
    project, area, confidence, summary = infer_context(name, transcript)

    project_rel = []
    if project == "2603":
        pid = find_project_grid_page_id("2603", key)
        if pid:
            project_rel = [{"id": pid}]

    ai_notes = (
        "Auto-ingested from Plaud Drive folder.\n"
        f"Inferred project: {project} (confidence: {confidence}).\n"
        "HITL REQUIRED: Please confirm context classification and define next steps.\n"
        "Expected operator response format: 'Project=<...>; Next steps=<...>; Priority=<...>; Owner=<...>'."
    )

    props = {
        "Name": {"title": [{"text": {"content": f"Plaud: {name[:120]}"}}]},
        "Status": {"status": {"name": "To Review"}},
        "Source": {"select": {"name": "plaud"}},
        "Type": {"select": {"name": "Voice Memo"}},
        "Priority": {"select": {"name": "Medium"}},
        "When": {"select": {"name": "TBD❓"}},
        "Captured At": {"date": {"start": datetime.now(timezone.utc).isoformat()}},
        "AI Notes": {"rich_text": [{"text": {"content": ai_notes[:1900]}}]},
        "Assignee Notes": {"rich_text": [{"text": {"content": f"Summary:\n{summary}"}}]},
        "Areas": {"multi_select": [{"name": area}]},
        "Tags": {"multi_select": [{"name": "HITL"}, {"name": "plaud"}, {"name": "auto-ingest"}]},
        " URL": {"url": link},
    }
    if project_rel:
        props["Project"] = {"relation": project_rel}

    notion_api("POST", "https://api.notion.com/v1/pages", key, {
        "parent": {"database_id": SUPER_INBOX_DB},
        "properties": props,
    })


def main():
    mode = "run"
    if len(sys.argv) > 1:
        mode = sys.argv[1]

    results = {"vault_written": [], "notion_created": 0, "errors": [], "new_files": 0}

    try:
        gog = find_gog()
    except RuntimeError as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

    files = list_folder_files(gog)
    files = sorted(files, key=lambda x: x.get("modifiedTime", ""))
    state = load_state()
    processed = set(state.get("processed_ids", []))

    if mode == "bootstrap" and not state.get("bootstrapped"):
        state["processed_ids"] = [f.get("id") for f in files if f.get("id")]
        state["bootstrapped"] = True
        save_state(state)
        print(json.dumps({"bootstrapped": True, "count": len(state["processed_ids"])}))
        return

    new_files = [f for f in files if f.get("id") and f.get("id") not in processed]
    results["new_files"] = len(new_files)

    notion_enabled = mode != "vault-only"
    notion_key_val = None
    if notion_enabled:
        try:
            notion_key_val = notion_key()
        except Exception:
            notion_enabled = False

    for f in new_files:
        fid = f.get("id")
        fname = f.get("name", "")
        try:
            if f.get("mimeType") != "text/plain":
                processed.add(fid)
                continue

            tmp = Path("/tmp") / f"plaud_{fid}.txt"
            transcript = download_text(gog, fid, tmp)

            project, area, confidence, _ = infer_context(fname, transcript)

            # Write to vault inbox
            slug, content = build_vault_markdown(f, transcript, project, area, confidence)
            vault_path = write_to_vault(slug, content)
            results["vault_written"].append(str(vault_path))

            # Also push to Notion (kept for existing workflow)
            if notion_enabled and notion_key_val:
                try:
                    create_super_inbox_item(f, transcript, notion_key_val)
                    results["notion_created"] += 1
                except Exception as ne:
                    results["errors"].append(f"notion [{fname}]: {ne}")

            processed.add(fid)

        except Exception as e:
            results["errors"].append(f"{fname}: {e}")
            processed.add(fid)  # mark processed to avoid retry loop

    state["processed_ids"] = list(processed)
    state["bootstrapped"] = True
    save_state(state)
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
