"""SQLite-backed registry for media, jobs and usage."""
from __future__ import annotations

import json
import shutil
import sqlite3
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from .config import settings

_lock = threading.Lock()


def _conn() -> sqlite3.Connection:
    conn = sqlite3.connect(settings.db_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def init() -> None:
    with _lock, _conn() as c:
        c.executescript(
            """
            CREATE TABLE IF NOT EXISTS media (
                id TEXT PRIMARY KEY, kind TEXT, path TEXT, source TEXT,
                licence TEXT, meta TEXT, created REAL
            );
            CREATE TABLE IF NOT EXISTS jobs (
                id TEXT PRIMARY KEY, type TEXT, status TEXT, progress REAL,
                message TEXT, input TEXT, output TEXT, error TEXT, created REAL, updated REAL
            );
            CREATE TABLE IF NOT EXISTS usage (
                ts REAL, provider TEXT, operation TEXT, units REAL, unit TEXT, paid INTEGER
            );
            """
        )


init()


# ---------------------------------------------------------------- media
def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}"


def media_path(media_id: str, ext: str) -> Path:
    return settings.media_dir / f"{media_id}.{ext.lstrip('.')}"


def add_media(
    path: Path,
    kind: str,
    source: str,
    licence: dict[str, Any] | None = None,
    meta: dict[str, Any] | None = None,
    media_id: str | None = None,
) -> dict[str, Any]:
    """Register a file. If it is not already inside the media dir, it is copied there."""
    media_id = media_id or new_id(kind[:3])
    path = Path(path)
    if path.parent.resolve() != settings.media_dir.resolve():
        dest = media_path(media_id, path.suffix or ".bin")
        shutil.copyfile(path, dest)
        path = dest
    row = {
        "id": media_id,
        "kind": kind,
        "path": str(path),
        "source": source,
        "licence": licence or {},
        "meta": meta or {},
        "created": time.time(),
    }
    with _lock, _conn() as c:
        c.execute(
            "INSERT OR REPLACE INTO media VALUES (?,?,?,?,?,?,?)",
            (media_id, kind, str(path), source, json.dumps(row["licence"]), json.dumps(row["meta"]), row["created"]),
        )
    return public_media(row)


def get_media(media_id: str) -> dict[str, Any]:
    with _lock, _conn() as c:
        r = c.execute("SELECT * FROM media WHERE id=?", (media_id,)).fetchone()
    if not r:
        raise KeyError(f"Unknown media_id '{media_id}'. Use list_media to see what exists.")
    return {
        "id": r["id"], "kind": r["kind"], "path": r["path"], "source": r["source"],
        "licence": json.loads(r["licence"]), "meta": json.loads(r["meta"]), "created": r["created"],
    }


def list_media(kind: str | None = None, limit: int = 50) -> list[dict[str, Any]]:
    q, args = "SELECT * FROM media", []
    if kind:
        q += " WHERE kind=?"
        args.append(kind)
    q += " ORDER BY created DESC LIMIT ?"
    args.append(limit)
    with _lock, _conn() as c:
        rows = c.execute(q, args).fetchall()
    return [public_media({
        "id": r["id"], "kind": r["kind"], "path": r["path"], "source": r["source"],
        "licence": json.loads(r["licence"]), "meta": json.loads(r["meta"]), "created": r["created"],
    }) for r in rows]


def file_url(path: str | Path) -> str | None:
    if not settings.public_base_url:
        return None
    return f"{settings.public_base_url}/files/{Path(path).name}"


def public_media(row: dict[str, Any]) -> dict[str, Any]:
    out = dict(row)
    url = file_url(row["path"])
    if url:
        out["url"] = url
    return out


# ---------------------------------------------------------------- jobs
def create_job(job_type: str, payload: dict[str, Any]) -> str:
    job_id = new_id("job")
    now = time.time()
    with _lock, _conn() as c:
        c.execute(
            "INSERT INTO jobs VALUES (?,?,?,?,?,?,?,?,?,?)",
            (job_id, job_type, "queued", 0.0, "", json.dumps(payload), None, None, now, now),
        )
    return job_id


def update_job(job_id: str, **fields: Any) -> None:
    if "output" in fields and fields["output"] is not None:
        fields["output"] = json.dumps(fields["output"])
    fields["updated"] = time.time()
    cols = ", ".join(f"{k}=?" for k in fields)
    with _lock, _conn() as c:
        c.execute(f"UPDATE jobs SET {cols} WHERE id=?", (*fields.values(), job_id))


def get_job(job_id: str) -> dict[str, Any]:
    with _lock, _conn() as c:
        r = c.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
    if not r:
        raise KeyError(f"Unknown job_id '{job_id}'")
    return {
        "job_id": r["id"], "type": r["type"], "status": r["status"], "progress": round(r["progress"], 3),
        "message": r["message"], "output": json.loads(r["output"]) if r["output"] else None,
        "error": r["error"], "elapsed_s": round(r["updated"] - r["created"], 1),
    }


# ---------------------------------------------------------------- usage
PAID_PROVIDERS = {"elevenlabs", "fal", "openai"}


def log_usage(provider: str, operation: str, units: float, unit: str) -> None:
    with _lock, _conn() as c:
        c.execute(
            "INSERT INTO usage VALUES (?,?,?,?,?,?)",
            (time.time(), provider, operation, units, unit, int(provider in PAID_PROVIDERS)),
        )


def usage_summary(days: int = 30) -> list[dict[str, Any]]:
    since = time.time() - days * 86400
    with _lock, _conn() as c:
        rows = c.execute(
            "SELECT provider, operation, unit, COUNT(*) n, SUM(units) total, MAX(paid) paid "
            "FROM usage WHERE ts>=? GROUP BY provider, operation, unit ORDER BY provider",
            (since,),
        ).fetchall()
    return [dict(r) for r in rows]
