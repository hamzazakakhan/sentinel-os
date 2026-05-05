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
  --uefi-secure-boot disable

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
# Sentinel OS base packages
kali-archive-keyring
curl
wget
xserver-xorg-core
lightdm
i3-wm
polybar
rofi
alacritty
network-manager
linux-image-amd64
linux-headers-amd64
firmware-iwlwifi
firmware-atheros
# task-laptop pulls too many packages — install essentials separately
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

# Install xorg server and drivers (broken deps on kali-rolling)
apt-get install -y --no-install-recommends xserver-xorg-core xserver-xorg-input-libinput xserver-xorg-video-amdgpu xserver-xorg-video-nouveau xserver-xorg-video-vesa xserver-xorg-video-fbdev 2>/dev/null || true
apt-get install -y wireshark-cli tshark wpasupplicant aircrack-ng 2>/dev/null || true

# Install zeek from binary release (libc6 conflict in kali-rolling apt)
curl -sSL https://download.zeek.org/zeek-6.2.1-x86_64-pkg-6ad388b9e4_linux.tar.gz -o /tmp/zeek.tar.gz 2>/dev/null && tar -xzf /tmp/zeek.tar.gz -C /opt && ln -sf /opt/zeek-*/bin/zeek /usr/local/bin/zeek 2>/dev/null || true
rm -f /tmp/zeek.tar.gz

# Install SDR tools from source
apt-get install -y cmake git build-essential libusb-1.0-0-dev librtlsdr-dev 2>/dev/null || true
cd /tmp
git clone https://github.com/antirez/dump1090.git 2>/dev/null && cd dump1090 && make && make install 2>/dev/null || true
cd /tmp
git clone https://github.com/TLeconte/acarsdec.git 2>/dev/null && cd acarsdec && mkdir build && cd build && cmake .. && make && make install 2>/dev/null || true
cd /tmp
pip3 install volatility3 2>/dev/null || true
rm -rf /tmp/dump1090 /tmp/acarsdec

# Install Sentinel OS npm service dependencies
cd /opt/sentinel/services && for svc in */; do
  if [ -f "/opt/sentinel/services/$svc/package.json" ]; then
    echo "Installing npm deps for $svc"
    cd "/opt/sentinel/services/$svc"
    npm install --production 2>/dev/null || true
    cd /opt/sentinel/services
  fi
done

# Build Sentinel OS shell (Tauri)
if [ -d "/opt/sentinel/shell" ]; then
  cd /opt/sentinel/shell
  npm install --production 2>/dev/null || true
fi

# Create sentinel user for autologin and add to autologin group
id sentinel 2>/dev/null || useradd -m -s /bin/bash sentinel 2>/dev/null || true
groupadd -f autologin 2>/dev/null || true
usermod -aG autologin,sudo,docker sentinel 2>/dev/null || true
echo "sentinel:sentinel" | chpasswd 2>/dev/null || true

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

# ── Add Kali apt sources for post-boot package management ──
mkdir -p "${OVERLAY_DIR}/etc/apt/sources.list.d"
cat > "${OVERLAY_DIR}/etc/apt/sources.list.d/kali.list" << 'EOF'
deb [signed-by=/usr/share/keyrings/kali-archive-keyring.gpg] http://kali.download/kali kali-rolling main contrib non-free non-free-firmware
EOF

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
