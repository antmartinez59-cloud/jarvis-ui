# JARVIS — Secrets Setup Guide

All secrets live in Supabase Vault — never in your browser or code.

Run these in PowerShell (one paste, hit enter):

---

## Required secrets (you set these previously)

```powershell
supabase secrets set ANTHROPIC_KEY=sk-ant-YOUR_KEY_HERE
supabase secrets set GITHUB_TOKEN=github_pat_YOUR_TOKEN_HERE
supabase secrets set GITHUB_OBSIDIAN_REPO=antmartinez59/jarvis-vault
supabase secrets set BRAVE_KEY=BSA_YOUR_KEY_HERE
```

---

## Layer 1 + 2 — New secrets to add now

### Twilio (SMS notifications)
Get free account at: twilio.com → sign up → Console Dashboard

```powershell
supabase secrets set TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
supabase secrets set TWILIO_AUTH_TOKEN=your_auth_token_here
supabase secrets set TWILIO_FROM_NUMBER=+1XXXXXXXXXX
supabase secrets set TWILIO_TO_NUMBER=+1XXXXXXXXXX
```

- `TWILIO_FROM_NUMBER` = the Twilio phone number assigned to you (looks like +14155552671)
- `TWILIO_TO_NUMBER` = YOUR AT&T phone number (your personal number that will receive SMS)

**Free tier:** 1 Twilio trial number, 15.50 USD free credit (~250+ SMS messages). Plenty to start.

---

### Resend (email briefings)
Get free API key at: resend.com → Sign up → API Keys → Create API Key

```powershell
supabase secrets set RESEND_API_KEY=re_YOUR_API_KEY_HERE
```

**Free tier:** 3,000 emails/month, 100/day. More than enough for 5 daily briefings.

**Important:** Resend free tier only lets you send from `onboarding@resend.dev` until you verify a domain. That's fine — briefings will arrive from that address. You can verify a custom domain later.

---

### OpenWeatherMap (weather)
Get free API key at: openweathermap.org → Sign up → My API Keys

```powershell
supabase secrets set OPENWEATHER_KEY=your_api_key_here
```

**Free tier:** 1,000 calls/day — JARVIS uses ~10-15/day. No problem.

**Note:** New API keys take up to 2 hours to activate after signup.

---

### NewsAPI (news headlines)
Get free API key at: newsapi.org → Get API Key

```powershell
supabase secrets set NEWS_API_KEY=your_api_key_here
```

**Free tier:** 100 requests/day, US headlines only. Enough for briefings.

**Note:** Free tier has a 24-hour delay on some sources (developer plan). Paid is $449/mo — stick with free + Brave/DuckDuckGo combo.

---

## Verify all secrets are set

```powershell
supabase secrets list
```

You should see all keys listed (values are hidden for security).

---

### Apple Reminders + Calendar (CalDAV)
Used for: all automated reminders (water, workout, subscriptions, todos, sleep, meals)

```powershell
supabase secrets set APPLE_CALDAV_USER=your.apple.id@icloud.com
supabase secrets set APPLE_CALDAV_PASSWORD=xxxx-xxxx-xxxx-xxxx
```

**How to get your app-specific password:**
1. Go to appleid.apple.com
2. Sign in → Sign-In & Security → App-Specific Passwords
3. Click **Generate an app-specific password**
4. Name it "JARVIS" → copy the password (looks like `xxxx-xxxx-xxxx-xxxx`)

**Note:** Use your iCloud email for `APPLE_CALDAV_USER` (e.g. `tony@icloud.com` or your Gmail if that's your Apple ID). Reminders will appear in the **Reminders** app on your iPhone instantly.

---

## After adding secrets

Redeploy the new functions so they pick up the new secrets:

```powershell
supabase functions deploy synthesize     --no-verify-jwt
supabase functions deploy weather        --no-verify-jwt
supabase functions deploy news           --no-verify-jwt
supabase functions deploy morning-brief  --no-verify-jwt
```

Or just double-click `deploy-edge-functions.bat` — it deploys everything.

---

## Test that everything works

### Test weather (paste in PowerShell):
```powershell
curl -s "https://evedwhwepnuloqougztv.supabase.co/functions/v1/weather" -H "Authorization: Bearer YOUR_ANON_KEY" | python -m json.tool
```

### Test news:
```powershell
curl -s "https://evedwhwepnuloqougztv.supabase.co/functions/v1/news" -H "Authorization: Bearer YOUR_ANON_KEY" | python -m json.tool
```

### Test a briefing (sends you a real email + SMS):
```powershell
curl -s -X POST "https://evedwhwepnuloqougztv.supabase.co/functions/v1/morning-brief" -H "Authorization: Bearer YOUR_ANON_KEY" -H "Content-Type: application/json" -d "{\"type\": \"morning\"}"
```

### Test synthesis:
```powershell
curl -s -X POST "https://evedwhwepnuloqougztv.supabase.co/functions/v1/synthesize" -H "Authorization: Bearer YOUR_ANON_KEY" -d "{}"
```

Your anon key: in Supabase → Settings → API → `anon public` key (starts with `eyJ...`)
