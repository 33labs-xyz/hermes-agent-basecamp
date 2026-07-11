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

import base64
import json
import logging
import os
import re
import time
from functools import lru_cache
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from hermes_cli.staff import composio
from hermes_cli.staff.catalog import CATALOG, catalog_entry, get_agent

logger = logging.getLogger(__name__)

# Offline Ed25519 license verification: the relay signs keys with the private
# half of this pair; only the public half ships here, so a key cannot be
# forged without relay access. See ``license_is_valid`` for the wire format.
_LICENSE_PREFIX = "BCPRO-"
_LICENSE_MESSAGE_PREFIX = b"BCPRO1"
_LICENSE_PUBLIC_KEY_HEX = "41614277faaebf00e77cbe91ccacf61ead810170565003ca0a4e4fdf2265cea1"
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

@lru_cache(maxsize=1)
def _license_public_key() -> Ed25519PublicKey:
    return Ed25519PublicKey.from_public_bytes(bytes.fromhex(_LICENSE_PUBLIC_KEY_HEX))


def _decode_license_payload(key: str) -> bytes:
    """Parse ``BCPRO-XXXXXXXX-...`` into its raw 72-byte nonce+signature."""
    if not key.startswith(_LICENSE_PREFIX):
        raise ValueError("missing BCPRO- prefix")
    body = key[len(_LICENSE_PREFIX):].replace("-", "").upper()
    padded = body + "=" * (-len(body) % 8)
    payload = base64.b32decode(padded)
    if len(payload) != 72:
        raise ValueError("unexpected payload length")
    return payload


def license_is_valid(key: str) -> bool:
    """Offline Ed25519 signature check for relay-issued pro keys.

    A key encodes an 8-byte nonce and a 64-byte Ed25519 signature over
    ``b"BCPRO1" + nonce``, base32-encoded (RFC 4648) and dash-grouped for
    readability. The relay holds the private key; this app only ever verifies
    against the baked-in public half, so a key can't be guessed or forged.
    Any parse or verification failure is treated as an invalid key.
    """
    try:
        payload = _decode_license_payload(key)
        nonce, signature = payload[:8], payload[8:]
        _license_public_key().verify(signature, _LICENSE_MESSAGE_PREFIX + nonce)
        return True
    except Exception:
        return False


def _purchase_url() -> Optional[str]:
    """Where "Get a key" points. Env-configured so the Stripe checkout page
    can slot in without touching license validation or shipping a new UI.

    Falls back to the relay's hosted checkout when no explicit purchase URL
    is set but the app is talking to the relay anyway (``BASECAMP_RELAY_URL``).
    """
    url = os.environ.get("BASECAMP_STAFF_PURCHASE_URL", "").strip()
    if url:
        return url
    relay_base = composio.relay_base_url()
    if relay_base:
        return f"{relay_base}/api/v1/checkout"
    return None


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


def _register_composio_mcp_server(toolkit: str) -> None:
    """Give the agent runtime tools for a newly-active Composio connection.

    An ACTIVE connected account only proves OAuth succeeded -- nothing else
    registers an MCP server for it, so without this the agent runtime never
    sees the toolkit's tools (``tools/mcp_tool.py`` loads url-based servers
    straight out of ``config.yaml``). Idempotent: a no-op once the server
    exists. Callers must swallow any exception this raises -- a failed
    registration must not turn an otherwise-successful connect-status
    response into an error.
    """
    from hermes_cli.mcp_config import _get_mcp_servers, _save_mcp_server

    server_name = f"composio_{toolkit}"
    if server_name in _get_mcp_servers():
        return
    url = composio.mcp_url(toolkit)
    _save_mcp_server(server_name, {"url": url})


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
        try:
            _register_composio_mcp_server(slug)
        except Exception:
            logger.warning("could not register MCP server for %s", slug, exc_info=True)
        # Persist so future state reads answer from disk instead of the network.
        connected = state.get("composio_connected") or []
        try:
            _save_state({**state, "composio_connected": [*connected, slug]})
        except Exception:
            return _internal_err()
        return {"connected": True, "source": "composio"}
