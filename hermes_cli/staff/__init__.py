"""Staff marketplace: hireable pre-built agents behind an entitlement gate.

An agent "hire" is a chat group seeded with the agent's standing instructions
(the group-instructions injection in ``SessionDB.build_project_context`` does
the rest), plus an optional cron job when the user schedules it. The catalog
lives in :mod:`hermes_cli.staff.catalog`; HTTP endpoints in
:mod:`hermes_cli.staff.routes`.
"""
