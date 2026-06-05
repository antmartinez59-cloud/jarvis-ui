@echo off
:: ╔══════════════════════════════════════════════════════════════╗
:: ║     JARVIS — Supabase Edge Functions Deployer               ║
:: ║                                                              ║
:: ║  Run this ONCE after setup. Re-run any time you update      ║
:: ║  a function file.                                            ║
:: ║                                                              ║
:: ║  Prerequisites:                                              ║
:: ║    1. Node.js installed  (nodejs.org)                        ║
:: ║    2. Supabase CLI:  npm install -g supabase                 ║
:: ║    3. Run:  supabase login                                   ║
:: ║    4. Set your PROJECT_REF below (from Supabase dashboard)   ║
:: ╚══════════════════════════════════════════════════════════════╝

:: ── EDIT THIS ──────────────────────────────────────────────────
set PROJECT_REF=evedwhwepnuloqougztv
:: Get this from: supabase.com → your project → Settings → General → Reference ID
:: Looks like: abcdefghijklmnop  (16 chars)
:: ───────────────────────────────────────────────────────────────

:: Navigate to the JARVIS project folder (same folder as this .bat file)
cd /d "%~dp0"

:: ── TIMESTAMPED BACKUP — saved before every deploy ──────────────
:: If deploy breaks something, restore from BACKUPS\JARVIS_YYYY-MM-DD_HH-MM\
set BACKUP_TS=%date:~10,4%-%date:~4,2%-%date:~7,2%_%time:~0,2%-%time:~3,2%
set BACKUP_TS=%BACKUP_TS: =0%
set BACKUP_DIR=%~dp0BACKUPS\JARVIS_%BACKUP_TS%
echo.
echo [0/4] Creating pre-deploy backup...
mkdir "%BACKUP_DIR%" 2>nul
copy /Y "%~dp0index.html"            "%BACKUP_DIR%\index.html"            >nul
copy /Y "%~dp0server.py"             "%BACKUP_DIR%\server.py"             >nul
copy /Y "%~dp0schema_v9.sql"         "%BACKUP_DIR%\schema_v9.sql"         >nul
copy /Y "%~dp0pg_cron-setup.sql"     "%BACKUP_DIR%\pg_cron-setup.sql"     >nul
echo     Backup saved to: %BACKUP_DIR%
echo     (To restore: copy files from BACKUPS folder back here)
:: ────────────────────────────────────────────────────────────────

echo.
echo [1/4] Linking to Supabase project...
supabase link --project-ref %PROJECT_REF%
if errorlevel 1 (echo ERROR: Link failed. Check PROJECT_REF and run "supabase login" first. & pause & exit /b 1)

echo.
echo [2/3] Deploying Edge Functions...

:: ── Original 6 functions ─────────────────────────────────────
supabase functions deploy proxy          --no-verify-jwt
supabase functions deploy search         --no-verify-jwt
supabase functions deploy browse         --no-verify-jwt
supabase functions deploy reflect        --no-verify-jwt
supabase functions deploy github-sync    --no-verify-jwt
supabase functions deploy obsidian-write --no-verify-jwt

:: ── Layer 1 + 2: Intelligence functions ──────────────────────
supabase functions deploy synthesize     --no-verify-jwt
supabase functions deploy weather        --no-verify-jwt
supabase functions deploy news           --no-verify-jwt
supabase functions deploy morning-brief  --no-verify-jwt

:: ── Automations ───────────────────────────────────────────
supabase functions deploy apple-remind        --no-verify-jwt
supabase functions deploy automate            --no-verify-jwt
supabase functions deploy automation-builder  --no-verify-jwt

:: ── Layer 3 — Daily Trackers ──────────────────────────────
supabase functions deploy meal-photo          --no-verify-jwt

:: ── Debug Agent ─────────────────────────────────────────────
supabase functions deploy debug-agent         --no-verify-jwt

:: ── Layer 7 — Integrations ───────────────────────────────────
supabase functions deploy apple-calendar      --no-verify-jwt

:: ── Layer 1 — Voice Engine (backend) ─────────────────────────
supabase functions deploy voice-token         --no-verify-jwt
supabase functions deploy voice-speak         --no-verify-jwt

echo.
echo [3/3] Done! Your Edge Function URLs are:
echo.
echo   [Core]
echo   https://%PROJECT_REF%.supabase.co/functions/v1/proxy
echo   https://%PROJECT_REF%.supabase.co/functions/v1/search
echo   https://%PROJECT_REF%.supabase.co/functions/v1/browse
echo   https://%PROJECT_REF%.supabase.co/functions/v1/reflect
echo   https://%PROJECT_REF%.supabase.co/functions/v1/github-sync
echo   https://%PROJECT_REF%.supabase.co/functions/v1/obsidian-write
echo.
echo   [Intelligence]
echo   https://%PROJECT_REF%.supabase.co/functions/v1/synthesize
echo   https://%PROJECT_REF%.supabase.co/functions/v1/weather
echo   https://%PROJECT_REF%.supabase.co/functions/v1/news
echo   https://%PROJECT_REF%.supabase.co/functions/v1/morning-brief
echo.
echo   [Debug Agent]
echo   https://%PROJECT_REF%.supabase.co/functions/v1/debug-agent
echo.
echo Next steps:
echo   1. Set required secrets (see secrets-setup.md)
echo   2. Run schema_v2.sql + schema_v7.sql in Supabase SQL Editor
echo   3. Run pg_cron-setup.sql in Supabase SQL Editor to schedule briefings + debug agent
echo.
pause
