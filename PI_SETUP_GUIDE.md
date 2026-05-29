# J.A.R.V.I.S. on Raspberry Pi + Tailscale

Run JARVIS 24/7 on a Raspberry Pi at home with remote access from anywhere via Tailscale.

## How It Works (Dual-Mode Access)

Your Pi runs JARVIS as an always-on server with two ways to connect:

**Local mode** (home WiFi): Your phone and laptop reach JARVIS directly over your home network, same as before. Fast, zero latency.

**Remote mode** (Tailscale): When you're away from home, Tailscale creates a secure private tunnel back to your Pi. Your phone connects to JARVIS through this tunnel using the Pi's Tailscale IP. No port forwarding, no exposing anything to the public internet.

Both modes work simultaneously. You don't switch between them - if you're on home WiFi, you use the local IP; if you're out, you use the Tailscale IP. You can bookmark both on your phone.

## What You Need

**Hardware:**
- Raspberry Pi 4 (2GB+ RAM) or Pi 5 (recommended)
- MicroSD card, 16GB+ (32GB recommended)
- USB-C power supply (official Pi PSU recommended)
- Ethernet cable (optional but more reliable than WiFi)

**Software:**
- Raspberry Pi OS (Bookworm, 64-bit recommended)
- An Anthropic API key (you already have this from your laptop setup)

**Accounts:**
- Tailscale account (free at tailscale.com - sign in with Google/GitHub/etc.)

## Step-by-Step Setup

### 1. Flash Raspberry Pi OS

Use the Raspberry Pi Imager (rpi-imager) on your laptop:
- Choose "Raspberry Pi OS (64-bit)" (the Lite version is fine since JARVIS is headless)
- Click the gear icon to pre-configure: set hostname to `jarvis`, enable SSH, set your WiFi credentials, set a username/password
- Flash to your microSD card

Insert the card and power on the Pi. Give it a minute to boot.

### 2. SSH Into the Pi

From your laptop:
```
ssh your-username@jarvis.local
```
(Replace `your-username` with whatever you set in the imager.)

### 3. Run the Setup Script

Copy the setup script to the Pi and run it:
```bash
# From your laptop, copy the script:
scp setup_pi.sh your-username@jarvis.local:~/

# On the Pi:
chmod +x ~/setup_pi.sh
sudo ~/setup_pi.sh
```

The script installs: Python + virtual environment, all JARVIS dependencies, Tailscale, a systemd service for auto-start, firewall rules, and helper scripts.

### 4. Copy Your JARVIS Files

From your laptop, copy the entire JARVIS folder to the Pi:
```bash
scp -r /path/to/your/jarvis/files/* your-username@jarvis.local:~/jarvis/
```

The files you need to copy:
- `jarvis_server.py` (the main brain)
- `index.html` (the web interface)
- `finance.py`, `calendar_sync.py`, `spotify.py`, `briefings.py`, `trips.py`, `journal.py`, `apple_reminders.py`, `plaid_link.py`, `markets.py`
- `requirements.txt`
- `shortcuts.txt`
- `media/` folder (logo, intro sounds)
- `jarvis_data/` folder (your existing data - calendars, finance, notes, etc.)

### 5. Set Up config.json

On the Pi, create or copy your config.json:
```bash
nano ~/jarvis/config.json
```

Paste your config (same as your laptop), but make sure the `anthropic_api_key` is set. Example:
```json
{
  "anthropic_api_key": "sk-ant-your-key-here",
  "model": "claude-sonnet-4-6",
  "assistant_name": "JARVIS",
  "user_title": "sir",
  "port": 8765,
  "https": false,
  "elevenlabs_api_key": "",
  "elevenlabs_voice_id": "",
  "spotify_client_id": "",
  "weather_location": "Chicago",
  "apple_id": "your@icloud.com",
  "apple_app_password": "xxxx-xxxx-xxxx-xxxx"
}
```

### 6. Authenticate Tailscale

```bash
sudo tailscale up
```

It prints a URL like `https://login.tailscale.com/a/xxxx`. Open it on your phone or laptop browser, sign in to your Tailscale account, and authorize the device. Done.

Get your Pi's Tailscale IP:
```bash
tailscale ip -4
```
This gives you something like `100.x.y.z` - this is how you'll reach JARVIS remotely.

### 7. Start JARVIS

```bash
# Enable auto-start on boot
sudo systemctl enable jarvis

# Start now
sudo systemctl start jarvis

# Check it's running
~/jarvis/status.sh
```

### 8. Connect Your Phone via Tailscale

Install the Tailscale app on your phone (iOS App Store / Google Play) and sign in with the same account. Your phone is now on the same Tailscale network as the Pi.

Open a browser on your phone and go to: `http://100.x.y.z:8765` (use the Tailscale IP from step 6).

Bookmark it. Add it to your home screen for the app-like experience.

## Daily Usage

**At home:** Use `http://jarvis.local:8765` or `http://192.168.x.x:8765` (your Pi's local IP).

**Away from home:** Use `http://100.x.y.z:8765` (your Pi's Tailscale IP). As long as Tailscale is running on your phone, it just works.

**Pro tip:** You can actually use the Tailscale IP even at home - it works both ways. So you could just bookmark the Tailscale IP and use it everywhere.

## Helper Commands

All run from SSH on the Pi:

| Command | What it does |
|---------|-------------|
| `~/jarvis/status.sh` | JARVIS status + access URLs |
| `~/jarvis/start.sh` | Start JARVIS |
| `~/jarvis/stop.sh` | Stop JARVIS |
| `~/jarvis/update.sh` | Update Python packages |
| `journalctl -u jarvis -f` | Watch live logs |
| `sudo systemctl restart jarvis` | Restart after config changes |

## Troubleshooting

**JARVIS won't start:**
```bash
journalctl -u jarvis -n 50 --no-pager
```
Most common issues: missing config.json, bad API key, Python import error (run `update.sh`).

**Can't reach JARVIS from phone (local):**
- Pi and phone must be on the same WiFi
- Check the Pi's IP: `hostname -I`
- Make sure port 8765 isn't blocked: `curl http://localhost:8765`

**Can't reach JARVIS remotely (Tailscale):**
- Is Tailscale running on the Pi? `tailscale status`
- Is Tailscale running on your phone? Check the app.
- Both devices must be on the same Tailscale account.

**Pi is slow / JARVIS responses are slow:**
- The Pi itself doesn't do the AI thinking - that's Anthropic's servers. The Pi is just the middleman. Speed depends on your internet connection.
- If the web UI is sluggish, make sure you're using a Pi 4 (2GB+) or Pi 5.

**"open_app" and "media_control" don't work:**
- These Windows-only features (os.startfile, ctypes.windll) are automatically disabled in headless/Pi mode. JARVIS will let you know if you try to use them.

**After a power outage:**
- JARVIS auto-starts on boot (if you ran `systemctl enable jarvis`). Just wait for the Pi to boot and reconnect to WiFi.

## Pi-Specific Notes

Some JARVIS features are laptop-specific and won't work on the Pi:
- **Open/close apps** - these use Windows APIs
- **Media controls** (play/pause/skip) - these send keyboard events to Windows
- Everything else works: chat, calendar, finance, reminders, notes, briefings, Spotify (web API), work schedule scanning, screenshot-to-calendar, web search, etc.

## Security

Tailscale is a zero-trust mesh VPN. Your JARVIS instance is never exposed to the public internet - only devices signed into your Tailscale account can reach it. This is far safer than port forwarding.

Your API keys live in config.json on the Pi's SD card. If you're concerned about physical security, you can encrypt the home directory with Pi OS's built-in encryption.
