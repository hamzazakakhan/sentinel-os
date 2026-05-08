#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# sentinel-os/scripts/build-iso.sh
# Build Sentinel OS live USB ISO image
# Based on Debian live-build with custom overlay
# ──────────────────────────────────────────────────────────────
#
# Requirements:
#   - Debian 12 (Bookworm) host or VM
#   - live-build, debootstrap, squashfs-tools, xorriso
#   - ~10 GB free disk space
#
# Usage:
#   sudo ./build-iso.sh [--variant full|minimal]
#
# Output:
#   sentinel-os-<version>-<variant>.iso
# ──────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
VERSION="${SENTINEL_VERSION:-1.0.0}"
VARIANT="${1:-full}"
ISO_NAME="sentinel-os-${VERSION}-${VARIANT}"

# ── Colors ──
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

log()   { echo -e "${CYAN}[sentinel-build]${NC} $*"; }
ok()    { echo -e "${GREEN}[sentinel-build]${NC} ✓ $*"; }
err()   { echo -e "${RED}[sentinel-build]${NC} ✗ $*" >&2; exit 1; }

# ── Preflight checks ──
[[ $EUID -eq 0 ]] || err "Must run as root (use sudo)"

command -v lb >/dev/null 2>&1 || err "live-build not installed: apt install live-build"
command -v mksquashfs >/dev/null 2>&1 || err "squashfs-tools not installed"
command -v xorriso >/dev/null 2>&1 || err "xorriso not installed"

log "Building Sentinel OS ISO: ${ISO_NAME}"
log "Variant: ${VARIANT}"

# ── Working directory ──
BUILD_DIR="${PROJECT_DIR}/build/${ISO_NAME}"
rm -rf "${BUILD_DIR}"
mkdir -p "${BUILD_DIR}"
cd "${BUILD_DIR}"

# ── Initialize live-build ──
lb config \
  --architecture amd64 \
  --distribution kali-rolling \
  --parent-distribution bookworm \
  --mirror-chroot http://kali.download/kali \
  --mirror-bootstrap http://deb.debian.org/debian \
  --parent-mirror-bootstrap http://deb.debian.org/debian \
  --parent-mirror-chroot http://deb.debian.org/debian \
  --debian-installer none \
  --archive-areas "main contrib non-free non-free-firmware" \
  --binary-images iso \
  --bootappend-live "boot=live components username=sentinel hostname=sentinel-os quiet splash" \
  --iso-application "Sentinel OS" \
  --iso-publisher "Sentinel OS Project" \
  --iso-volume "SENTINEL_${VERSION}" \
  --memtest none \
  --uefi-secure-boot enable \
  --bootloaders "grub-efi,syslinux" \
  --linux-flavours amd64

# Patch live-build's binary_iso to remove -isohybrid-mbr and -partition_offset 16
# which trigger CHS geometry calculation limiting ISO to ~4.7 GB DVD size.
# We patch the system script so xorriso creates the ISO without the size limit.
# After build, we write MBR boot code (isohdpfx.bin) to make it BIOS-bootable.
BINARY_ISO_SCRIPT="/usr/lib/live/build/binary_iso"
if grep -q "isohybrid-mbr" "${BINARY_ISO_SCRIPT}"; then
  cp "${BINARY_ISO_SCRIPT}" "${BINARY_ISO_SCRIPT}.bak"
  # Remove the entire syslinux block (lines between 'if syslinux' and 'elif grub-pc')
  # to avoid leaving an empty then/elif which causes a syntax error
  sed -i '/if.*syslinux/,/elif.*grub-pc/{/if.*syslinux/!d}' "${BINARY_ISO_SCRIPT}"
  sed -i '/-isohybrid-mbr/d' "${BINARY_ISO_SCRIPT}"
  sed -i '/-partition_offset/d' "${BINARY_ISO_SCRIPT}"
  log "Patched binary_iso to remove DVD size limit (USB-only image)"
fi

# Add Kali repos
mkdir -p config/archives
cat > config/archives/kali.list.chroot << 'EOF'
deb http://kali.download/kali kali-rolling main contrib non-free non-free-firmware
EOF
cat > config/archives/kali.pref.chroot << 'EOF'
Package: *
Pin: release o=Kali
Pin-Priority: 900

Package: firmware-realtek-rtl8723cs-bt
Pin: release o=Kali
Pin-Priority: -1

Package: firmware-realtek
Pin: release o=Kali
Pin-Priority: -1

Package: firmware-linux-nonfree
Pin: release o=Kali
Pin-Priority: -1
EOF
# Copy Kali keyring from host system
if [[ -f /usr/share/keyrings/kali-archive-keyring.gpg ]]; then
  cp /usr/share/keyrings/kali-archive-keyring.gpg config/archives/kali.key.chroot
  ok "Copied Kali archive keyring from host"
else
  log "WARNING: kali-archive-keyring.gpg not found on host, Kali packages may fail"
fi

# ── Package lists ──
log "Writing package lists..."

mkdir -p config/package-lists

# Base system packages
cat > config/package-lists/base.list.chroot << 'EOF'
# Sentinel OS base packages (only guaranteed-available packages here)
# Libraries and optional packages go in the chroot hook where failures are non-fatal
kali-archive-keyring
curl
wget
# Display server (full xorg meta + input drivers)
xserver-xorg
xserver-xorg-core
xserver-xorg-input-all
xinit
xfonts-base
# Display manager + greeter (CRITICAL for GUI: 50-sentinel.conf references lightdm-gtk-greeter)
lightdm
lightdm-gtk-greeter
# Window manager and tools
i3-wm
i3lock
i3status
polybar
rofi
alacritty
scrot
xclip
xdotool
x11-xserver-utils
# Boot splash (Plymouth) — graphical boot screen
plymouth
plymouth-themes
plymouth-label
# Network
network-manager
network-manager-gnome
dbus-x11
# Kernel + headers
linux-image-amd64
linux-headers-amd64
# Firmware
firmware-iwlwifi
firmware-atheros
# Secure Boot — Microsoft-signed shim + grub for HP/Dell/Lenovo UEFI
shim-signed
grub-efi-amd64-signed
mokutil
sbsigntool
efibootmgr
# firmware-linux-nonfree/firmware-realtek conflicts with firmware-realtek-rtl8723cs-bt
EOF

# Security tools
cat > config/package-lists/security.list.chroot << 'EOF'
# Security & intelligence tools
nmap
tcpdump
# aircrack-ng sometimes 403 on mirror — install via hook
recon-ng
sqlmap
nikto
dirb
gobuster
hydra
john
hashcat
binwalk
foremost
suricata
fail2ban
apparmor
apparmor-profiles
apparmor-utils
libpam-apparmor
# Kali-specific tools
kismet
metasploit-framework
theharvester
sherlock
# gnuradio/gr-osmosdr/rtl-433/gqrx-sdr are very heavy — install via hook if needed
# zeek has libc6 conflict on kali-rolling — install via source in hook
# wireshark, maltego, wpasupplicant have dep issues on kali-rolling
EOF

# Container & orchestration
cat > config/package-lists/containers.list.chroot << 'EOF'
# Container & orchestration
docker.io
docker-compose
buildah
podman
skopeo
# K8s tools not in Debian repos — install via curl in overlay
# kubectl k3s helm istioctl argocd
EOF

# Python & AI
cat > config/package-lists/python-ai.list.chroot << 'EOF'
# Python & AI
python3
python3-pip
python3-venv
python3-dev
nodejs
npm
rustc
cargo
golang-go
# ollama not in Debian repos — install via curl in overlay
EOF

if [[ "${VARIANT}" == "minimal" ]]; then
  log "Minimal variant — skipping security/containers packages"
  rm -f config/package-lists/security.list.chroot
  rm -f config/package-lists/containers.list.chroot
fi

# ── Custom overlay (copy project files) ──
log "Creating overlay..."

OVERLAY_DIR="config/includes.chroot"
mkdir -p "${OVERLAY_DIR}/opt/sentinel"
mkdir -p "${OVERLAY_DIR}/etc/sentinel"
mkdir -p "${OVERLAY_DIR}/var/lib/sentinel/snapshots"
mkdir -p "${OVERLAY_DIR}/var/log/sentinel"
mkdir -p "${OVERLAY_DIR}/usr/local/bin"

# Copy Sentinel OS services
if [[ -d "${PROJECT_DIR}/services" ]]; then
  cp -r "${PROJECT_DIR}/services" "${OVERLAY_DIR}/opt/sentinel/services"
  ok "Copied services to overlay"
fi

# Copy infrastructure configs
if [[ -d "${PROJECT_DIR}/infrastructure" ]]; then
  cp -r "${PROJECT_DIR}/infrastructure" "${OVERLAY_DIR}/opt/sentinel/infrastructure"
  ok "Copied infrastructure to overlay"
fi

# Copy scripts
if [[ -d "${PROJECT_DIR}/scripts" ]]; then
  cp -r "${PROJECT_DIR}/scripts" "${OVERLAY_DIR}/opt/sentinel/scripts"
  chmod +x "${OVERLAY_DIR}/opt/sentinel/scripts/"*.sh 2>/dev/null || true
  ok "Copied scripts to overlay"
fi

# Copy shell (Tauri UI)
if [[ -d "${PROJECT_DIR}/shell" ]]; then
  cp -r "${PROJECT_DIR}/shell" "${OVERLAY_DIR}/opt/sentinel/shell"
  ok "Copied shell to overlay"
fi

# Copy UI
if [[ -d "${PROJECT_DIR}/ui" ]]; then
  cp -r "${PROJECT_DIR}/ui" "${OVERLAY_DIR}/opt/sentinel/ui"
  ok "Copied ui to overlay"
fi

# Copy ai-workers
if [[ -d "${PROJECT_DIR}/ai-workers" ]]; then
  cp -r "${PROJECT_DIR}/ai-workers" "${OVERLAY_DIR}/opt/sentinel/ai-workers"
  ok "Copied ai-workers to overlay"
fi

# Generate docker-compose configs, certs, secrets placeholders
DOCKER_DIR="${OVERLAY_DIR}/opt/sentinel/infrastructure/docker"
if [[ -f "${SCRIPT_DIR}/generate-docker-assets.sh" ]]; then
  bash "${SCRIPT_DIR}/generate-docker-assets.sh" "${DOCKER_DIR}"
  ok "Generated docker-compose assets"
else
  log "WARNING: generate-docker-assets.sh not found — docker compose may fail on missing mounts"
fi

# ── Chroot hook: install tools not in repos ──
log "Creating chroot hooks..."

mkdir -p config/hooks/normal
cat > config/hooks/normal/0200-install-extra-tools.hook.chroot << 'HOOKEOF'
#!/bin/bash
# NOTE: live-build runs hooks with /bin/sh (dash), ignoring the shebang.
# Piped scripts that use bash syntax (helm, ollama, istio) must be piped to bash.
# No set -e — individual commands use || true to avoid aborting the whole hook.

# ── Install optional packages (may have different names on kali-rolling) ──
# These are installed here instead of the package list so failures don't abort the build.
# Try the standard name first, then the t64 variant (Debian time_t transition).
install_pkg() {
    # Try with --fix-missing to handle broken downloads
    apt-get install -y --no-install-recommends --fix-missing "$1" 2>/dev/null && return 0
    # Try t64 variant (Debian 64-bit time_t migration renames libfoo-N to libfoo-Nt64)
    apt-get install -y --no-install-recommends --fix-missing "${1}t64" 2>/dev/null && return 0
    # Last resort: clean cache and retry
    apt-get clean 2>/dev/null
    apt-get install -y --no-install-recommends --fix-missing "$1" 2>/dev/null && return 0
    echo "WARNING: could not install $1 (or ${1}t64), skipping"
    return 0
}

# CRITICAL: Clean apt cache and fix broken packages FIRST before any optional installs
# This handles corrupted packages from base install (e.g., libgtk-3-0 broken pipe errors)
echo ">>> Cleaning apt cache and fixing broken packages..."
apt-get clean 2>/dev/null || true
rm -rf /var/lib/apt/lists/* 2>/dev/null || true
apt-get update 2>/dev/null || true
dpkg --configure -a 2>/dev/null || true
apt-get install --fix-broken -y 2>/dev/null || true
apt-get install --fix-missing -y 2>/dev/null || true

install_pkg fonts-jetbrains-mono
install_pkg picom
install_pkg feh
install_pkg libnotify-bin
install_pkg librsvg2-2
install_pkg librsvg2-bin
install_pkg libwebkit2gtk-4.1-0
install_pkg libayatana-appindicator3-1
install_pkg libgtk-3-0

# Install kubectl
curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl" 2>/dev/null && chmod +x kubectl && mv kubectl /usr/local/bin/ || echo "kubectl install skipped"

# Install helm (get-helm-3 uses [[ bash syntax ]])
curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash || echo "helm install skipped"

# Install ollama (install.sh uses bash syntax) — retry up to 3 times
for _i in 1 2 3; do
  curl -fsSL https://ollama.com/install.sh | bash && break || echo "ollama install attempt $_i failed, retrying..."
  sleep 5
done || echo "ollama install skipped after 3 attempts"

# Install argocd CLI
curl -sSL -o /usr/local/bin/argocd https://github.com/argoproj/argo-cd/releases/latest/download/argocd-linux-amd64 2>/dev/null && chmod +x /usr/local/bin/argocd || echo "argocd install skipped"

# Install istioctl (downloadIstio uses bash syntax)
curl -L https://istio.io/downloadIstio | bash - || echo "istioctl install skipped"
mv istio-*/bin/istioctl /usr/local/bin/ 2>/dev/null || true
rm -rf istio-*

# Install xorg video drivers (input drivers in base list via xserver-xorg-input-all)
apt-get install -y --no-install-recommends --fix-missing \
  xserver-xorg-video-amdgpu xserver-xorg-video-nouveau \
  xserver-xorg-video-intel xserver-xorg-video-vesa xserver-xorg-video-fbdev 2>/dev/null || true
apt-get install -y wireshark-cli tshark wpasupplicant aircrack-ng 2>/dev/null || true

# Install zeek from binary release (libc6 conflict in kali-rolling apt) with retry
for i in 1 2; do
  curl -sSL https://download.zeek.org/zeek-6.2.1-x86_64-pkg-6ad388b9e4_linux.tar.gz -o /tmp/zeek.tar.gz 2>/dev/null && tar -xzf /tmp/zeek.tar.gz -C /opt && ln -sf /opt/zeek-*/bin/zeek /usr/local/bin/zeek 2>/dev/null && break
  echo "Retry $i for zeek download..."
  rm -f /tmp/zeek.tar.gz
done || true
rm -f /tmp/zeek.tar.gz

# Install SDR tools from source
apt-get install -y cmake git build-essential libusb-1.0-0-dev librtlsdr-dev 2>/dev/null || true
cd /tmp
git clone https://github.com/antirez/dump1090.git 2>/dev/null && cd dump1090 && make && make install 2>/dev/null || true
cd /tmp
# acarsdec skipped - CMakeLists.txt incompatible with CMake 4.3.1 (requires < 3.5)
# git clone https://github.com/TLeconte/acarsdec.git 2>/dev/null && cd acarsdec && mkdir build && cd build && cmake .. && make && make install 2>/dev/null || true
cd /tmp
pip3 install volatility3 2>/dev/null || true
rm -rf /tmp/dump1090

# Install Sentinel OS npm service dependencies
cd /opt/sentinel/services && for svc in */; do
  if [ -f "/opt/sentinel/services/$svc/package.json" ]; then
    echo "Installing npm deps for $svc"
    cd "/opt/sentinel/services/$svc"
    npm install --production 2>/dev/null || true
    cd /opt/sentinel/services
  fi
done

# Build Sentinel OS shell (Tauri v2)
if [ -d "/opt/sentinel/shell" ]; then
  # Install Tauri build dependencies
  apt-get install -y --no-install-recommends \
    libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev \
    librsvg2-dev libssl-dev pkg-config 2>/dev/null || true

  cd /opt/sentinel/shell
  npm install 2>/dev/null || true

  # Build the frontend (critical: Tauri needs this for webview content)
  echo "Building Tauri frontend..."
  npm run build 2>/dev/null
  if [ ! -d "dist" ]; then
    echo "WARNING: Frontend build failed, dist folder not found"
  elif [ ! -f "dist/index.html" ]; then
    echo "WARNING: Frontend build incomplete, dist/index.html missing"
  else
    echo "Frontend build successful, dist folder created with index.html"
  fi

  # Build the Tauri binary
  if [ -d "src-tauri" ]; then
    cd src-tauri
    echo "Building Tauri binary..."
    cargo build --release 2>/dev/null
    # Install the built binary
    if [ -f "target/release/sentinel-shell" ]; then
      cp target/release/sentinel-shell /usr/local/bin/sentinel-shell
      chmod +x /usr/local/bin/sentinel-shell
      # Copy dist folder to /usr/local/share so Tauri can find it
      mkdir -p /usr/local/share/sentinel-shell
      cp -r ../dist /usr/local/share/sentinel-shell/
      # Set environment variable for Tauri to find the frontend
      echo 'export SENTINEL_FRONTEND_PATH=/usr/local/share/sentinel-shell/dist' >> /etc/profile.d/sentinel-shell.sh 2>/dev/null || true
      echo "Sentinel Shell (Tauri) built and installed"
    else
      echo "WARNING: Tauri build did not produce binary, shell will not be available"
    fi
    cd /opt/sentinel/shell
  fi
fi

# Create sentinel user for autologin and add to autologin group
id sentinel 2>/dev/null || useradd -m -s /bin/bash sentinel 2>/dev/null || true
groupadd -f autologin 2>/dev/null || true
usermod -aG autologin,sudo,docker sentinel 2>/dev/null || true
echo "sentinel:sentinel" | chpasswd 2>/dev/null || true

# Fix ownership of sentinel home directory and all config files
# CRITICAL: includes.chroot copies files as root. Without this fix,
# /home/sentinel is owned by root and Xorg cannot create .Xauthority,
# causing LightDM to loop back to the login screen.
if [ -d /home/sentinel ]; then
    chown -R sentinel:sentinel /home/sentinel
    echo "Fixed /home/sentinel ownership (was root, now sentinel:sentinel)"
fi

# Ensure i3 session is registered for LightDM
mkdir -p /usr/share/xsessions
cat > /usr/share/xsessions/i3.desktop << 'XSESSION'
[Desktop Entry]
Name=i3
Comment=improved dynamic tiling window manager
Exec=i3
TryExec=i3
Type=Application
XSESSION
echo "Created i3 xsession desktop entry"

# Enable LightDM as default display manager
echo "/usr/sbin/lightdm" > /etc/X11/default-display-manager 2>/dev/null || true
dpkg-reconfigure -f noninteractive lightdm 2>/dev/null || true

# Allow sentinel to run docker without password
echo "sentinel ALL=(ALL) NOPASSWD: /usr/bin/docker, /usr/bin/docker-compose, /usr/bin/docker compose" > /etc/sudoers.d/sentinel-docker 2>/dev/null || true
chmod 440 /etc/sudoers.d/sentinel-docker 2>/dev/null || true

# Enable docker service on boot
systemctl enable docker 2>/dev/null || true
systemctl enable lightdm 2>/dev/null || true

# Mark docker-compose stack as ready if secrets were populated
if [ -f /opt/sentinel/infrastructure/docker/.ready ]; then
  echo "Docker stack marked ready"
fi

echo "Extra tools installation complete"
HOOKEOF
chmod +x config/hooks/normal/0200-install-extra-tools.hook.chroot

# ── Boot splash & branding ──
log "Creating boot splash..."

mkdir -p "${OVERLAY_DIR}/usr/share/images/sentinel"
# Create a simple ASCII boot splash
cat > "${OVERLAY_DIR}/usr/share/images/sentinel/splash.txt" << 'SPLASH'
  ███████╗███████╗███╗   ██╗████████╗██╗███╗   ██╗███████╗██╗
  ██╔════╝██╔════╝████╗  ██║╚══██╔══╝██║████╗  ██║██╔════╝██║
  ███████╗█████╗  ██╔██╗ ██║   ██║   ██║██╔██╗ ██║█████╗  ██║
  ╚════██║██╔══╝  ██║╚██╗██║   ██║   ██║██║╚██╗██║██╔══╝  ██║
  ███████║███████╗██║ ╚████║   ██║   ██║██║ ╚████║███████╗███████╗
  ╚══════╝╚══════╝╚═╝  ╚═══╝   ╚═╝   ╚═╝╚═╝  ╚═══╝╚══════╝╚══════╝
  SENTINEL OS :: C4ISR INTELLIGENCE PLATFORM :: v${VERSION}
SPLASH

# ── Autostart services ──
cat > "${OVERLAY_DIR}/etc/sentinel/autostart.conf" << 'EOF'
# Sentinel OS autostart services
# These services start on boot via systemd
SENTINEL_DOCKER=true
SENTINEL_KAFKA=true
SENTINEL_OLLAMA=true
SENTINEL_AI_SERVICE=true
SENTINEL_GEO_SERVICE=true
SENTINEL_SIGINT_SERVICE=true
EOF

# ── i3 Window Manager Configuration ──
log "Creating i3 and polybar configuration..."

I3_DIR="${OVERLAY_DIR}/home/sentinel/.config/i3"
mkdir -p "${I3_DIR}"
cat > "${I3_DIR}/config" << 'EOF'
# ══════════════════════════════════════════════════════════════
# Sentinel OS — i3 Window Manager Configuration
# ══════════════════════════════════════════════════════════════

set $mod Mod4

# Font
font pango:JetBrains Mono 10

# ── Window Appearance ──
default_border pixel 2
default_floating_border pixel 2
gaps inner 6
gaps outer 2
smart_gaps on

# Colors (military dark theme)
# class                 border  backgr  text    indicator child_border
client.focused          #00ff41 #1a1a2e #00ff41 #00ff41   #00ff41
client.focused_inactive #333333 #0f0f1a #888888 #333333   #333333
client.unfocused        #222222 #0a0a14 #555555 #222222   #222222
client.urgent           #ff0000 #1a1a2e #ff0000 #ff0000   #ff0000

# ── Key Bindings ──
# Terminal
bindsym $mod+Return exec alacritty
bindsym $mod+Shift+Return exec alacritty --class floating_term

# Application launcher
bindsym $mod+d exec --no-startup-id rofi -show drun -theme sentinel
bindsym $mod+Tab exec --no-startup-id rofi -show window -theme sentinel

# Kill focused window
bindsym $mod+Shift+q kill

# Focus
bindsym $mod+h focus left
bindsym $mod+j focus down
bindsym $mod+k focus up
bindsym $mod+l focus right
bindsym $mod+Left focus left
bindsym $mod+Down focus down
bindsym $mod+Up focus up
bindsym $mod+Right focus right

# Move
bindsym $mod+Shift+h move left
bindsym $mod+Shift+j move down
bindsym $mod+Shift+k move up
bindsym $mod+Shift+l move right
bindsym $mod+Shift+Left move left
bindsym $mod+Shift+Down move down
bindsym $mod+Shift+Up move up
bindsym $mod+Shift+Right move right

# Split
bindsym $mod+b split h
bindsym $mod+v split v

# Fullscreen
bindsym $mod+f fullscreen toggle

# Layout
bindsym $mod+s layout stacking
bindsym $mod+w layout tabbed
bindsym $mod+e layout toggle split

# Floating
bindsym $mod+Shift+space floating toggle
bindsym $mod+space focus mode_toggle
floating_modifier $mod

# ── Workspaces (military designations) ──
set $ws1 "1:INTEL"
set $ws2 "2:CYBER"
set $ws3 "3:COMMS"
set $ws4 "4:SIGINT"
set $ws5 "5:SIM"
set $ws6 "6:CRYPTO"
set $ws7 "7:TERM"
set $ws8 "8:MON"

bindsym $mod+1 workspace $ws1
bindsym $mod+2 workspace $ws2
bindsym $mod+3 workspace $ws3
bindsym $mod+4 workspace $ws4
bindsym $mod+5 workspace $ws5
bindsym $mod+6 workspace $ws6
bindsym $mod+7 workspace $ws7
bindsym $mod+8 workspace $ws8

bindsym $mod+Shift+1 move container to workspace $ws1
bindsym $mod+Shift+2 move container to workspace $ws2
bindsym $mod+Shift+3 move container to workspace $ws3
bindsym $mod+Shift+4 move container to workspace $ws4
bindsym $mod+Shift+5 move container to workspace $ws5
bindsym $mod+Shift+6 move container to workspace $ws6
bindsym $mod+Shift+7 move container to workspace $ws7
bindsym $mod+Shift+8 move container to workspace $ws8

# ── Resize Mode ──
mode "resize" {
    bindsym h resize shrink width 5 px or 5 ppt
    bindsym j resize grow height 5 px or 5 ppt
    bindsym k resize shrink height 5 px or 5 ppt
    bindsym l resize grow width 5 px or 5 ppt
    bindsym Left resize shrink width 5 px or 5 ppt
    bindsym Down resize grow height 5 px or 5 ppt
    bindsym Up resize shrink height 5 px or 5 ppt
    bindsym Right resize grow width 5 px or 5 ppt
    bindsym Return mode "default"
    bindsym Escape mode "default"
}
bindsym $mod+r mode "resize"

# ── System Controls ──
bindsym $mod+Shift+c reload
bindsym $mod+Shift+r restart
bindsym $mod+Shift+e exec "i3-nagbar -t warning -m 'Exit Sentinel OS?' -B 'Yes' 'i3-msg exit'"

# Lock screen
bindsym $mod+Shift+x exec i3lock -c 0a0a14 -e -f

# Screenshot
bindsym Print exec --no-startup-id scrot '/tmp/screenshot_%Y%m%d_%H%M%S.png' -e 'xclip -selection clipboard -t image/png -i $f'

# ── Floating rules ──
for_window [class="floating_term"] floating enable, resize set 900 600, move position center
for_window [class="Rofi"] floating enable
for_window [window_role="pop-up"] floating enable
for_window [window_role="dialog"] floating enable

# ── Autostart ──
exec_always --no-startup-id $HOME/.config/i3/autostart.sh
exec --no-startup-id nm-applet
exec --no-startup-id xset s off -dpms
exec --no-startup-id xsetroot -solid '#0a0a14'
EOF

# ── i3 Autostart Script ──
cat > "${I3_DIR}/autostart.sh" << 'EOF'
#!/bin/bash
# Sentinel OS i3 autostart — launches full platform

# Kill existing polybar instances
killall -q polybar
while pgrep -u $UID -x polybar >/dev/null; do sleep 0.5; done

# Launch polybar
polybar sentinel 2>/dev/null &

# Set Sentinel OS wallpaper (fall back to solid dark if image missing)
if [ -f /usr/share/backgrounds/sentinel-wallpaper.png ] && command -v feh >/dev/null 2>&1; then
    feh --bg-fill /usr/share/backgrounds/sentinel-wallpaper.png 2>/dev/null &
elif command -v nitrogen >/dev/null 2>&1 && [ -f /usr/share/backgrounds/sentinel-wallpaper.png ]; then
    nitrogen --set-zoom-fill /usr/share/backgrounds/sentinel-wallpaper.png 2>/dev/null &
else
    xsetroot -solid '#0a0a14'
fi

# ── Start Sentinel services if Docker is ready ──
if command -v docker >/dev/null 2>&1 && systemctl is-active docker >/dev/null 2>&1; then
    # Start the full stack if not already running
    if ! docker compose -f /opt/sentinel/infrastructure/docker/docker-compose.yml ps --quiet 2>/dev/null | grep -q .; then
        notify-send "Sentinel OS" "Starting services..." 2>/dev/null || true
        sudo docker compose -f /opt/sentinel/infrastructure/docker/docker-compose.yml up -d 2>/dev/null &
    fi
fi

# ── Start Ollama in background ──
if command -v ollama >/dev/null 2>&1 && ! pgrep -x ollama >/dev/null; then
    ollama serve 2>/dev/null &
    sleep 2
    ollama pull tinyllama 2>/dev/null &
fi

# ── Launch Sentinel Shell (Tauri HUD) as primary app ──
sleep 2
if command -v sentinel-shell >/dev/null 2>&1; then
    # Launch on workspace 1 (INTEL) — fullscreen native app
    i3-msg 'workspace 1:INTEL'
    sentinel-shell 2>/dev/null &
else
    # Fallback: open terminal with status
    i3-msg 'workspace 1:INTEL; exec alacritty -e bash -c "
        echo -e \"\\033[0;32m\"
        cat /usr/share/images/sentinel/splash.txt 2>/dev/null
        echo -e \"\\033[0m\"
        echo
        echo \"  SENTINEL OS v1.0.0 — C4ISR Intelligence Platform\"
        echo \"  ─────────────────────────────────────────────────\"
        echo
        echo \"  [!] Tauri shell binary not found.\"
        echo \"      Build it with: cd /opt/sentinel/shell && npm run tauri build\"
        echo
        echo \"  Services: docker compose -f /opt/sentinel/infrastructure/docker/docker-compose.yml ps\"
        echo \"  CLI:      sentinel --help\"
        echo \"  API:      http://localhost:4000/graphql\"
        echo
        exec bash
    "'
fi

# ── Open terminal on workspace 7 ──
sleep 1
i3-msg 'workspace 7:TERM; exec alacritty'

# Switch back to primary workspace
sleep 0.5
i3-msg 'workspace 1:INTEL'
EOF
chmod +x "${I3_DIR}/autostart.sh"

# ── Polybar Configuration ──
POLYBAR_DIR="${OVERLAY_DIR}/home/sentinel/.config/polybar"
mkdir -p "${POLYBAR_DIR}"
cat > "${POLYBAR_DIR}/config.ini" << 'EOF'
; ══════════════════════════════════════════════════════════════
; Sentinel OS — Polybar Configuration
; ══════════════════════════════════════════════════════════════

[colors]
background = #0a0a14
background-alt = #1a1a2e
foreground = #c0c0c0
primary = #00ff41
alert = #ff0000
warning = #ffaa00
disabled = #555555

[bar/sentinel]
width = 100%
height = 24pt
radius = 0
background = ${colors.background}
foreground = ${colors.foreground}
line-size = 2pt
border-size = 0
padding-left = 1
padding-right = 1
module-margin = 1
separator = |
separator-foreground = ${colors.disabled}
font-0 = "JetBrains Mono:size=10;2"
font-1 = "JetBrains Mono:size=10:weight=bold;2"
modules-left = i3 sentinel-status
modules-center = date
modules-right = network cpu memory battery
cursor-click = pointer
enable-ipc = true
tray-position = right

[module/i3]
type = internal/i3
pin-workspaces = true
show-urgent = true
strip-wsnumbers = false
label-focused = %name%
label-focused-background = ${colors.background-alt}
label-focused-foreground = ${colors.primary}
label-focused-underline = ${colors.primary}
label-focused-padding = 1
label-unfocused = %name%
label-unfocused-padding = 1
label-urgent = %name%
label-urgent-background = ${colors.alert}
label-urgent-padding = 1

[module/sentinel-status]
type = custom/script
exec = /home/sentinel/.config/polybar/sentinel-status.sh
format-foreground = ${colors.primary}
format-font = 2
interval = 5

[module/date]
type = internal/date
interval = 1
date = %Y-%m-%d
time = %H:%M:%S
label = %date% %time%
label-foreground = ${colors.foreground}

[module/cpu]
type = internal/cpu
interval = 2
label = CPU %percentage:2%%
label-foreground = ${colors.primary}
warn-percentage = 80

[module/memory]
type = internal/memory
interval = 2
label = MEM %percentage_used:2%%
label-foreground = ${colors.primary}
warn-percentage = 80

[module/network]
type = internal/network
interface-type = wireless
interval = 3
label-connected = W:%essid%
label-disconnected = W:OFF
label-disconnected-foreground = ${colors.alert}

[module/battery]
type = internal/battery
battery = BAT0
adapter = ADP1
full-at = 99
low-at = 15
label-charging = CHG %percentage%%
label-discharging = BAT %percentage%%
label-full = FULL %percentage%%
label-low = LOW %percentage%%
label-low-foreground = ${colors.alert}

[settings]
screenchange-reload = true
pseudo-transparency = false
EOF

# ── Polybar Status Script ──
cat > "${POLYBAR_DIR}/sentinel-status.sh" << 'EOF'
#!/bin/bash
# Polybar module: show Sentinel OS service health
RUNNING=$(docker ps --filter "name=sentinel" --format '{{.Names}}' 2>/dev/null | wc -l)
TOTAL=13
OLLAMA=""
if pgrep -x ollama >/dev/null 2>&1; then
    OLLAMA=" OLL:ON"
else
    OLLAMA=" OLL:OFF"
fi
if [ "$RUNNING" -gt 0 ]; then
    echo "SENTINEL [${RUNNING}/${TOTAL}]${OLLAMA}"
else
    echo "SENTINEL [OFFLINE]${OLLAMA}"
fi
EOF
chmod +x "${POLYBAR_DIR}/sentinel-status.sh"

# ── Alacritty Terminal Configuration ──
ALACRITTY_DIR="${OVERLAY_DIR}/home/sentinel/.config/alacritty"
mkdir -p "${ALACRITTY_DIR}"
cat > "${ALACRITTY_DIR}/alacritty.toml" << 'EOF'
# Sentinel OS — Alacritty Terminal Configuration

[window]
opacity = 0.92
padding = { x = 4, y = 4 }
decorations = "None"

[font]
size = 11.0

[font.normal]
family = "JetBrains Mono"
style = "Regular"

[font.bold]
family = "JetBrains Mono"
style = "Bold"

[colors.primary]
background = "#0a0a14"
foreground = "#c0c0c0"

[colors.normal]
black   = "#0a0a14"
red     = "#ff0000"
green   = "#00ff41"
yellow  = "#ffaa00"
blue    = "#0066ff"
magenta = "#aa00ff"
cyan    = "#00cccc"
white   = "#c0c0c0"

[colors.bright]
black   = "#555555"
red     = "#ff4444"
green   = "#44ff77"
yellow  = "#ffcc44"
blue    = "#4488ff"
magenta = "#cc44ff"
cyan    = "#44ffff"
white   = "#ffffff"
EOF

# ── Rofi Launcher Theme ──
ROFI_DIR="${OVERLAY_DIR}/home/sentinel/.config/rofi"
mkdir -p "${ROFI_DIR}"
cat > "${ROFI_DIR}/sentinel.rasi" << 'EOF'
* {
    background:     #0a0a14;
    foreground:     #c0c0c0;
    border-color:   #00ff41;
    accent:         #00ff41;
}

window {
    width:          40%;
    border:         2px;
    border-color:   @border-color;
    background-color: @background;
}

mainbox {
    padding: 10px;
}

inputbar {
    padding:    8px;
    text-color: @accent;
    background-color: #1a1a2e;
    border: 0 0 2px 0;
    border-color: @accent;
}

listview {
    lines:      10;
    padding:    8px 0;
    background-color: transparent;
}

element {
    padding: 6px;
}

element selected {
    background-color: #1a1a2e;
    text-color: @accent;
}
EOF
cat > "${ROFI_DIR}/config.rasi" << 'EOF'
configuration {
    modi: "drun,run,window";
    show-icons: false;
    terminal: "alacritty";
    font: "JetBrains Mono 11";
}
@theme "sentinel"
EOF

# ── Set ownership (will be applied by chroot hook) ──
# We'll fix perms in the chroot hook since includes.chroot runs as root

ok "Created i3, polybar, alacritty, and rofi configurations"

# ── Lightdm: set i3 as default session for autologin ──
mkdir -p "${OVERLAY_DIR}/etc/lightdm/lightdm.conf.d"
cat > "${OVERLAY_DIR}/etc/lightdm/lightdm.conf.d/50-sentinel.conf" << 'EOF'
[Seat:*]
autologin-user=sentinel
autologin-session=i3
user-session=i3
greeter-session=lightdm-gtk-greeter
EOF

# ── Systemd service for Sentinel stack ──
mkdir -p "${OVERLAY_DIR}/etc/systemd/system"
cat > "${OVERLAY_DIR}/etc/systemd/system/sentinel-stack.service" << 'EOF'
[Unit]
Description=Sentinel OS Stack (Docker Compose)
After=docker.service network-online.target
Wants=network-online.target
ConditionPathExists=/opt/sentinel/infrastructure/docker/.ready

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/sentinel/infrastructure/docker
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down
TimeoutStartSec=300

[Install]
WantedBy=multi-user.target
EOF

# Enable sentinel-stack.service on boot
mkdir -p "${OVERLAY_DIR}/etc/systemd/system/multi-user.target.wants"
ln -sf /etc/systemd/system/sentinel-stack.service "${OVERLAY_DIR}/etc/systemd/system/multi-user.target.wants/sentinel-stack.service"

# Note: secrets, configs, certs are generated by generate-docker-assets.sh above

# ── Add Kali apt sources for post-boot package management (kept for packages, not branding) ──
mkdir -p "${OVERLAY_DIR}/etc/apt/sources.list.d"
cat > "${OVERLAY_DIR}/etc/apt/sources.list.d/kali.list" << 'EOF'
deb [signed-by=/usr/share/keyrings/kali-archive-keyring.gpg] http://kali.download/kali kali-rolling main contrib non-free non-free-firmware
EOF

# ══════════════════════════════════════════════════════════════
# ── SENTINEL OS BRANDING (replaces all user-facing Kali text) ──
# ══════════════════════════════════════════════════════════════
log "Applying Sentinel OS branding..."

# /etc/os-release — shown by neofetch, screenfetch, hostnamectl, etc.
cat > "${OVERLAY_DIR}/etc/os-release" << EOF
PRETTY_NAME="Sentinel OS ${VERSION}"
NAME="Sentinel OS"
VERSION_ID="${VERSION}"
VERSION="${VERSION} (C4ISR Intelligence Platform)"
VERSION_CODENAME=sentinel
ID=sentinel
ID_LIKE=debian
HOME_URL="https://github.com/hamzazakakhan/sentinel-os"
BUG_REPORT_URL="https://github.com/hamzazakakhan/sentinel-os/issues"
ANSI_COLOR="0;32"
EOF

# /etc/hostname
echo "sentinel-os" > "${OVERLAY_DIR}/etc/hostname"

# /etc/hosts
cat > "${OVERLAY_DIR}/etc/hosts" << 'EOF'
127.0.0.1	localhost
127.0.1.1	sentinel-os
::1		localhost ip6-localhost ip6-loopback
ff02::1		ip6-allnodes
ff02::2		ip6-allrouters
EOF

# /etc/issue — shown on TTY login prompt
cat > "${OVERLAY_DIR}/etc/issue" << 'EOF'
\e[0;32m
  ╔═══════════════════════════════════════════╗
  ║     SENTINEL OS :: C4ISR PLATFORM         ║
  ║     CLASSIFICATION: UNCLASSIFIED          ║
  ╚═══════════════════════════════════════════╝
\e[0m
\n \l

EOF

# /etc/issue.net — shown on remote login
cat > "${OVERLAY_DIR}/etc/issue.net" << 'EOF'
Sentinel OS — C4ISR Intelligence Platform
Authorized access only. All activity is monitored.
EOF

# /etc/motd — shown after login
cat > "${OVERLAY_DIR}/etc/motd" << 'EOF'

  ███████╗███████╗███╗   ██╗████████╗██╗███╗   ██╗███████╗██╗
  ██╔════╝██╔════╝████╗  ██║╚══██╔══╝██║████╗  ██║██╔════╝██║
  ███████╗█████╗  ██╔██╗ ██║   ██║   ██║██╔██╗ ██║█████╗  ██║
  ╚════██║██╔══╝  ██║╚██╗██║   ██║   ██║██║╚██╗██║██╔══╝  ██║
  ███████║███████╗██║ ╚████║   ██║   ██║██║ ╚████║███████╗███████╗
  ╚══════╝╚══════╝╚═╝  ╚═══╝   ╚═╝   ╚═╝╚═╝  ╚═══╝╚══════╝╚══════╝

  Sentinel OS v1.0.0 — C4ISR Intelligence Platform
  ──────────────────────────────────────────────────
  Services:  sudo docker compose -f /opt/sentinel/infrastructure/docker/docker-compose.yml ps
  Shell:     sentinel-shell
  CLI:       sentinel --help
  API:       http://localhost:4000/graphql

EOF

# /etc/lsb-release
cat > "${OVERLAY_DIR}/etc/lsb-release" << EOF
DISTRIB_ID=SentinelOS
DISTRIB_RELEASE=${VERSION}
DISTRIB_CODENAME=sentinel
DISTRIB_DESCRIPTION="Sentinel OS ${VERSION}"
EOF

# ── GRUB boot menu branding ──
mkdir -p "${OVERLAY_DIR}/etc/default/grub.d"
cat > "${OVERLAY_DIR}/etc/default/grub.d/sentinel.cfg" << 'EOF'
GRUB_DISTRIBUTOR="Sentinel OS"
GRUB_TIMEOUT=5
GRUB_CMDLINE_LINUX_DEFAULT="quiet splash"
EOF

# GRUB theme — override the boot menu entries
mkdir -p config/includes.binary/boot/grub
cat > config/includes.binary/boot/grub/grub.cfg << GRUBEOF
set default=0
set timeout=5

menuentry "Sentinel OS — Live (C4ISR Platform)" {
    linux /live/vmlinuz boot=live components username=sentinel hostname=sentinel-os quiet splash
    initrd /live/initrd.img
}

menuentry "Sentinel OS — Live (Safe Mode)" {
    linux /live/vmlinuz boot=live components username=sentinel hostname=sentinel-os nomodeset
    initrd /live/initrd.img
}

menuentry "Sentinel OS — Live (Debug)" {
    linux /live/vmlinuz boot=live components username=sentinel hostname=sentinel-os debug
    initrd /live/initrd.img
}
GRUBEOF

# ISOLINUX/SYSLINUX boot menu (BIOS boot)
mkdir -p config/includes.binary/isolinux
cat > config/includes.binary/isolinux/menu.cfg << 'SYSEOF'
MENU TITLE Sentinel OS Boot Menu
MENU BACKGROUND sentinel.png
MENU COLOR border       30;44   #40ffffff #00000000 std
MENU COLOR title        1;36;44 #ff00ff41 #00000000 std
MENU COLOR sel          7;37;40 #ff00ff41 #20ffffff all
MENU COLOR unsel        37;44   #ffc0c0c0 #00000000 std

DEFAULT live
LABEL live
    MENU LABEL Sentinel OS — Live (C4ISR Platform)
    KERNEL /live/vmlinuz
    APPEND initrd=/live/initrd.img boot=live components username=sentinel hostname=sentinel-os quiet splash
    
LABEL safe
    MENU LABEL Sentinel OS — Live (Safe Mode)
    KERNEL /live/vmlinuz
    APPEND initrd=/live/initrd.img boot=live components username=sentinel hostname=sentinel-os nomodeset

LABEL debug
    MENU LABEL Sentinel OS — Live (Debug)
    KERNEL /live/vmlinuz
    APPEND initrd=/live/initrd.img boot=live components username=sentinel hostname=sentinel-os debug
SYSEOF

# ── LightDM greeter branding ──
mkdir -p "${OVERLAY_DIR}/etc/lightdm"
cat > "${OVERLAY_DIR}/etc/lightdm/lightdm-gtk-greeter.conf" << 'EOF'
[greeter]
theme-name = Adwaita-dark
icon-theme-name = Adwaita
background = /usr/share/backgrounds/sentinel-wallpaper.png
default-user-image = /usr/share/images/sentinel/sentinel-logo.png
clock-format = %Y-%m-%d %H:%M
panel-position = top
position = 50%,center 50%,center
indicators = ~host;~spacer;~clock;~spacer;~session;~power
font-name = JetBrains Mono 11
xft-antialias = true
xft-hintstyle = hintslight
xft-rgba = rgb
EOF

# ── Sentinel OS Wallpaper (used by LightDM, i3, GRUB) ──
# Generate a SVG wallpaper that ImageMagick can convert at boot time
mkdir -p "${OVERLAY_DIR}/usr/share/backgrounds"
mkdir -p "${OVERLAY_DIR}/usr/share/images/sentinel"
cat > "${OVERLAY_DIR}/usr/share/backgrounds/sentinel-wallpaper.svg" << 'WALLEOF'
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
  <defs>
    <radialGradient id="bg" cx="50%" cy="50%" r="70%">
      <stop offset="0%" stop-color="#1a1a2e"/>
      <stop offset="100%" stop-color="#0a0a14"/>
    </radialGradient>
    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
      <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#00ff41" stroke-width="0.3" opacity="0.15"/>
    </pattern>
  </defs>
  <rect width="1920" height="1080" fill="url(#bg)"/>
  <rect width="1920" height="1080" fill="url(#grid)"/>
  <g transform="translate(960, 540)" text-anchor="middle" font-family="monospace" fill="#00ff41">
    <text font-size="72" font-weight="bold" y="-20">SENTINEL OS</text>
    <text font-size="24" y="30" opacity="0.7">C4ISR INTELLIGENCE PLATFORM</text>
    <text font-size="16" y="70" opacity="0.4">v1.0.0 — CLASSIFICATION: UNCLASSIFIED</text>
  </g>
</svg>
WALLEOF

# ── Plymouth Boot Splash Theme (Sentinel OS branding) ──
PLYMOUTH_DIR="${OVERLAY_DIR}/usr/share/plymouth/themes/sentinel"
mkdir -p "${PLYMOUTH_DIR}"
cat > "${PLYMOUTH_DIR}/sentinel.plymouth" << 'PLYEOF'
[Plymouth Theme]
Name=Sentinel OS
Description=Sentinel OS C4ISR Boot Splash
ModuleName=script

[script]
ImageDir=/usr/share/plymouth/themes/sentinel
ScriptFile=/usr/share/plymouth/themes/sentinel/sentinel.script
PLYEOF

cat > "${PLYMOUTH_DIR}/sentinel.script" << 'PLYSCRIPT'
# Sentinel OS Plymouth boot splash
Window.SetBackgroundTopColor(0.04, 0.04, 0.08);
Window.SetBackgroundBottomColor(0.10, 0.10, 0.18);

logo.image = Image("logo.png");
logo.sprite = Sprite(logo.image);
logo.sprite.SetX(Window.GetWidth() / 2 - logo.image.GetWidth() / 2);
logo.sprite.SetY(Window.GetHeight() / 2 - logo.image.GetHeight() / 2);

# Pulse animation
fun refresh_callback() {
    pulse = (Math.Cos(Plymouth.GetTime() * 2) + 1) / 4 + 0.5;
    logo.sprite.SetOpacity(pulse);
}
Plymouth.SetRefreshFunction(refresh_callback);

# Progress bar
progress_box.image = Image.Text("[ INITIALIZING SENTINEL OS ]", 0, 1, 0.25);
progress_box.sprite = Sprite(progress_box.image);
progress_box.sprite.SetX(Window.GetWidth() / 2 - progress_box.image.GetWidth() / 2);
progress_box.sprite.SetY(Window.GetHeight() / 2 + 200);

# Status messages
message_sprite = Sprite();
message_sprite.SetPosition(50, Window.GetHeight() - 50, 10000);

fun message_callback(text) {
    my_image = Image.Text(text, 0, 1, 0.25);
    message_sprite.SetImage(my_image);
}
Plymouth.SetMessageFunction(message_callback);
PLYSCRIPT

# Plymouth logo placeholder (will be generated from SVG by chroot hook)
cat > "${PLYMOUTH_DIR}/logo.svg" << 'LOGOEOF'
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="400" height="120" viewBox="0 0 400 120">
  <text x="200" y="70" text-anchor="middle" font-family="monospace" font-size="48" font-weight="bold" fill="#00ff41">SENTINEL OS</text>
  <text x="200" y="100" text-anchor="middle" font-family="monospace" font-size="14" fill="#00ff41" opacity="0.7">C4ISR PLATFORM</text>
</svg>
LOGOEOF

# ── Add hook to convert SVGs to PNG and install Plymouth theme ──
# This runs in the chroot where ImageMagick/rsvg-convert is available
mkdir -p config/hooks/normal
cat > config/hooks/normal/0300-branding.hook.chroot << 'BRANDEOF'
#!/bin/bash
# Convert Sentinel OS SVG branding assets to PNG and activate Plymouth theme

# Install conversion tool (try multiple options)
apt-get install -y --no-install-recommends librsvg2-bin imagemagick 2>/dev/null || true

# Convert wallpaper SVG -> PNG (1920x1080)
if [ -f /usr/share/backgrounds/sentinel-wallpaper.svg ]; then
  if command -v rsvg-convert >/dev/null 2>&1; then
    rsvg-convert -w 1920 -h 1080 /usr/share/backgrounds/sentinel-wallpaper.svg \
      -o /usr/share/backgrounds/sentinel-wallpaper.png 2>/dev/null || true
  elif command -v convert >/dev/null 2>&1; then
    convert -size 1920x1080 /usr/share/backgrounds/sentinel-wallpaper.svg \
      /usr/share/backgrounds/sentinel-wallpaper.png 2>/dev/null || true
  fi
fi

# Convert Plymouth logo SVG -> PNG
if [ -f /usr/share/plymouth/themes/sentinel/logo.svg ]; then
  if command -v rsvg-convert >/dev/null 2>&1; then
    rsvg-convert -w 400 -h 120 /usr/share/plymouth/themes/sentinel/logo.svg \
      -o /usr/share/plymouth/themes/sentinel/logo.png 2>/dev/null || true
  elif command -v convert >/dev/null 2>&1; then
    convert -size 400x120 /usr/share/plymouth/themes/sentinel/logo.svg \
      /usr/share/plymouth/themes/sentinel/logo.png 2>/dev/null || true
  fi
fi

# Sentinel logo for LightDM user image
if [ -f /usr/share/plymouth/themes/sentinel/logo.png ]; then
  cp /usr/share/plymouth/themes/sentinel/logo.png /usr/share/images/sentinel/sentinel-logo.png 2>/dev/null || true
fi

# Activate Plymouth theme
if command -v plymouth-set-default-theme >/dev/null 2>&1; then
  plymouth-set-default-theme sentinel 2>/dev/null || true
  update-initramfs -u 2>/dev/null || true
  echo "Plymouth theme set to sentinel"
fi

# Set GRUB background image
if [ -f /usr/share/backgrounds/sentinel-wallpaper.png ]; then
  cp /usr/share/backgrounds/sentinel-wallpaper.png /boot/grub/sentinel-bg.png 2>/dev/null || true
fi

echo "Sentinel OS branding assets installed"
BRANDEOF
chmod +x config/hooks/normal/0300-branding.hook.chroot

# ── Update GRUB defaults to use Sentinel splash + theme ──
cat >> "${OVERLAY_DIR}/etc/default/grub.d/sentinel.cfg" << 'EOF'
GRUB_BACKGROUND="/boot/grub/sentinel-bg.png"
GRUB_GFXMODE=1920x1080,1280x720,auto
GRUB_THEME=""
EOF

ok "Sentinel OS branding applied (Plymouth, wallpaper, GRUB, LightDM, MOTD, os-release)"

# ── Build ──
log "Starting ISO build (this takes 20-60 minutes)..."

lb build 2>&1 | tee "${BUILD_DIR}/build.log"

# ── Restore patched binary_iso script ──
if [[ -f "${BINARY_ISO_SCRIPT}.bak" ]]; then
  mv "${BINARY_ISO_SCRIPT}.bak" "${BINARY_ISO_SCRIPT}"
  log "Restored original binary_iso script"
fi

# ── Rename output (iso-hybrid produces .hybrid.iso) ──
ISO_FILE=""
if [[ -f live-image-amd64.hybrid.iso ]]; then
  ISO_FILE="live-image-amd64.hybrid.iso"
elif [[ -f live-image-amd64.iso ]]; then
  ISO_FILE="live-image-amd64.iso"
fi

if [[ -n "${ISO_FILE}" ]]; then
  mv "${ISO_FILE}" "${ISO_NAME}.iso"

  # Write MBR boot code for BIOS USB boot (removed from xorriso to bypass DVD size limit)
  ISOHDPFX="/usr/lib/ISOLINUX/isohdpfx.bin"
  if [[ -f "${ISOHDPFX}" ]]; then
    dd if="${ISOHDPFX}" of="${ISO_NAME}.iso" bs=432 count=1 conv=notrunc 2>/dev/null
    ok "Wrote MBR boot code (isohdpfx.bin) for BIOS USB boot"
  else
    log "WARNING: ${ISOHDPFX} not found — ISO may not boot on BIOS systems"
  fi

  ok "ISO built: ${BUILD_DIR}/${ISO_NAME}.iso"

  # Generate SHA256 checksum
  sha256sum "${ISO_NAME}.iso" > "${ISO_NAME}.iso.sha256"
  ok "Checksum: ${ISO_NAME}.iso.sha256"

  # Show size
  SIZE=$(du -h "${ISO_NAME}.iso" | cut -f1)
  log "ISO size: ${SIZE}"

  # Flash instructions
  log "Flash to USB:"
  log "  sudo dd if=${ISO_NAME}.iso of=/dev/sdX bs=4M status=progress && sync"
  log "  or: balenaEtcher / Rufus"
else
  err "ISO build failed — check ${BUILD_DIR}/build.log"
fi

log "Build complete."
