#!/usr/bin/env bash
# ============================================================
#   J.A.R.V.I.S. - Raspberry Pi Setup Script
# ============================================================
#   Run this on a fresh Raspberry Pi OS (Bookworm or later).
#   It installs everything JARVIS needs + Tailscale for remote
#   access from anywhere.
#
#   Usage:
#     chmod +x setup_pi.sh
#     sudo ./setup_pi.sh
#
#   After the script finishes, follow the on-screen instructions
#   to paste your API keys and authenticate Tailscale.
# ============================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${CYAN}[JARVIS]${NC} $1"; }
ok()   { echo -e "${GREEN}[  OK  ]${NC} $1"; }
warn() { echo -e "${YELLOW}[ WARN ]${NC} $1"; }
err()  { echo -e "${RED}[ERROR ]${NC} $1"; }

# ---- preflight checks ------------------------------------------------------
if [ "$EUID" -ne 0 ]; then
    err "Please run with sudo:  sudo ./setup_pi.sh"
    exit 1
fi

REAL_USER="${SUDO_USER:-pi}"
JARVIS_DIR="/home/${REAL_USER}/jarvis"

log "Setting up J.A.R.V.I.S. for user: ${REAL_USER}"
log "Install directory: ${JARVIS_DIR}"
echo ""

# ---- 1. system packages ----------------------------------------------------
log "Step 1/6: Installing system packages..."
apt-get update -qq
apt-get install -y -qq \
    python3 python3-pip python3-venv \
    libffi-dev libssl-dev \
    curl wget git \
    > /dev/null 2>&1
ok "System packages installed."

# ---- 2. create JARVIS directory + virtual environment -----------------------
log "Step 2/6: Setting up Python virtual environment..."
if [ ! -d "${JARVIS_DIR}" ]; then
    mkdir -p "${JARVIS_DIR}"
    chown "${REAL_USER}:${REAL_USER}" "${JARVIS_DIR}"
fi

if [ ! -d "${JARVIS_DIR}/venv" ]; then
    sudo -u "${REAL_USER}" python3 -m venv "${JARVIS_DIR}/venv"
fi

# Install Python dependencies inside the venv
sudo -u "${REAL_USER}" "${JARVIS_DIR}/venv/bin/pip" install --upgrade pip -q
sudo -u "${REAL_USER}" "${JARVIS_DIR}/venv/bin/pip" install -q \
    anthropic>=0.39.0 \
    flask>=3.0.0 \
    cryptography>=42.0.0 \
    icalendar>=5.0.0 \
    recurring-ical-events>=2.1.0 \
    caldav>=1.3.0
ok "Python virtual environment ready."

# ---- 3. install Tailscale ---------------------------------------------------
log "Step 3/6: Installing Tailscale..."
if command -v tailscale &> /dev/null; then
    ok "Tailscale is already installed."
else
    curl -fsSL https://tailscale.com/install.sh | sh
    ok "Tailscale installed."
fi

# Enable and start Tailscale daemon
systemctl enable --now tailscaled 2>/dev/null || true

# Check if already authenticated
if tailscale status &>/dev/null 2>&1; then
    ok "Tailscale is already connected."
    TS_IP=$(tailscale ip -4 2>/dev/null || echo "unknown")
    log "Tailscale IP: ${TS_IP}"
else
    warn "Tailscale needs authentication. Run this after setup finishes:"
    echo ""
    echo -e "    ${CYAN}sudo tailscale up${NC}"
    echo ""
    echo "  It will print a URL - open it on any device to authenticate."
fi

# ---- 4. create systemd service ----------------------------------------------
log "Step 4/6: Creating systemd service..."
cat > /etc/systemd/system/jarvis.service << UNIT
[Unit]
Description=J.A.R.V.I.S. Personal AI Assistant
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${REAL_USER}
WorkingDirectory=${JARVIS_DIR}
ExecStart=${JARVIS_DIR}/venv/bin/python ${JARVIS_DIR}/jarvis_server.py
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal

# Environment - JARVIS reads config.json, but we set headless mode here
Environment=JARVIS_HEADLESS=1
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
ok "Systemd service created (jarvis.service)."

# ---- 5. configure firewall --------------------------------------------------
log "Step 5/6: Configuring firewall..."
JARVIS_PORT=8765

# Allow on local network
if command -v ufw &> /dev/null; then
    ufw allow "${JARVIS_PORT}/tcp" comment "JARVIS web" > /dev/null 2>&1 || true
    ok "UFW rule added for port ${JARVIS_PORT}."
elif command -v iptables &> /dev/null; then
    iptables -A INPUT -p tcp --dport "${JARVIS_PORT}" -j ACCEPT 2>/dev/null || true
    ok "iptables rule added for port ${JARVIS_PORT}."
else
    warn "No firewall detected. Port ${JARVIS_PORT} should be open by default."
fi

# Tailscale traffic is automatically allowed through its own interface

# ---- 6. create helper scripts -----------------------------------------------
log "Step 6/6: Creating helper scripts..."

# Start script
cat > "${JARVIS_DIR}/start.sh" << 'STARTSH'
#!/usr/bin/env bash
sudo systemctl start jarvis
echo "JARVIS started. View logs with: journalctl -u jarvis -f"
STARTSH

# Stop script
cat > "${JARVIS_DIR}/stop.sh" << 'STOPSH'
#!/usr/bin/env bash
sudo systemctl stop jarvis
echo "JARVIS stopped."
STOPSH

# Status / logs script
cat > "${JARVIS_DIR}/status.sh" << 'STATUSSH'
#!/usr/bin/env bash
echo "=== JARVIS Service Status ==="
systemctl status jarvis --no-pager
echo ""
echo "=== Network Access ==="
LOCAL_IP=$(hostname -I | awk '{print $1}')
TS_IP=$(tailscale ip -4 2>/dev/null || echo "not connected")
PORT=8765
echo "  Local WiFi:  http://${LOCAL_IP}:${PORT}"
echo "  Tailscale:   http://${TS_IP}:${PORT}"
echo "  Localhost:   http://localhost:${PORT}"
echo ""
echo "=== Recent Logs ==="
journalctl -u jarvis --no-pager -n 20
STATUSSH

# Update script (pull latest JARVIS files + update deps)
cat > "${JARVIS_DIR}/update.sh" << UPDATESH
#!/usr/bin/env bash
echo "Updating JARVIS dependencies..."
${JARVIS_DIR}/venv/bin/pip install --upgrade -q \\
    anthropic flask cryptography icalendar recurring-ical-events caldav
echo "Dependencies updated. Restart JARVIS:"
echo "  sudo systemctl restart jarvis"
UPDATESH

chmod +x "${JARVIS_DIR}"/*.sh
chown "${REAL_USER}:${REAL_USER}" "${JARVIS_DIR}"/*.sh

ok "Helper scripts created in ${JARVIS_DIR}/"

# ---- summary ----------------------------------------------------------------
echo ""
echo -e "${GREEN}============================================================${NC}"
echo -e "${GREEN}  J.A.R.V.I.S. Pi setup complete!${NC}"
echo -e "${GREEN}============================================================${NC}"
echo ""
echo "  Next steps:"
echo ""
echo -e "  ${YELLOW}1.${NC} Copy your JARVIS files to: ${JARVIS_DIR}/"
echo "     (jarvis_server.py, index.html, all .py modules, media/, etc.)"
echo ""
echo -e "  ${YELLOW}2.${NC} Create config.json in ${JARVIS_DIR}/ with your API keys:"
echo '     {"anthropic_api_key": "sk-ant-...", ...}'
echo ""
echo -e "  ${YELLOW}3.${NC} Authenticate Tailscale (if not already done):"
echo -e "     ${CYAN}sudo tailscale up${NC}"
echo ""
echo -e "  ${YELLOW}4.${NC} Enable JARVIS to start on boot:"
echo -e "     ${CYAN}sudo systemctl enable jarvis${NC}"
echo ""
echo -e "  ${YELLOW}5.${NC} Start JARVIS:"
echo -e "     ${CYAN}sudo systemctl start jarvis${NC}"
echo ""
echo "  Access JARVIS from:"
LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "your-pi-ip")
TS_IP=$(tailscale ip -4 2>/dev/null || echo "your-tailscale-ip")
echo "    Home WiFi:  http://${LOCAL_IP}:8765"
echo "    Anywhere:   http://${TS_IP}:8765"
echo "    On the Pi:  http://localhost:8765"
echo ""
echo "  Useful commands:"
echo "    ${JARVIS_DIR}/status.sh   - check JARVIS + show access URLs"
echo "    ${JARVIS_DIR}/start.sh    - start JARVIS"
echo "    ${JARVIS_DIR}/stop.sh     - stop JARVIS"
echo "    ${JARVIS_DIR}/update.sh   - update Python packages"
echo "    journalctl -u jarvis -f   - watch live logs"
echo ""
