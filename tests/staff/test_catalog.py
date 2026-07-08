"""Shape checks for the staff agent catalog."""

from __future__ import annotations

from hermes_cli.staff.catalog import AGENT_KEYS, CATALOG, catalog_entry, get_agent

_CATEGORIES = {"money", "inbox", "sales", "content", "ops"}
_TIERS = {"standard", "pro"}
_TOOLKITS = {
    "gmail", "googlecalendar", "notion", "slack", "stripe",
    "github", "linear", "hubspot", "googlesheets", "googledrive",
}


def test_catalog_has_twelve_unique_agents():
    assert len(CATALOG) == 12
    assert len(AGENT_KEYS) == 12
    assert AGENT_KEYS == {a.key for a in CATALOG}


def test_every_agent_is_well_formed():
    for agent in CATALOG:
        assert agent.category in _CATEGORIES, agent.key
        assert agent.tier in _TIERS, agent.key
        assert set(agent.requires) <= _TOOLKITS, agent.key
        assert agent.requires, agent.key
        assert len(agent.tagline) <= 60, agent.key
        assert len(agent.proof) <= 40, agent.key
        assert agent.instructions.strip(), agent.key
        assert agent.run_prompt.strip(), agent.key


def test_schedule_templates_render_to_cron():
    for agent in CATALOG:
        rendered = agent.schedule_template.format(minute=30, hour=8)
        assert "{" not in rendered and "}" not in rendered, agent.key
        assert rendered.split()[0] == "30", agent.key


def test_default_time_is_hh_mm():
    for agent in CATALOG:
        hour, minute = agent.default_time.split(":")
        assert 0 <= int(hour) <= 23, agent.key
        assert 0 <= int(minute) <= 59, agent.key


def test_get_agent_round_trip_and_serializer():
    agent = get_agent("invoice-chaser")
    assert agent is not None
    entry = catalog_entry(agent)
    assert entry["key"] == "invoice-chaser"
    assert isinstance(entry["requires"], list)
    assert get_agent("no-such-agent") is None
