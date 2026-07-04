@echo off
rem Basecamp claude shim (passthrough placeholder - real mint logic added later).
if defined BASECAMP_REAL_CLAUDE ("%BASECAMP_REAL_CLAUDE%" %*) else (claude %*)
