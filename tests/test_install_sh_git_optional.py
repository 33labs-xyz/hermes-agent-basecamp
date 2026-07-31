"""Regression: first-launch bootstrap hangs 15 minutes at the prerequisites stage.

Tester logs (MacBook M3, macOS Tahoe 26.5, no Homebrew, no Xcode Command Line
Tools) show every run dying in the same place::

    -> Checking Git...
    x  Git not found
    -> Attempting to install Git automatically...
    -> Requesting Apple Command Line Tools (provides git + compiler)...
    -> Still waiting for Command Line Tools install (1m)...
    ... 15 identical lines ...
    !  Could not install Git automatically.

``xcode-select --install`` pops a macOS dialog that Apple gates behind a user
click; it cannot be driven headlessly. When the dialog is dismissed, opens
behind the app window, or is otherwise never completed, the installer polls for
a full 900 seconds and then fails anyway -- and because the desktop bootstrap
runner spawns install.sh with no timeout, the UI just spins silently the whole
time.

The fix removes git from the critical path entirely: ``curl`` and ``tar`` ship
with every macOS and need no Command Line Tools, so the repository can be
fetched as a tarball. git stays a nice-to-have (used when present), never a
blocker.
"""

from __future__ import annotations

import re
import shlex
import shutil
import subprocess
import tarfile
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
INSTALL_SH = REPO_ROOT / "scripts" / "install.sh"

pytestmark = pytest.mark.skipif(shutil.which("bash") is None, reason="needs bash")


def _extract_function(name: str) -> str:
    """Pull a top-level ``name() { ... }`` block out of install.sh."""
    text = INSTALL_SH.read_text()
    m = re.search(rf"^{re.escape(name)}\(\) \{{\n.*?^\}}", text, re.DOTALL | re.MULTILINE)
    assert m is not None, f"{name}() not found in install.sh"
    return m.group(0)


# Minimal stand-ins for the logging helpers every extracted function calls.
_LOG_STUBS = """
log_info()    { echo "INFO: $*"; }
log_success() { echo "OK: $*"; }
log_warn()    { echo "WARN: $*"; }
log_error()   { echo "ERR: $*"; }
"""


def _run(script: str, cwd: Path | None = None, timeout: int = 60) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["bash", "-c", script],
        capture_output=True,
        text=True,
        cwd=str(cwd) if cwd else None,
        timeout=timeout,
    )


# ---------------------------------------------------------------------------
# check_git must degrade, not block
# ---------------------------------------------------------------------------


def test_check_git_without_git_does_not_exit_and_flags_unavailable(tmp_path: Path) -> None:
    """A Mac with no git must fall through to the tarball path, not abort.

    Before the fix this called attempt_install_git -> xcode-select --install ->
    900s poll -> ``exit 1``, killing the prerequisites stage.
    """
    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    # A PATH with no git at all -- the state the tester's machine was in.
    for tool in ("uname", "awk", "sed", "grep", "cat", "echo", "sleep"):
        real = shutil.which(tool)
        if real:
            (fake_bin / tool).symlink_to(real)

    script = (
        f"PATH={shlex.quote(str(fake_bin))}\n"
        f"{_LOG_STUBS}\n"
        "OS=macos\n"
        "DISTRO=macos\n"
        f"{_extract_function('attempt_install_git')}\n"
        f"{_extract_function('check_git')}\n"
        'check_git; rc=$?\n'
        'echo "RC=$rc"\n'
        'echo "GIT_AVAILABLE=${GIT_AVAILABLE:-unset}"\n'
    )
    res = _run(script, timeout=90)

    assert "RC=0" in res.stdout, f"check_git aborted the stage:\n{res.stdout}\n{res.stderr}"
    assert "GIT_AVAILABLE=false" in res.stdout, (
        f"check_git must record that git is missing so clone_repo can route to "
        f"the tarball path:\n{res.stdout}"
    )


def test_macos_git_install_does_not_poll_for_command_line_tools() -> None:
    """No 900-second blind wait on a GUI dialog we cannot click."""
    body = _extract_function("attempt_install_git")
    macos_branch = body.split("linux)")[0]

    assert "xcode-select --install" not in macos_branch, (
        "xcode-select --install pops a dialog Apple gates behind a user click; "
        "triggering it and polling is what burned 15 minutes per run"
    )
    assert "timeout=900" not in macos_branch, "the 15-minute CLT poll must be gone"


# ---------------------------------------------------------------------------
# Tarball fallback
# ---------------------------------------------------------------------------


def test_download_repo_tarball_extracts_without_git(tmp_path: Path) -> None:
    """curl + tar must populate INSTALL_DIR with the repo contents."""
    # Build a tarball shaped like GitHub's: a single <repo>-<ref>/ top directory.
    src = tmp_path / "hermes-agent-basecamp-abc123"
    (src / "scripts").mkdir(parents=True)
    (src / "pyproject.toml").write_text("[project]\nname='hermes'\n")
    (src / "scripts" / "install.sh").write_text("#!/bin/bash\n")
    tarball = tmp_path / "repo.tar.gz"
    with tarfile.open(tarball, "w:gz") as tf:
        tf.add(src, arcname=src.name)

    # Stub curl so the test never touches the network: it just copies our fixture
    # to whatever -o path the function asked for.
    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    curl_stub = fake_bin / "curl"
    curl_stub.write_text(
        "#!/bin/bash\n"
        "out=''\n"
        'while [ $# -gt 0 ]; do\n'
        '  case "$1" in -o) out="$2"; shift 2 ;; *) shift ;; esac\n'
        "done\n"
        f'cp {shlex.quote(str(tarball))} "$out"\n'
    )
    curl_stub.chmod(0o755)

    install_dir = tmp_path / "install" / "hermes-agent"
    script = (
        f'PATH={shlex.quote(str(fake_bin))}:"$PATH"\n'
        f"{_LOG_STUBS}\n"
        'REPO_SLUG="33labs-xyz/hermes-agent-basecamp"\n'
        "BRANCH=main\n"
        'INSTALL_COMMIT=""\n'
        f"INSTALL_DIR={shlex.quote(str(install_dir))}\n"
        f"{_extract_function('download_repo_tarball')}\n"
        "download_repo_tarball; echo RC=$?\n"
    )
    res = _run(script, timeout=60)

    assert "RC=0" in res.stdout, f"tarball download failed:\n{res.stdout}\n{res.stderr}"
    # Contents land at the root of INSTALL_DIR, not nested in the wrapper dir.
    assert (install_dir / "pyproject.toml").is_file(), (
        f"repo contents missing; tree: {list(install_dir.rglob('*')) if install_dir.exists() else 'no dir'}"
    )
    assert (install_dir / "scripts" / "install.sh").is_file()


def test_clone_repo_routes_to_tarball_when_git_unavailable() -> None:
    """clone_repo must consult GIT_AVAILABLE before reaching for git."""
    body = _extract_function("clone_repo")
    assert "GIT_AVAILABLE" in body, "clone_repo still assumes git exists"
    assert "download_repo_tarball" in body, "clone_repo has no tarball path"


def test_existing_tarball_install_is_refreshed_not_rejected() -> None:
    """A tarball install has no .git; updating must not error out.

    The old code hit ``Directory exists but is not a git repository`` and exited,
    which would strand every tarball-installed tester on the first update.
    """
    body = _extract_function("clone_repo")
    marker_guard = re.search(r"TARBALL_MARKER|\.basecamp-source", body)
    assert marker_guard is not None, (
        "clone_repo must recognise a previous tarball install and refresh it "
        "instead of failing with 'not a git repository'"
    )


# ---------------------------------------------------------------------------
# No unbounded network calls
# ---------------------------------------------------------------------------


def test_every_curl_has_connect_and_max_timeouts() -> None:
    """A stalled TCP connection must not hang the installer forever.

    bootstrap-runner.cjs spawns install.sh with no timeout, so any curl that
    hangs is an permanent silent spinner in the desktop UI.
    """
    text = INSTALL_SH.read_text()
    offenders = []
    for lineno, line in enumerate(text.splitlines(), start=1):
        stripped = line.strip()
        if stripped.startswith("#") or "curl " not in line:
            continue
        # Only real invocations, not prose or the ``command -v curl`` probe.
        if re.search(r"(command -v|which)\s+curl", line):
            continue
        if re.search(r"\blog_(info|warn|error|success)\b", line):
            continue
        if not re.search(r"\bcurl\b\s+-", line):
            continue
        if "--max-time" not in line or "--connect-timeout" not in line:
            offenders.append(f"  install.sh:{lineno}: {stripped}")

    assert not offenders, "curl calls without timeouts:\n" + "\n".join(offenders)
