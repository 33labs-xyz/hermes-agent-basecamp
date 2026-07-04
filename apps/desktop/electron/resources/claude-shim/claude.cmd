@echo off
setlocal enabledelayedexpansion
rem Basecamp claude shim (Windows): mint a tracked --session-id on a fresh
rem launch, passthrough everything else. Never breaks a valid claude command.

set "REAL=%BASECAMP_REAL_CLAUDE%"
if not defined REAL set "REAL=claude"

set "MINT=1"
for %%A in (%*) do (
  set "ARG=%%~A"
  if "!ARG!"=="-r" set "MINT=0"
  if "!ARG!"=="--resume" set "MINT=0"
  if "!ARG!"=="-c" set "MINT=0"
  if "!ARG!"=="--continue" set "MINT=0"
  if "!ARG!"=="--session-id" set "MINT=0"
  if "!ARG!"=="-p" set "MINT=0"
  if "!ARG!"=="--print" set "MINT=0"
  if "!ARG!"=="--version" set "MINT=0"
  if "!ARG!"=="-v" set "MINT=0"
  if "!ARG!"=="--help" set "MINT=0"
  if "!ARG!"=="-h" set "MINT=0"
  if "!ARG!"=="--fork-session" set "MINT=0"
  if "!ARG!"=="mcp" set "MINT=0"
  if "!ARG!"=="config" set "MINT=0"
  if "!ARG!"=="update" set "MINT=0"
  if "!ARG!"=="doctor" set "MINT=0"
  if "!ARG!"=="migrate-installer" set "MINT=0"
  if "!ARG!"=="setup-token" set "MINT=0"
  if "!ARG!"=="install" set "MINT=0"
)

if "%MINT%"=="0" (
  "%REAL%" %*
  exit /b %ERRORLEVEL%
)

for /f "usebackq delims=" %%I in (`powershell -NoProfile -Command "[guid]::NewGuid().ToString()"`) do set "TSID=%%I"
if defined BASECAMP_TS_DIR if defined TSID (
  for /f "usebackq delims=" %%R in (`git rev-parse --show-toplevel 2^>nul`) do set "TSROOT=%%R"
  >>"%BASECAMP_TS_DIR%\launches.jsonl" echo {"id":"!TSID!","cwd":"!CD!","gitRoot":"!TSROOT!","ts":0,"kind":"launch"}
)
if defined TSID (
  "%REAL%" --session-id !TSID! %*
  exit /b %ERRORLEVEL%
)
"%REAL%" %*
exit /b %ERRORLEVEL%
