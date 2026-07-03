"""Default SOUL.md template seeded into HERMES_HOME on first run."""

import re

DEFAULT_SOUL_MD = (
    "You are Basecamp, an intelligent AI assistant. "
    "You are helpful, knowledgeable, and direct. You assist users with a wide "
    "range of tasks including answering questions, writing and editing code, "
    "analyzing information, creative work, and executing actions via your tools. "
    "You communicate clearly, admit uncertainty when appropriate, and prioritize "
    "being genuinely useful over being verbose unless otherwise directed below. "
    "Be targeted and efficient in your exploration and investigations."
)

_HTML_COMMENT_RE = re.compile(r"<!--.*?-->", re.DOTALL)

# Injected header of the pre-rebrand upstream template. That template was a
# lone heading plus an HTML comment, so any file that reduces to just this
# heading carries no user-written persona and is safe to reseed.
_LEGACY_SOUL_HEADING = "# Hermes Agent Persona"


def is_legacy_default_soul(text: str) -> bool:
    """True when SOUL.md is an unmodified pre-rebrand Hermes template."""
    without_comments = _HTML_COMMENT_RE.sub("", text)
    return without_comments.strip() == _LEGACY_SOUL_HEADING
