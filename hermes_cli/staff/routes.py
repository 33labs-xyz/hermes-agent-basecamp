"""FastAPI routes for the Staff marketplace (hireable pre-built agents).

Same shape as ``hermes_cli.chat_groups.routes``: thin handlers registered on
the dashboard app, inheriting its ``/api/`` auth gate. Errors return
structured ``{error_code, message}`` envelopes.

Entitlement model (v1, license-key placeholder for a real billing backend):
  free  -> 1 agent slot, manual runs only, standard agents only
  pro   -> 5 slots, schedules, pro agents

State lives at ``~/.hermes/staff/state.json`` (0600): the license key plus the
roster of hired agents. Hiring creates a chat group carrying the agent's
standing instructions; scheduling (pro) creates a cron job bound to that group.
"""

from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from hermes_cli.staff import composio
from hermes_cli.staff.catalog import CATALOG, catalog_entry, get_agent

_LICENSE_RE = re.compile(r"^BCPRO(-[A-Z0-9]{4}){3}$")
_LICENSE_CHECKSUM_MOD = 7
_TIME_RE = re.compile(r"^([01]?\d|2[0-3]):([0-5]\d)$")

_FREE_ENTITLEMENT = {"tier": "free", "slots": 1, "schedules": False}
_PRO_ENTITLEMENT = {"tier": "pro", "slots": 5, "schedules": True}

# Staff schedules promise "runs while you're away", but the desktop scheduler
# only ticks while the app is open. A 20h catch-up window means a missed 9am
# run still fires when the laptop opens later that day, instead of the default
# grace (max 2h) silently skipping it.
_SCHEDULE_CATCH_UP_SECONDS = 72_000

# Toolkit slugs whose MCP server names don't contain the slug verbatim.
_TOOLKIT_ALIASES: Dict[str, tuple] = {
    "googlecalendar": ("calendar", "gcal"),
    "googlesheets": ("sheets",),
    "googledrive": ("drive", "gdrive"),
}


class LicenseBody(BaseModel):
    key: str


class HireBody(BaseModel):
    key: str


class FireBody(BaseModel):
    key: str


class ScheduleBody(BaseModel):
    key: str
    time: Optional[str] = None


class ConnectBody(BaseModel):
    toolkit: str


class RunBody(BaseModel):
    key: str


def _err(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error_code": code, "message": message})


def _internal_err() -> JSONResponse:
    return _err(500, "internal", "internal error")


# ---------------------------------------------------------------------------
# State persistence
# ---------------------------------------------------------------------------

def _state_path() -> Path:
    return Path(os.path.expanduser("~/.hermes")) / "staff" / "state.json"


def _load_state() -> Dict[str, Any]:
    path = _state_path()
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {"version": 1, "license": "", "roster": [], "composio_connected": []}
    except Exception:
        return {"version": 1, "license": "", "roster": [], "composio_connected": []}
    if not isinstance(raw, dict):
        return {"version": 1, "license": "", "roster": [], "composio_connected": []}
    roster = raw.get("roster")
    composio_connected = raw.get("composio_connected")
    return {
        "version": 1,
        "license": raw.get("license") if isinstance(raw.get("license"), str) else "",
        "roster": roster if isinstance(roster, list) else [],
        "composio_connected": [
            str(slug) for slug in composio_connected if isinstance(slug, str)
        ] if isinstance(composio_connected, list) else [],
    }


def _save_state(state: Dict[str, Any]) -> None:
    path = _state_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(state, indent=2), encoding="utf-8")
    try:
        os.chmod(tmp, 0o600)
    except OSError:
        pass
    tmp.replace(path)


# ---------------------------------------------------------------------------
# Entitlement (license-key placeholder; swap for Stripe/Supabase later)
# ---------------------------------------------------------------------------

def license_is_valid(key: str) -> bool:
    """Format + checksum gate for hand-issued pro keys.

    A key is valid when it matches ``BCPRO-XXXX-XXXX-XXXX`` (A-Z0-9) and the
    sum of its alphanumeric character codes is divisible by
    ``_LICENSE_CHECKSUM_MOD``. ``generate_license`` produces matching keys.
    """
    if not _LICENSE_RE.match(key):
        return False
    total = sum(ord(c) for c in key if c.isalnum())
    return total % _LICENSE_CHECKSUM_MOD == 0


def generate_license(seed: str) -> str:
    """Derive a valid pro key from any seed string (issuing helper, CLI use)."""
    import hashlib

    alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
    digest = hashlib.sha256(seed.encode("utf-8")).hexdigest().upper()
    chars = [alphabet[int(digest[i : i + 2], 16) % len(alphabet)] for i in range(0, 22, 2)]
    for candidate in alphabet:
        key = "BCPRO-" + "".join(chars[0:4]) + "-" + "".join(chars[4:8]) + "-" + "".join(chars[8:11]) + candidate
        if license_is_valid(key):
            return key
    raise RuntimeError("license generation failed")  # unreachable: alphabet covers all residues


def _purchase_url() -> Optional[str]:
    """Where "Get a key" points. Env-configured so the Stripe checkout page
    can slot in without touching license validation or shipping a new UI."""
    url = os.environ.get("BASECAMP_STAFF_PURCHASE_URL", "").strip()
    return url or None


def _entitlement(state: Dict[str, Any]) -> Dict[str, Any]:
    if os.environ.get("BASECAMP_STAFF_PRO") == "1":
        base = dict(_PRO_ENTITLEMENT)
    elif license_is_valid(state.get("license", "")):
        base = dict(_PRO_ENTITLEMENT)
    else:
        base = dict(_FREE_ENTITLEMENT)
    return {**base, "purchase_url": _purchase_url()}


# ---------------------------------------------------------------------------
# Connections (derived from configured MCP servers; Composio optional later)
# ---------------------------------------------------------------------------

def _all_toolkits() -> List[str]:
    seen: List[str] = []
    for agent in CATALOG:
        for slug in agent.requires:
            if slug not in seen:
                seen.append(slug)
    return seen


def _mcp_connected(slug: str) -> bool:
    try:
        from hermes_cli.mcp_config import _get_mcp_servers

        servers = _get_mcp_servers() or {}
    except Exception:
        servers = {}
    normalized = [re.sub(r"[^a-z0-9]", "", str(name).lower()) for name in servers]
    needles = (slug, *(_TOOLKIT_ALIASES.get(slug, ())))
    return any(needle in name for name in normalized for needle in needles)


def _connection_source(slug: str, state: Dict[str, Any]) -> Optional[str]:
    if _mcp_connected(slug):
        return "mcp"
    if slug in (state.get("composio_connected") or []):
        return "composio"
    return None


def _connections(state: Dict[str, Any]) -> List[Dict[str, Any]]:
    results = []
    for slug in _all_toolkits():
        source = _connection_source(slug, state)
        results.append({"slug": slug, "connected": source is not None, "source": source})
    return results


# ---------------------------------------------------------------------------
# Cron bridge
# ---------------------------------------------------------------------------

def _cron_call(func_name: str, *args, **kwargs):
    from hermes_cli.web_server import _call_cron_for_profile

    return _call_cron_for_profile(None, func_name, *args, **kwargs)


def _remove_job_quietly(job_id: Optional[str]) -> None:
    if not job_id:
        return
    try:
        _cron_call("remove_job", job_id)
    except Exception:
        pass  # job already gone; roster stays consistent regardless


def _staff_job_prompt(agent) -> str:
    """Self-contained cron prompt: the scheduler runs jobs without any chat
    group context, so the agent's standing instructions ride along with the
    task instead of relying on group instruction injection."""
    return (
        f"You are {agent.name}, a hired staff agent working for the user.\n\n"
        f"## Standing instructions\n{agent.instructions.strip()}\n\n"
        f"## Task\n{agent.run_prompt.strip()}"
    )


def _job_pending(job_id: Optional[str]) -> bool:
    """A one-shot run job exists until the scheduler completes it (auto-removed
    by mark_job_run when its repeat limit hits)."""
    if not job_id:
        return False
    try:
        return _cron_call("get_job", job_id) is not None
    except Exception:
        return False


_REPORT_EXCERPT_CHARS = 400


def _latest_report(entry: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Newest cron output across the entry's schedule + manual-run jobs.

    Output directories outlive their jobs (one-shots are auto-removed after
    running), so reports stay readable after completion."""
    candidates = []
    for source, job_id in (("scheduled", entry.get("job_id")), ("manual", entry.get("run_job_id"))):
        if not job_id:
            continue
        try:
            out_dir = Path(_cron_call("_job_output_dir", job_id))
            files = sorted(out_dir.glob("*.md"), key=lambda f: f.stat().st_mtime, reverse=True)
        except Exception:
            continue
        if files:
            candidates.append((files[0].stat().st_mtime, source, files[0]))
    if not candidates:
        return None
    mtime, source, latest = max(candidates, key=lambda c: c[0])
    try:
        text = latest.read_text(encoding="utf-8").strip()
    except OSError:
        return None
    if not text:
        return None
    # Scheduler output files repeat the full prompt before the useful part
    # ("## Response" or, on failure, "## Error") — excerpt from there.
    body = text
    for marker in ("\n## Response\n", "\n## Error\n"):
        idx = text.find(marker)
        if idx != -1:
            body = text[idx + len(marker):].strip()
            break
    excerpt = body[:_REPORT_EXCERPT_CHARS] + ("…" if len(body) > _REPORT_EXCERPT_CHARS else "")
    # The scheduler titles failed runs "# Cron Job: <name> (FAILED)".
    first_line = text.splitlines()[0]
    return {"at": mtime, "source": source, "excerpt": excerpt, "ok": "(FAILED)" not in first_line}


def _default_db_factory():
    from hermes_cli.web_server import _open_session_db_for_profile

    return _open_session_db_for_profile(None)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

def register_staff_routes(app: FastAPI, db_factory: Optional[Callable] = None) -> None:
    factory = db_factory or _default_db_factory

    @app.get("/api/staff/catalog", response_model=None)
    async def staff_catalog():
        try:
            return {"agents": [catalog_entry(a) for a in CATALOG]}
        except Exception:
            return _internal_err()

    @app.get("/api/staff/state", response_model=None)
    async def staff_state():
        try:
            state = _load_state()
            roster = []
            for entry in state["roster"]:
                item = dict(entry)
                item.setdefault("job_id", None)
                item.setdefault("run_job_id", None)
                item.setdefault("scheduled", False)
                item.setdefault("schedule_time", None)
                item["last_report"] = _latest_report(item)
                item["running"] = _job_pending(item.get("run_job_id"))
                item["next_run"] = None
                if item.get("job_id"):
                    try:
                        job = _cron_call("get_job", item["job_id"])
                        if job:
                            item["next_run"] = job.get("next_run") or job.get("next_run_at")
                    except Exception:
                        pass
                roster.append(item)
            return {
                "entitlement": _entitlement(state),
                "roster": roster,
                "connections": _connections(state),
            }
        except Exception:
            return _internal_err()

    @app.post("/api/staff/license", response_model=None)
    async def staff_license(body: LicenseBody):
        key = body.key.strip().upper() if isinstance(body.key, str) else ""
        state = _load_state()
        if key and not license_is_valid(key):
            return _err(400, "invalid_license", "that license key is not valid")
        new_state = {**state, "license": key}
        try:
            _save_state(new_state)
        except Exception:
            return _internal_err()
        return _entitlement(new_state)

    @app.post("/api/staff/hire", response_model=None)
    async def staff_hire(body: HireBody):
        agent = get_agent(body.key or "")
        if agent is None:
            return _err(404, "not_found", "unknown agent")
        state = _load_state()
        ent = _entitlement(state)
        roster: List[Dict[str, Any]] = state["roster"]
        if any(e.get("key") == agent.key for e in roster):
            return _err(409, "already_hired", f"{agent.name} is already on your staff")
        if len(roster) >= ent["slots"]:
            return _err(409, "slots_full", f"all {ent['slots']} agent slots are in use")
        if agent.tier == "pro" and ent["tier"] != "pro":
            return _err(402, "pro_required", f"{agent.name} is a Pro agent")
        db = factory()
        try:
            group = db.create_chat_group(
                agent.name,
                now=time.time(),
                description=agent.tagline,
                instructions=agent.instructions,
            )
        except Exception:
            return _internal_err()
        finally:
            db.close()
        entry = {
            "key": agent.key,
            "group_id": group["id"],
            "job_id": None,
            "run_job_id": None,
            "hired_at": time.time(),
            "scheduled": False,
            "schedule_time": None,
        }
        try:
            _save_state({**state, "roster": [*roster, entry]})
        except Exception:
            return _internal_err()
        return {"group_id": group["id"]}

    @app.post("/api/staff/fire", response_model=None)
    async def staff_fire(body: FireBody):
        state = _load_state()
        roster: List[Dict[str, Any]] = state["roster"]
        entry = next((e for e in roster if e.get("key") == body.key), None)
        if entry is None:
            return _err(404, "not_found", "agent is not on your staff")
        _remove_job_quietly(entry.get("job_id"))
        _remove_job_quietly(entry.get("run_job_id"))
        remaining = [e for e in roster if e.get("key") != body.key]
        try:
            _save_state({**state, "roster": remaining})
        except Exception:
            return _internal_err()
        # The chat group (and its history) is deliberately kept.
        return {"ok": True}

    @app.post("/api/staff/schedule", response_model=None)
    async def staff_schedule(body: ScheduleBody):
        agent = get_agent(body.key or "")
        if agent is None:
            return _err(404, "not_found", "unknown agent")
        state = _load_state()
        ent = _entitlement(state)
        if not ent["schedules"]:
            return _err(402, "pro_required", "schedules are a Pro feature")
        roster: List[Dict[str, Any]] = state["roster"]
        entry = next((e for e in roster if e.get("key") == agent.key), None)
        if entry is None:
            return _err(404, "not_found", "hire this agent before scheduling it")
        run_time = body.time or agent.default_time
        match = _TIME_RE.match(run_time)
        if not match:
            return _err(400, "validation", "time must be HH:MM (24h)")
        hour, minute = int(match.group(1)), int(match.group(2))
        _remove_job_quietly(entry.get("job_id"))
        schedule = agent.schedule_template.format(minute=minute, hour=hour)
        try:
            job = _cron_call(
                "create_job",
                prompt=_staff_job_prompt(agent),
                schedule=schedule,
                name=f"Staff: {agent.name}",
                group_id=entry["group_id"],
                catch_up_grace_seconds=_SCHEDULE_CATCH_UP_SECONDS,
            )
        except Exception:
            return _err(500, "internal", "could not create the schedule")
        updated = {
            **entry,
            "job_id": job.get("id"),
            "scheduled": True,
            "schedule_time": f"{hour:02d}:{minute:02d}",
        }
        new_roster = [updated if e.get("key") == agent.key else e for e in roster]
        try:
            _save_state({**state, "roster": new_roster})
        except Exception:
            _remove_job_quietly(job.get("id"))
            return _internal_err()
        return {"job_id": job.get("id"), "next_run": job.get("next_run") or job.get("next_run_at")}

    @app.delete("/api/staff/schedule", response_model=None)
    async def staff_unschedule(key: str):
        state = _load_state()
        roster: List[Dict[str, Any]] = state["roster"]
        entry = next((e for e in roster if e.get("key") == key), None)
        if entry is None:
            return _err(404, "not_found", "agent is not on your staff")
        _remove_job_quietly(entry.get("job_id"))
        updated = {**entry, "job_id": None, "scheduled": False, "schedule_time": None}
        new_roster = [updated if e.get("key") == key else e for e in roster]
        try:
            _save_state({**state, "roster": new_roster})
        except Exception:
            return _internal_err()
        return {"ok": True}

    @app.post("/api/staff/run", response_model=None)
    async def staff_run(body: RunBody):
        """Manual run (free tier included): a triggered one-shot cron job.

        The desktop backend ticks the scheduler every 60s, so the run starts
        within a minute. One-shots auto-delete after running; their output dir
        survives and feeds ``last_report``.
        """
        agent = get_agent(body.key or "")
        if agent is None:
            return _err(404, "not_found", "unknown agent")
        state = _load_state()
        roster: List[Dict[str, Any]] = state["roster"]
        entry = next((e for e in roster if e.get("key") == agent.key), None)
        if entry is None:
            return _err(404, "not_found", "hire this agent before running it")
        if _job_pending(entry.get("run_job_id")):
            return _err(409, "run_in_progress", f"{agent.name} is already running")
        try:
            job = _cron_call(
                "create_job",
                prompt=_staff_job_prompt(agent),
                schedule="5m",
                name=f"Staff run: {agent.name}",
                repeat=1,
                group_id=entry["group_id"],
            )
            _cron_call("trigger_job", job.get("id"))
        except Exception:
            return _err(500, "internal", "could not start the run")
        updated = {**entry, "run_job_id": job.get("id")}
        new_roster = [updated if e.get("key") == agent.key else e for e in roster]
        try:
            _save_state({**state, "roster": new_roster})
        except Exception:
            _remove_job_quietly(job.get("id"))
            return _internal_err()
        return {"job_id": job.get("id"), "status": "queued"}

    @app.post("/api/staff/connect", response_model=None)
    async def staff_connect(body: ConnectBody):
        toolkit = (body.toolkit or "").strip().lower()
        if toolkit not in _all_toolkits():
            return _err(404, "not_found", "unknown toolkit")
        if not composio.is_configured():
            # No COMPOSIO_API_KEY on the backend: fall back to the manual MCP
            # path. Connections added there are picked up automatically.
            return {
                "connect_url": None,
                "manual": True,
                "message": (
                    f"Add a {toolkit} connection under Settings > Connections, "
                    "then come back here — the chip turns on automatically."
                ),
            }
        try:
            url = composio.connect_link(toolkit)
        except composio.ComposioError:
            return _err(
                502,
                "composio_error",
                "could not reach Composio — check COMPOSIO_API_KEY, "
                "or connect manually under Settings > Connections",
            )
        return {
            "connect_url": url,
            "manual": False,
            "message": f"Finish connecting {toolkit} in your browser, then come back here.",
        }

    @app.get("/api/staff/connect/status", response_model=None)
    async def staff_connect_status(toolkit: str):
        slug = (toolkit or "").strip().lower()
        if slug not in _all_toolkits():
            return _err(404, "not_found", "unknown toolkit")
        state = _load_state()
        source = _connection_source(slug, state)
        if source is not None:
            return {"connected": True, "source": source}
        if not composio.is_configured():
            return {"connected": False, "source": None}
        try:
            active = composio.connection_active(slug)
        except composio.ComposioError:
            return _err(
                502,
                "composio_error",
                "could not reach Composio — check COMPOSIO_API_KEY",
            )
        if not active:
            return {"connected": False, "source": None}
        # Persist so future state reads answer from disk instead of the network.
        connected = state.get("composio_connected") or []
        try:
            _save_state({**state, "composio_connected": [*connected, slug]})
        except Exception:
            return _internal_err()
        return {"connected": True, "source": "composio"}
