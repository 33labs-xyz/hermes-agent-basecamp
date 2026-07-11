"""FastAPI route tests for the Staff marketplace endpoints.

Mirrors ``tests/chat_groups/test_routes.py``: handlers run against a temp-file
``SessionDB`` via an injected ``db_factory``. The staff state file and the
cron bridge are monkeypatched so nothing touches ``~/.hermes`` or a scheduler.
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from hermes_cli.staff import routes as staff_routes
from hermes_cli.staff.catalog import CATALOG
from hermes_cli.staff.routes import generate_license, license_is_valid

PRO_KEY = generate_license("test-suite")
STANDARD_AGENTS = [a.key for a in CATALOG if a.tier == "standard"]
PRO_AGENTS = [a.key for a in CATALOG if a.tier == "pro"]


class FakeCron:
    def __init__(self, output_root):
        self.jobs = {}
        self.removed = []
        self.triggered = []
        self.output_root = output_root
        self._n = 0

    def __call__(self, func_name, *args, **kwargs):
        if func_name == "create_job":
            self._n += 1
            job = {"id": f"job-{self._n}", "next_run": "2026-07-10T08:30:00", **kwargs}
            self.jobs[job["id"]] = job
            return job
        if func_name == "get_job":
            return self.jobs.get(args[0])
        if func_name == "remove_job":
            self.removed.append(args[0])
            return self.jobs.pop(args[0], None) is not None
        if func_name == "trigger_job":
            self.triggered.append(args[0])
            return self.jobs.get(args[0])
        if func_name == "_job_output_dir":
            return self.output_root / args[0]
        raise AssertionError(f"unexpected cron call {func_name}")

    def finish_run(self, job_id, output):
        """Simulate the scheduler completing a one-shot run: output written, job gone."""
        out_dir = self.output_root / job_id
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / "2026-07-09_09-00-00.md").write_text(output, encoding="utf-8")
        self.jobs.pop(job_id, None)


@pytest.fixture
def cron(tmp_path):
    return FakeCron(tmp_path / "cron-output")


class FakeMcpServers:
    """In-memory stand-in for ``hermes_cli.mcp_config``'s server registry, so
    MCP-registration tests don't touch the real ``~/.hermes/config.yaml``."""

    def __init__(self):
        self.servers: dict = {}
        self.save_calls: list = []

    def get(self, config=None):
        return dict(self.servers)

    def save(self, name, server_config):
        self.save_calls.append((name, server_config))
        self.servers[name] = server_config
        return True


@pytest.fixture
def fake_mcp(monkeypatch):
    import hermes_cli.mcp_config as mcp_config

    fake = FakeMcpServers()
    monkeypatch.setattr(mcp_config, "_get_mcp_servers", fake.get)
    monkeypatch.setattr(mcp_config, "_save_mcp_server", fake.save)
    return fake


@pytest.fixture
def client(tmp_path, monkeypatch, cron):
    from hermes_state import SessionDB

    monkeypatch.delenv("BASECAMP_STAFF_PRO", raising=False)
    monkeypatch.delenv("BASECAMP_STAFF_PURCHASE_URL", raising=False)
    monkeypatch.delenv("COMPOSIO_API_KEY", raising=False)
    monkeypatch.delenv("BASECAMP_RELAY_URL", raising=False)
    monkeypatch.setattr(staff_routes, "_state_path", lambda: tmp_path / "staff" / "state.json")
    monkeypatch.setattr(staff_routes, "_cron_call", cron)

    db_path = tmp_path / "routes_state.db"
    app = FastAPI()
    staff_routes.register_staff_routes(app, db_factory=lambda profile=None: SessionDB(db_path=db_path))
    test_client = TestClient(app)
    test_client.db_path = db_path
    return test_client


def _go_pro(client):
    resp = client.post("/api/staff/license", json={"key": PRO_KEY})
    assert resp.status_code == 200
    assert resp.json()["tier"] == "pro"


def _hire(client, key):
    return client.post("/api/staff/hire", json={"key": key})


# -- license ---------------------------------------------------------------

def test_generated_license_validates():
    assert license_is_valid(PRO_KEY)


def test_tampered_license_fails():
    tampered = PRO_KEY[:-1] + ("A" if PRO_KEY[-1] != "A" else "B")
    assert not license_is_valid(tampered)


def test_bad_license_is_400(client):
    resp = client.post("/api/staff/license", json={"key": "BCPRO-NOPE-NOPE-NOP"})
    assert resp.status_code == 400
    assert resp.json()["error_code"] == "invalid_license"


def test_empty_license_clears_back_to_free(client):
    _go_pro(client)
    resp = client.post("/api/staff/license", json={"key": ""})
    assert resp.status_code == 200
    assert resp.json()["tier"] == "free"


# -- catalog + state -------------------------------------------------------

def test_catalog_lists_all_agents(client):
    resp = client.get("/api/staff/catalog")
    assert resp.status_code == 200
    agents = resp.json()["agents"]
    assert len(agents) == 12
    assert {"key", "name", "tagline", "requires", "tier"} <= set(agents[0])


def test_default_state_is_free_and_empty(client):
    resp = client.get("/api/staff/state")
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["entitlement"] == {"tier": "free", "slots": 1, "schedules": False, "purchase_url": None}
    assert payload["roster"] == []
    assert all({"slug", "connected", "source"} <= set(c) for c in payload["connections"])


def test_entitlement_purchase_url_from_env(client, monkeypatch):
    monkeypatch.setenv("BASECAMP_STAFF_PURCHASE_URL", "https://33labs.xyz/basecamp-pro")
    payload = client.get("/api/staff/state").json()
    assert payload["entitlement"]["purchase_url"] == "https://33labs.xyz/basecamp-pro"


# -- hire / fire -----------------------------------------------------------

def test_hire_creates_chat_group_and_roster_entry(client):
    resp = _hire(client, STANDARD_AGENTS[0])
    assert resp.status_code == 200
    group_id = resp.json()["group_id"]

    state = client.get("/api/staff/state").json()
    assert [e["key"] for e in state["roster"]] == [STANDARD_AGENTS[0]]
    assert state["roster"][0]["group_id"] == group_id
    assert state["roster"][0]["scheduled"] is False

    from hermes_state import SessionDB

    db = SessionDB(db_path=client.db_path)
    groups = {g["id"]: g for g in db.list_chat_groups()}
    assert group_id in groups
    assert groups[group_id]["instructions"].strip()


def test_hire_unknown_agent_is_404(client):
    assert _hire(client, "no-such-agent").status_code == 404


def test_hire_twice_is_409(client):
    _hire(client, STANDARD_AGENTS[0])
    resp = _hire(client, STANDARD_AGENTS[0])
    assert resp.status_code == 409
    assert resp.json()["error_code"] == "already_hired"


def test_free_tier_gets_one_slot(client):
    assert _hire(client, STANDARD_AGENTS[0]).status_code == 200
    resp = _hire(client, STANDARD_AGENTS[1])
    assert resp.status_code == 409
    assert resp.json()["error_code"] == "slots_full"


def test_pro_agent_blocked_on_free_tier(client):
    resp = _hire(client, PRO_AGENTS[0])
    assert resp.status_code == 402
    assert resp.json()["error_code"] == "pro_required"


def test_pro_tier_gets_five_slots_and_pro_agents(client):
    _go_pro(client)
    for key in (PRO_AGENTS[0], *STANDARD_AGENTS[:4]):
        assert _hire(client, key).status_code == 200
    resp = _hire(client, STANDARD_AGENTS[4])
    assert resp.status_code == 409
    assert resp.json()["error_code"] == "slots_full"


def test_fire_removes_roster_keeps_group(client):
    group_id = _hire(client, STANDARD_AGENTS[0]).json()["group_id"]
    resp = client.post("/api/staff/fire", json={"key": STANDARD_AGENTS[0]})
    assert resp.status_code == 200
    assert client.get("/api/staff/state").json()["roster"] == []

    from hermes_state import SessionDB

    db = SessionDB(db_path=client.db_path)
    assert group_id in {g["id"] for g in db.list_chat_groups()}


def test_fire_not_hired_is_404(client):
    assert client.post("/api/staff/fire", json={"key": STANDARD_AGENTS[0]}).status_code == 404


# -- schedules -------------------------------------------------------------

def test_schedule_blocked_on_free_tier(client):
    _hire(client, STANDARD_AGENTS[0])
    resp = client.post("/api/staff/schedule", json={"key": STANDARD_AGENTS[0]})
    assert resp.status_code == 402
    assert resp.json()["error_code"] == "pro_required"


def test_schedule_creates_cron_job_bound_to_group(client, cron):
    _go_pro(client)
    group_id = _hire(client, STANDARD_AGENTS[0]).json()["group_id"]
    resp = client.post("/api/staff/schedule", json={"key": STANDARD_AGENTS[0], "time": "08:30"})
    assert resp.status_code == 200
    job_id = resp.json()["job_id"]
    assert cron.jobs[job_id]["group_id"] == group_id
    assert cron.jobs[job_id]["schedule"].split()[:2] == ["30", "8"]

    entry = client.get("/api/staff/state").json()["roster"][0]
    assert entry["scheduled"] is True
    assert entry["schedule_time"] == "08:30"
    assert entry["job_id"] == job_id
    assert entry["next_run"]


def test_schedule_sets_catch_up_grace_for_wake_runs(client, cron):
    _go_pro(client)
    _hire(client, STANDARD_AGENTS[0])
    resp = client.post("/api/staff/schedule", json={"key": STANDARD_AGENTS[0], "time": "09:00"})
    assert resp.status_code == 200
    job = cron.jobs[resp.json()["job_id"]]
    assert job["catch_up_grace_seconds"] == staff_routes._SCHEDULE_CATCH_UP_SECONDS
    assert job["catch_up_grace_seconds"] == 72_000


def test_schedule_requires_hire_first(client):
    _go_pro(client)
    assert client.post("/api/staff/schedule", json={"key": STANDARD_AGENTS[0]}).status_code == 404


def test_schedule_bad_time_is_400(client):
    _go_pro(client)
    _hire(client, STANDARD_AGENTS[0])
    resp = client.post("/api/staff/schedule", json={"key": STANDARD_AGENTS[0], "time": "25:99"})
    assert resp.status_code == 400


def test_reschedule_replaces_previous_job(client, cron):
    _go_pro(client)
    _hire(client, STANDARD_AGENTS[0])
    first = client.post("/api/staff/schedule", json={"key": STANDARD_AGENTS[0], "time": "08:00"}).json()["job_id"]
    second = client.post("/api/staff/schedule", json={"key": STANDARD_AGENTS[0], "time": "09:00"}).json()["job_id"]
    assert first in cron.removed
    assert second != first


def test_unschedule_removes_job(client, cron):
    _go_pro(client)
    _hire(client, STANDARD_AGENTS[0])
    job_id = client.post("/api/staff/schedule", json={"key": STANDARD_AGENTS[0]}).json()["job_id"]
    resp = client.delete(f"/api/staff/schedule?key={STANDARD_AGENTS[0]}")
    assert resp.status_code == 200
    assert job_id in cron.removed
    entry = client.get("/api/staff/state").json()["roster"][0]
    assert entry["scheduled"] is False and entry["job_id"] is None


def test_fire_removes_scheduled_job(client, cron):
    _go_pro(client)
    _hire(client, STANDARD_AGENTS[0])
    job_id = client.post("/api/staff/schedule", json={"key": STANDARD_AGENTS[0]}).json()["job_id"]
    client.post("/api/staff/fire", json={"key": STANDARD_AGENTS[0]})
    assert job_id in cron.removed


# -- run now ---------------------------------------------------------------

def test_run_requires_hire(client):
    resp = client.post("/api/staff/run", json={"key": STANDARD_AGENTS[0]})
    assert resp.status_code == 404


def test_run_creates_triggered_one_shot_bound_to_group(client, cron):
    from hermes_cli.staff.catalog import get_agent

    agent = get_agent(STANDARD_AGENTS[0])
    group_id = _hire(client, agent.key).json()["group_id"]
    resp = client.post("/api/staff/run", json={"key": agent.key})
    assert resp.status_code == 200
    job_id = resp.json()["job_id"]
    assert resp.json()["status"] == "queued"

    job = cron.jobs[job_id]
    assert job["group_id"] == group_id
    assert agent.instructions.strip()[:60] in job["prompt"]
    assert agent.run_prompt in job["prompt"]
    assert job_id in cron.triggered

    entry = client.get("/api/staff/state").json()["roster"][0]
    assert entry["run_job_id"] == job_id
    assert entry["running"] is True


def test_run_works_on_free_tier(client):
    _hire(client, STANDARD_AGENTS[0])
    assert client.post("/api/staff/run", json={"key": STANDARD_AGENTS[0]}).status_code == 200


def test_run_while_pending_is_409(client):
    _hire(client, STANDARD_AGENTS[0])
    client.post("/api/staff/run", json={"key": STANDARD_AGENTS[0]})
    resp = client.post("/api/staff/run", json={"key": STANDARD_AGENTS[0]})
    assert resp.status_code == 409
    assert resp.json()["error_code"] == "run_in_progress"


def test_run_again_after_completion_is_allowed(client, cron):
    _hire(client, STANDARD_AGENTS[0])
    first = client.post("/api/staff/run", json={"key": STANDARD_AGENTS[0]}).json()["job_id"]
    cron.finish_run(first, "Report: inbox swept.")
    assert client.post("/api/staff/run", json={"key": STANDARD_AGENTS[0]}).status_code == 200


def test_state_exposes_last_report_after_run(client, cron):
    _hire(client, STANDARD_AGENTS[0])
    job_id = client.post("/api/staff/run", json={"key": STANDARD_AGENTS[0]}).json()["job_id"]
    cron.finish_run(job_id, "Report: 3 invoices chased, 1 reply drafted.")

    entry = client.get("/api/staff/state").json()["roster"][0]
    assert entry["running"] is False
    assert entry["last_report"]["source"] == "manual"
    assert "3 invoices chased" in entry["last_report"]["excerpt"]
    assert entry["last_report"]["at"] > 0
    assert entry["last_report"]["ok"] is True


def test_last_report_flags_failed_runs(client, cron):
    _hire(client, STANDARD_AGENTS[0])
    job_id = client.post("/api/staff/run", json={"key": STANDARD_AGENTS[0]}).json()["job_id"]
    cron.finish_run(
        job_id,
        "# Cron Job: Staff run: Inbox manager (FAILED)\n\n## Error\n\nRuntimeError: no provider",
    )

    entry = client.get("/api/staff/state").json()["roster"][0]
    assert entry["last_report"]["ok"] is False


def test_last_report_excerpt_skips_prompt_boilerplate(client, cron):
    """Real scheduler output files start with a header + the full prompt; the
    excerpt must show the agent's response, not that boilerplate."""
    _hire(client, STANDARD_AGENTS[0])
    job_id = client.post("/api/staff/run", json={"key": STANDARD_AGENTS[0]}).json()["job_id"]
    cron.finish_run(
        job_id,
        "# Cron Job: Staff run: Inbox manager\n\n"
        "**Job ID:** abc123\n**Run Time:** 2026-07-09 09:00:00\n\n"
        "## Prompt\n\n" + ("standing instructions " * 40) + "\n\n"
        "## Response\n\nSwept 12 messages: 2 need a reply today.",
    )

    excerpt = client.get("/api/staff/state").json()["roster"][0]["last_report"]["excerpt"]
    assert "Swept 12 messages" in excerpt
    assert "standing instructions" not in excerpt


def test_last_report_excerpt_shows_error_for_failed_runs(client, cron):
    _hire(client, STANDARD_AGENTS[0])
    job_id = client.post("/api/staff/run", json={"key": STANDARD_AGENTS[0]}).json()["job_id"]
    cron.finish_run(
        job_id,
        "# Cron Job: Staff run: Inbox manager (FAILED)\n\n"
        "## Prompt\n\n" + ("standing instructions " * 40) + "\n\n"
        "## Error\n\n```\nRuntimeError: no provider\n```",
    )

    report = client.get("/api/staff/state").json()["roster"][0]["last_report"]
    assert report["ok"] is False
    assert "RuntimeError: no provider" in report["excerpt"]
    assert "standing instructions" not in report["excerpt"]


def test_schedule_prompt_includes_instructions(client, cron):
    from hermes_cli.staff.catalog import get_agent

    agent = get_agent(STANDARD_AGENTS[0])
    _go_pro(client)
    _hire(client, agent.key)
    job_id = client.post("/api/staff/schedule", json={"key": agent.key}).json()["job_id"]
    prompt = cron.jobs[job_id]["prompt"]
    assert agent.instructions.strip()[:60] in prompt
    assert agent.run_prompt in prompt


def test_fire_removes_pending_run_job(client, cron):
    _hire(client, STANDARD_AGENTS[0])
    job_id = client.post("/api/staff/run", json={"key": STANDARD_AGENTS[0]}).json()["job_id"]
    client.post("/api/staff/fire", json={"key": STANDARD_AGENTS[0]})
    assert job_id in cron.removed


# -- connect ---------------------------------------------------------------

def test_connect_unknown_toolkit_is_404(client):
    assert client.post("/api/staff/connect", json={"toolkit": "faxmachine"}).status_code == 404


def test_connect_known_toolkit_returns_manual_path(client):
    resp = client.post("/api/staff/connect", json={"toolkit": "gmail"})
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["manual"] is True
    assert "gmail" in payload["message"]


def _fake_composio(monkeypatch, *, configured=True, link=None, active=False):
    # Patch the module object the routes actually hold a reference to. Other
    # test modules in the suite pop hermes_cli.* entries from sys.modules, so a
    # fresh `from hermes_cli.staff import composio` here can yield a different
    # module object than the one routes.py imported at load time.
    composio = staff_routes.composio

    monkeypatch.setattr(composio, "is_configured", lambda: configured)
    if isinstance(link, Exception):
        def _raise(_toolkit):
            raise link
        monkeypatch.setattr(composio, "connect_link", _raise)
    else:
        monkeypatch.setattr(composio, "connect_link", lambda _toolkit: link)
    if isinstance(active, Exception):
        def _raise_active(_toolkit):
            raise active
        monkeypatch.setattr(composio, "connection_active", _raise_active)
    else:
        monkeypatch.setattr(composio, "connection_active", lambda _toolkit: active)


def test_connect_with_composio_key_returns_link(client, monkeypatch):
    _fake_composio(monkeypatch, link="https://connect.composio.dev/session/abc")
    resp = client.post("/api/staff/connect", json={"toolkit": "gmail"})
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["manual"] is False
    assert payload["connect_url"] == "https://connect.composio.dev/session/abc"


def test_connect_composio_failure_is_502(client, monkeypatch):
    _fake_composio(monkeypatch, link=staff_routes.composio.ComposioError("api down"))
    resp = client.post("/api/staff/connect", json={"toolkit": "gmail"})
    assert resp.status_code == 502
    assert resp.json()["error_code"] == "composio_error"


# -- connect status ----------------------------------------------------------

def test_connect_status_unknown_toolkit_is_404(client):
    assert client.get("/api/staff/connect/status", params={"toolkit": "faxmachine"}).status_code == 404


def test_connect_status_not_connected(client):
    resp = client.get("/api/staff/connect/status", params={"toolkit": "gmail"})
    assert resp.status_code == 200
    assert resp.json() == {"connected": False, "source": None}


def test_connect_status_composio_active_persists_to_state(client, monkeypatch):
    _fake_composio(monkeypatch, active=True)
    resp = client.get("/api/staff/connect/status", params={"toolkit": "gmail"})
    assert resp.status_code == 200
    assert resp.json() == {"connected": True, "source": "composio"}

    # Persisted: /api/staff/state reports it without another Composio call,
    # even after the fake starts saying "not configured".
    _fake_composio(monkeypatch, configured=False, active=False)
    connections = {c["slug"]: c for c in client.get("/api/staff/state").json()["connections"]}
    assert connections["gmail"]["connected"] is True
    assert connections["gmail"]["source"] == "composio"


def test_connect_status_composio_failure_is_502(client, monkeypatch):
    _fake_composio(monkeypatch, active=staff_routes.composio.ComposioError("api down"))
    resp = client.get("/api/staff/connect/status", params={"toolkit": "gmail"})
    assert resp.status_code == 502
    assert resp.json()["error_code"] == "composio_error"


# -- connect status: MCP runtime registration --------------------------------
#
# An ACTIVE Composio connection alone gives the agent runtime no tools --
# nothing else registers an MCP server for it (tools/mcp_tool.py only loads
# url-based servers already present in config.yaml). The transition to
# ACTIVE must also register one.

def test_connect_status_active_registers_mcp_server(client, monkeypatch, fake_mcp):
    _fake_composio(monkeypatch, active=True)
    monkeypatch.setattr(
        staff_routes.composio,
        "mcp_url",
        lambda toolkit: f"https://backend.composio.dev/v3/mcp/{toolkit}?user_id=default",
    )

    resp = client.get("/api/staff/connect/status", params={"toolkit": "gmail"})

    assert resp.status_code == 200
    assert resp.json() == {"connected": True, "source": "composio"}
    assert fake_mcp.servers == {
        "composio_gmail": {"url": "https://backend.composio.dev/v3/mcp/gmail?user_id=default"}
    }
    assert len(fake_mcp.save_calls) == 1


def test_connect_status_active_registration_idempotent_on_second_call(client, monkeypatch, fake_mcp):
    _fake_composio(monkeypatch, active=True)
    monkeypatch.setattr(staff_routes.composio, "mcp_url", lambda _toolkit: "https://relay.example.com/mcp/1")

    first = client.get("/api/staff/connect/status", params={"toolkit": "gmail"})
    second = client.get("/api/staff/connect/status", params={"toolkit": "gmail"})

    assert first.status_code == second.status_code == 200
    assert first.json() == {"connected": True, "source": "composio"}
    # The registered "composio_gmail" server now makes _mcp_connected("gmail")
    # true too, so the second read reports source "mcp" -- still connected,
    # and crucially the registration itself only ran once.
    assert second.json() == {"connected": True, "source": "mcp"}
    assert len(fake_mcp.save_calls) == 1


def test_register_composio_mcp_server_skips_existing(monkeypatch, fake_mcp):
    # Unit-level: registering "composio_gmail" makes _mcp_connected("gmail")
    # true from then on (its normalized name contains the "gmail" needle), so
    # the routes-level ACTIVE branch is unreachable a second time via HTTP --
    # the internal idempotency check in _register_composio_mcp_server is the
    # only place this "already registered" path is actually exercised.
    fake_mcp.servers["composio_gmail"] = {"url": "https://already-there"}

    def _fail_if_called(_toolkit):
        raise AssertionError("mcp_url should not be called when a server is already registered")

    monkeypatch.setattr(staff_routes.composio, "mcp_url", _fail_if_called)

    staff_routes._register_composio_mcp_server("gmail")

    assert fake_mcp.save_calls == []


def test_connect_status_active_registration_failure_does_not_break_response(client, monkeypatch, fake_mcp):
    _fake_composio(monkeypatch, active=True)

    def _raise(_toolkit):
        raise staff_routes.composio.ComposioError("mcp registration failed")

    monkeypatch.setattr(staff_routes.composio, "mcp_url", _raise)

    resp = client.get("/api/staff/connect/status", params={"toolkit": "gmail"})

    assert resp.status_code == 200
    assert resp.json() == {"connected": True, "source": "composio"}
    assert fake_mcp.save_calls == []


# -- purchase_url fallback chain ----------------------------------------------

def test_purchase_url_env_wins_over_relay(client, monkeypatch):
    monkeypatch.setenv("BASECAMP_STAFF_PURCHASE_URL", "https://33labs.xyz/basecamp-pro")
    monkeypatch.setenv("BASECAMP_RELAY_URL", "https://relay.example.com")
    payload = client.get("/api/staff/state").json()
    assert payload["entitlement"]["purchase_url"] == "https://33labs.xyz/basecamp-pro"


def test_purchase_url_falls_back_to_relay_checkout(client, monkeypatch):
    monkeypatch.setenv("BASECAMP_RELAY_URL", "https://relay.example.com/")
    payload = client.get("/api/staff/state").json()
    assert payload["entitlement"]["purchase_url"] == "https://relay.example.com/api/v1/checkout"


def test_purchase_url_none_when_neither_set(client):
    payload = client.get("/api/staff/state").json()
    assert payload["entitlement"]["purchase_url"] is None
