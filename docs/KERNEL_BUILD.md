# Sentinel OS — Kernel Build Guide

## Prerequisites

- Linux build host (Debian 13 / Ubuntu 24.04+)
- Build dependencies: `build-essential libncurses-dev bison flex libssl-dev libelf-dev`
- At least 30GB free disk space
- 8GB+ RAM recommended

## Quick Build

```bash
# 1. Get kernel source
git clone --depth 1 --branch v6.12 https://git.kernel.org/pub/scm/linux/kernel/git/stable/linux.git
cd linux

# 2. Apply Sentinel patches
/path/to/sentinel-os/build/kernel/apply-patches.sh

# 3. Build (uses hardened config automatically)
make -j$(nproc) ARCH=x86_64 bzImage modules

# 4. Install modules to staging
make modules_install INSTALL_MOD_PATH=/build/sentinel-rootfs
```

## Custom Kernel Configuration

The Sentinel hardened config is at `build/kernel/config/sentinel-6.12.config`.

Key security features enabled:
- **KASLR** — Kernel Address Space Layout Randomization
- **INIT_ON_FREE** — Wipe freed memory pages (anti-forensic)
- **PAGE_TABLE_ISOLATION** — Spectre/Meltdown mitigation
- **STRICT_KERNEL_RWX** — Read-only kernel text
- **FORTIFY_SOURCE** — Buffer overflow detection
- **STACKPROTECTOR_STRONG** — Stack canary protection
- **MODULE_SIG_FORCE** — Only signed kernel modules
- **SECURITY_SENTINEL** — Custom LSM (boot lockdown, mount audit, ptrace block)

## RTL-SDR Driver

The enhanced RTL-SDR driver (`kernel/rtlsdr-sentinel.c`) provides:
- Auto-detection of RTL-SDR v4 dongles
- IQ sample streaming via `/dev/sentinel-sdrN` character device
- Direct sampling mode for HF reception (ioctl `0xC0DE0003`)
- Bias-tee control for LNA power (ioctl `0xC0DE0004`)
- 256KB ring buffer for zero-loss IQ capture

Build as module:
```bash
cd kernel/
make
sudo make install
sudo modprobe rtlsdr-sentinel
```
