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

echo.
echo [1/3] Linking to Supabase project...
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
echo Next steps:
echo   1. Set required secrets (see secrets-setup.md)
echo   2. Run schema_v2.sql in Supabase SQL Editor
echo   3. Run pg_cron-setup.sql in Supabase SQL Editor to schedule briefings
echo.
pause
