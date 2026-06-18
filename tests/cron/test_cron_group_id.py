"""Tests for project (chat_group) scoping of cron jobs via group_id."""

import json

import pytest

from cron.jobs import create_job, get_job, list_jobs, load_jobs, save_jobs


@pytest.fixture()
def tmp_cron_dir(tmp_path, monkeypatch):
    monkeypatch.setattr("cron.jobs.CRON_DIR", tmp_path / "cron")
    monkeypatch.setattr("cron.jobs.JOBS_FILE", tmp_path / "cron" / "jobs.json")
    monkeypatch.setattr("cron.jobs.OUTPUT_DIR", tmp_path / "cron" / "output")
    return tmp_path


def test_create_job_persists_group_id(tmp_cron_dir):
    job = create_job(prompt="Weekly report", schedule="every 1h", group_id="proj_abc")
    assert job["group_id"] == "proj_abc"

    fetched = get_job(job["id"])
    assert fetched["group_id"] == "proj_abc"

    listed = list_jobs(include_disabled=True)
    assert any(j["id"] == job["id"] and j["group_id"] == "proj_abc" for j in listed)


def test_create_job_without_group_id_is_none(tmp_cron_dir):
    job = create_job(prompt="Global task", schedule="every 1h")
    assert job["group_id"] is None
    assert get_job(job["id"])["group_id"] is None


def test_blank_group_id_normalizes_to_none(tmp_cron_dir):
    job = create_job(prompt="Trimmed", schedule="every 1h", group_id="   ")
    assert job["group_id"] is None


def test_legacy_job_without_group_id_reads_as_none(tmp_cron_dir):
    # A hand-written/legacy job record that predates the group_id field must
    # still read back cleanly with group_id defaulted to None.
    legacy = create_job(prompt="Legacy", schedule="every 1h")
    raw = load_jobs()
    for entry in raw:
        entry.pop("group_id", None)
    save_jobs(raw)

    assert "group_id" not in json.dumps({k: v for k, v in load_jobs()[0].items() if k == "group_id"})
    assert get_job(legacy["id"])["group_id"] is None
