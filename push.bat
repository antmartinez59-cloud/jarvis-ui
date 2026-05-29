@echo off
:: ╔══════════════════════════════════════════════════════════════╗
:: ║  JARVIS — One-Click Deploy                                   ║
:: ║  Pushes latest changes to GitHub → Vercel auto-deploys      ║
:: ║  Phone updates within ~30 seconds                           ║
:: ╚══════════════════════════════════════════════════════════════╝

echo.
echo [1/3] Staging all changes...
git add .

echo.
echo [2/3] Committing...
for /f "tokens=2 delims==" %%I in ('wmic os get localdatetime /value') do set dt=%%I
set timestamp=%dt:~0,4%-%dt:~4,2%-%dt:~6,2% %dt:~8,2%:%dt:~10,2%
git commit -m "JARVIS update — %timestamp%"

echo.
echo [3/3] Pushing to GitHub (Vercel will auto-deploy)...
git push

echo.
echo Done! Your phone will update in ~30 seconds.
echo Visit: https://project-jdhk7.vercel.app
echo.
pause
