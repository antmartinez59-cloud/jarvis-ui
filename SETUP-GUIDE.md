# JARVIS — Complete Serverless Setup Guide

Everything runs from the cloud. Your computer does not need to be on.
Access JARVIS from your phone, tablet, or any browser.

---

## What you're building

```
Your browser / iPhone
       ↓
  Vercel (hosts the UI — free, public URL)
       ↓
  Supabase Edge Functions (API proxy, search, AI, GitHub write)
       ↓
  Supabase Postgres (all your data — sessions, memory, agents, repos)
       ↓
  GitHub repo (Obsidian vault — obsidian-git syncs to your devices)
```

---

## STEP 1 — Supabase project (if not done)

1. Go to [supabase.com](https://supabase.com) → **New Project**
2. Note your **Project URL** and **anon public key** (Settings → API)
3. Run schema: paste contents of `schema.sql` into the SQL editor → Run

---

## STEP 2 — Install Supabase CLI

Open a terminal (PowerShell on Windows):

```bash
npm install -g supabase
supabase login
```

This opens a browser to authenticate with your Supabase account.

---

## STEP 3 — Link your project

```bash
# Navigate to your JARVIS folder first
cd "C:\Users\antma\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\local-agent-mode-sessions\ab340259-0385-420d-b7a1-b23a70d9ef2a"

supabase link --project-ref YOUR_PROJECT_REF
```

Your **Project Ref** is the 16-character ID in Settings → General → Reference ID
(looks like: `abcdefghijklmnop`)

---

## STEP 4 — Set your secrets in Supabase Vault

These API keys live encrypted in Supabase — never in your browser.

```bash
# Required: Anthropic (for AI)
supabase secrets set ANTHROPIC_KEY=sk-ant-...

# Required: GitHub token (for GitHub sync + Obsidian write)
# Create at: github.com → Settings → Developer settings → Personal access tokens → Fine-grained
# Permissions needed: Contents (read+write) on your repos
supabase secrets set GITHUB_TOKEN=github_pat_...

# Required: Your Obsidian vault repo (username/repo-name)
supabase secrets set GITHUB_OBSIDIAN_REPO=antmartinez59/jarvis-vault

# Optional but recommended: Brave Search (2,000 free searches/month)
# Get key at: brave.com/search/api
supabase secrets set BRAVE_KEY=BSA...
```

Verify secrets are set:
```bash
supabase secrets list
```

---

## STEP 5 — Deploy Edge Functions

**Option A: Use the batch script (easiest)**

1. Open `deploy-edge-functions.bat`
2. Change `YOUR_PROJECT_REF_HERE` to your actual ref
3. Double-click it — it deploys all 6 functions

**Option B: Manual**

```bash
supabase functions deploy proxy          --no-verify-jwt
supabase functions deploy search         --no-verify-jwt
supabase functions deploy browse         --no-verify-jwt
supabase functions deploy reflect        --no-verify-jwt
supabase functions deploy github-sync    --no-verify-jwt
supabase functions deploy obsidian-write --no-verify-jwt
```

Your functions will be live at:
```
https://YOUR_REF.supabase.co/functions/v1/proxy
https://YOUR_REF.supabase.co/functions/v1/search
https://YOUR_REF.supabase.co/functions/v1/browse
https://YOUR_REF.supabase.co/functions/v1/reflect
https://YOUR_REF.supabase.co/functions/v1/github-sync
https://YOUR_REF.supabase.co/functions/v1/obsidian-write
```

---

## STEP 6 — Configure JARVIS UI with your Supabase keys

Open JARVIS in your browser → click the **Supabase badge** in the header (top right) → Settings

Fill in:
- **Supabase URL**: `https://YOUR_REF.supabase.co`
- **Supabase Key**: your `anon public` key (starts with `eyJ...`)
- **Brave API Key**: if you have one (optional — falls back to DuckDuckGo)

Save. The badge in the top right should switch from `⏳ Loading` to `☁️ Serverless`.

---

## STEP 7 — Host JARVIS on Vercel (phone access)

### Option A: Drag and drop (easiest, no Git needed)

1. Go to [vercel.com](https://vercel.com) → Sign up free with GitHub
2. Click **Add New → Project → Browse**
3. Upload just `index.html` (or zip the whole folder)
4. Deploy → You get a URL like `jarvis-xyz.vercel.app`

### Option B: GitHub → Vercel (auto-deploys on file changes)

```bash
# From your JARVIS folder:
git init
git add index.html
git commit -m "JARVIS UI"
git remote add origin https://github.com/antmartinez59/jarvis-ui.git
git push -u origin main
```

Then in Vercel: **Import Git Repository** → select `jarvis-ui` → Deploy.

Every time you push changes to GitHub, Vercel auto-redeploys.

---

## STEP 8 — Create your Obsidian GitHub vault

1. Go to [github.com](https://github.com) → **New repository**
2. Name it `jarvis-vault` (must be **private**)
3. Initialize with a README

Your GitHub token (set in Step 4) has write access.
When you save notes from JARVIS, they go straight to this repo — even with your computer off.

---

## STEP 9 — Set up obsidian-git on desktop

1. Open Obsidian → Settings → Community Plugins → Browse
2. Search `obsidian-git` → Install → Enable
3. Settings → obsidian-git:
   - **Remote URL**: `https://github.com/antmartinez59/jarvis-vault.git`
   - **Auto pull interval**: 5 minutes
   - **Auto push interval**: 5 minutes
4. Open the command palette (`Ctrl+P`) → `obsidian-git: Clone existing remote repo`
5. Paste your repo URL → Let it clone

Now your vault syncs automatically. Files written by JARVIS Edge Function appear within 5 minutes.

---

## STEP 10 — Set up obsidian-git on iPhone/Android

**iPhone:**
1. Install [Obsidian](https://apps.apple.com/app/obsidian-md/id1557175905) from App Store
2. Install [Working Copy](https://apps.apple.com/app/working-copy-git-client/id896694807) (Git client for iOS — free tier works)
3. In Working Copy: Clone `https://github.com/antmartinez59/jarvis-vault.git`
4. In Obsidian: Open vault → Select the folder synced by Working Copy
5. In obsidian-git settings: set auto-pull to run on startup

**Android:**
1. Install Obsidian from Play Store
2. Install [Termux](https://termux.dev) (terminal emulator)
3. In Termux:
   ```bash
   pkg install git
   git clone https://github.com/antmartinez59/jarvis-vault.git ~/storage/shared/jarvis-vault
   ```
4. Open Obsidian → Open vault → navigate to `jarvis-vault` folder
5. obsidian-git will handle future syncs

---

## Verification checklist

After setup, verify everything works:

- [ ] Open JARVIS at your Vercel URL on your phone
- [ ] Header shows `☁️ Serverless` badge
- [ ] Ask something in Council — AI responds (confirms proxy Edge Function works)
- [ ] Go to Mastery → start a research run — search results appear (confirms search + browse work)
- [ ] Go to Repos → Sync GitHub — your repos appear (confirms github-sync works)
- [ ] Save a note from JARVIS → check GitHub `jarvis-vault` repo in 30 seconds — file appears
- [ ] Wait 5 minutes → open Obsidian → file synced to vault

---

## Troubleshooting

**"☁️ Serverless" not showing:**
- Check Supabase URL and anon key are entered in Settings
- Make sure URL format is `https://ref.supabase.co` (no trailing slash)

**Edge Function errors:**
```bash
# Check function logs in Supabase dashboard:
# supabase.com → your project → Edge Functions → click function → Logs
```

**"ANTHROPIC_KEY not set":**
```bash
supabase secrets set ANTHROPIC_KEY=sk-ant-your-key-here
# Then redeploy: supabase functions deploy proxy --no-verify-jwt
```

**Search returning no results:**
- Brave key not set → falls back to DuckDuckGo (still works, fewer results)
- Check: `supabase secrets list` → should show BRAVE_KEY

**Obsidian not syncing:**
- Check your GITHUB_TOKEN has `contents: write` permission on the vault repo
- Manually trigger: obsidian-git command palette → `Pull`

**Rate limits:**
- GitHub API: 5,000 req/hour with token (set GITHUB_TOKEN)
- Brave Search: 2,000/month free
- Anthropic: depends on your plan
- Supabase Edge Functions: 500,000 free invocations/month

---

## Cost estimate (all free tiers)

| Service | Free tier |
|---|---|
| Supabase | 500MB DB, 500K edge function calls/month |
| Vercel | Unlimited static hosting |
| GitHub | Unlimited private repos |
| Brave Search | 2,000 searches/month |
| Anthropic | Pay per use (Council + Mastery calls) |

Total monthly cost for typical use: **~$0** except Anthropic API calls.

---

## What works without your computer on

✅ JARVIS UI (hosted on Vercel)
✅ Council AI conversations (Supabase → Anthropic API)
✅ Mastery research runs (Supabase → Brave/DDG → browse URLs)
✅ GitHub repo sync (Supabase → GitHub API)
✅ Obsidian note writing (Supabase → GitHub API → obsidian-git syncs on device)
✅ Memory & reflection (all in Supabase Postgres)
✅ Agent library (stored in Supabase)

❌ server.py local endpoints (computer must be on) — not needed in serverless mode
