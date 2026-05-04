# Sentinel OS — ISO Build Guide

## Prerequisites

- Linux build host (Debian 13 / Ubuntu 24.04+)
- Root/sudo access
- Packages: `debootstrap squashfs-tools xorriso isolinux grub-efi-amd64-bin grub-pc-bin mtools`
- Sentinel OS hardened kernel (see KERNEL_BUILD.md)

## Quick Build

```bash
# Full ISO build (takes ~30-60 minutes)
sudo ./build/build-iso.sh
```

Output: `sentinel-os-2.0.iso`

## Customization

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `WORK` | `/build/sentinel` | Build working directory |
| `KERNEL_VERSION` | `6.12.0-sentinel` | Kernel version to install |
| `MIRROR` | `http://deb.debian.org/debian` | Debian mirror URL |

### Build Steps (Manual)

1. **Bootstrap** — `debootstrap --arch=amd64 trixie /build/sentinel/chroot`
2. **Configure** — `./build/chroot/setup-chroot.sh /build/sentinel/chroot`
3. **Squash** — `mksquashfs chroot iso/live/filesystem.squashfs -comp zstd -Xcompression-level 19`
4. **GRUB** — Copy `build/grub/grub.cfg` to `iso/boot/grub/grub.cfg`
5. **ISO** — `xorriso -as mkisofs ... iso/`

## Boot Modes

| GRUB Option | Description |
|-------------|-------------|
| Amnesic | Zero traces on host. No persistence. RAM wiped on shutdown. |
| Encrypted Persistence | LUKS2 partition on USB. Config/data survives reboot. |
| Safe Mode | No AppArmor, no hardening. For troubleshooting. |
| Debug | Verbose kernel log. For development. |

## Verification

```bash
# Check ISO size
ls -lh sentinel-os-2.0.iso

# Verify checksum
sha256sum -c sentinel-os-2.0.iso.sha256

# Test boot in QEMU
qemu-system-x86_64 -m 4096 -cdrom sentinel-os-2.0.iso -boot d
```
