@echo off
REM StatSeer -- weekly CFB Card/ratings refresh (local, machine-specific).
REM Pulls the latest 2026 results, recomputes the power rating + homepage Card, and
REM if anything changed, commits web/app/ncaaf/model-data.ts to main so Vercel redeploys.
REM Ratings only move on game days, so weekly (post-weekend) is the useful cadence.
REM Scheduled via Windows Task "StatSeer-CFB-Refresh". Log: data\cfb_refresh.log
setlocal
set PY="C:\Users\joann\AppData\Local\Programs\Python\Python312\python.exe"
cd /d C:\Users\joann\nfl-advice-app
if not exist data mkdir data
echo ==== %DATE% %TIME% weekly refresh ==== >> data\cfb_refresh.log
git checkout main >> data\cfb_refresh.log 2>&1
git pull --ff-only origin main >> data\cfb_refresh.log 2>&1
%PY% cfb_backfill.py --start 2026 --end 2026 >> data\cfb_refresh.log 2>&1
%PY% cfb_export.py >> data\cfb_refresh.log 2>&1
git add web/app/ncaaf/model-data.ts
git diff --cached --quiet
if errorlevel 1 (
  git commit -m "CFB: auto weekly Card/ratings refresh" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>" >> data\cfb_refresh.log 2>&1
  git push origin main >> data\cfb_refresh.log 2>&1
  echo refreshed + pushed >> data\cfb_refresh.log
) else (
  echo no rating change this week >> data\cfb_refresh.log
)
endlocal
