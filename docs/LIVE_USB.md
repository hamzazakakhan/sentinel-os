# Sentinel OS — Live USB Guide

## Writing the ISO to USB

### Linux

```bash
# Write ISO to USB (replace /dev/sdX with your USB device)
dd if=sentinel-os-2.0.iso of=/dev/sdX bs=4M status=progress oflag=sync

# Verify
dd if=/dev/sdX bs=4M count=1 | md5sum
```

### macOS

```bash
# Convert to raw image
hdiutil convert sentinel-os-2.0.iso -format UDRW -o sentinel-os-2.0.dmg

# Write to USB (replace N with disk number)
diskutil unmountDisk /dev/diskN
sudo dd if=sentinel-os-2.0.dmg of=/dev/diskN bs=4m
diskutil eject /dev/diskN
```

### Windows

Use [Rufus](https://rufus.ie/) or [Balena Etcher](https://www.balena.io/etcher/) — select the ISO and write to USB.

## Adding Encrypted Persistence

After writing the ISO, create a LUKS2 partition on the remaining USB space:

```bash
# Run the LUKS setup script
sudo ./build/chroot/luks-setup.sh /dev/sdX 3
```

This creates a LUKS2/Argon2id encrypted partition. On boot, select "Encrypted Persistence" from GRUB and enter your passphrase.

**Persisted directories:**
- `/home/operator` — User home directory
- `/etc/sentinel` — Configuration files
- `/opt/sentinel/data` — Database state
- `/var/lib/sentinel` — Service data
- `/root/.gnupg` — GPG keys
- `/root/.ssh` — SSH keys

## Boot Sequence

1. **BIOS/UEFI** → GRUB2 bootloader on USB
2. **GRUB2** → Select boot mode (Amnesic / Persistence / Safe / Debug)
3. **Kernel** → Linux 6.12 hardened decompresses, KASLR randomizes
4. **initramfs** → Mounts tmpfs, loads SquashFS from USB, creates OverlayFS
5. **Root FS** → Debian 13 base runs entirely from RAM
6. **Systemd** → Starts Tor, Kafka, Sentinel services, HUD
7. **Ready** → Full operational HUD in ~60 seconds

## Shutdown (Amnesic Mode)

On shutdown, Sentinel OS:
1. Kills all user processes
2. Unmounts tmpfs filesystems
3. Shreds sensitive files (`shred -u -n 3`)
4. Drops all filesystem caches
5. Overwrites `/dev/shm` with zeros
6. Wipes swap partitions
7. **Zero forensic traces remain on the host machine**

## Hardware Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| CPU | x86-64, 2 cores | 4+ cores |
| RAM | 4 GB | 8 GB |
| USB | 16 GB, USB 2.0 | 32 GB, USB 3.0 |
| GPU | Any (software render) | NVIDIA (CUDA for AI) |
| SDR | None | RTL-SDR v4 ($40) |
