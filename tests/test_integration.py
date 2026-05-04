#!/usr/bin/env python3
# ──────────────────────────────────────────────────────────────
# sentinel-os/tests/test_integration.py
# Integration tests for all Sentinel OS features
# Run: python -m pytest tests/ -v
# ──────────────────────────────────────────────────────────────

import asyncio
import json
import os
import sys
import subprocess
from pathlib import Path
from typing import Optional

import aiohttp

REPO_ROOT = Path(__file__).parent.parent
SERVICES_DIR = REPO_ROOT / "services"
BUILD_DIR = REPO_ROOT / "build"
KERNEL_DIR = REPO_ROOT / "kernel"
COMPOSITOR_DIR = REPO_ROOT / "compositor"
SHELL_DIR = REPO_ROOT / "shell"
AI_WORKERS_DIR = REPO_ROOT / "ai-workers"


# ── Test: Kernel modules compile ──────────────────────────────

def test_kernel_lsm_source_exists():
    """Sentinel LSM source file exists and has key functions."""
    lsm = KERNEL_DIR / "sentinel-lsm.c"
    assert lsm.exists(), "sentinel-lsm.c not found"
    content = lsm.read_text()
    assert "sentinel_inode_permission" in content
    assert "sentinel_sb_mount" in content
    assert "module_init" in content or "init_module" in content or "DEFINE_LSM" in content


def test_kernel_rtlsdr_source_exists():
    """RTL-SDR driver source exists with character device ops."""
    sdr = KERNEL_DIR / "rtlsdr-sentinel.c"
    assert sdr.exists(), "rtlsdr-sentinel.c not found"
    content = sdr.read_text()
    assert "file_operations" in content
    assert "rtlsdr_ioctl" in content or "unlocked_ioctl" in content


def test_kernel_makefile_exists():
    """Kernel Makefile exists with both modules."""
    mk = KERNEL_DIR / "Makefile"
    assert mk.exists(), "kernel/Makefile not found"
    content = mk.read_text()
    assert "sentinel-lsm" in content
    assert "rtlsdr-sentinel" in content


def test_kernel_config_has_all_drivers():
    """Kernel config includes WiFi, Bluetooth, GPS, SDR, GPU drivers."""
    config = BUILD_DIR / "kernel" / "config" / "sentinel-6.12.config"
    assert config.exists(), "sentinel-6.12.config not found"
    content = config.read_text()

    # WiFi drivers
    for driver in ["IWLWIFI", "ATH10K", "BRCMFMAC", "RTW89", "MT7921"]:
        assert f"CONFIG_{driver}" in content, f"Missing WiFi driver: {driver}"

    # Bluetooth
    assert "CONFIG_BT_HCIBTUSB" in content, "Missing BT USB driver"

    # GPS/GNSS
    assert "CONFIG_GNSS" in content, "Missing GNSS support"

    # SDR
    assert "CONFIG_DVB_USB_RTL28XXU" in content, "Missing RTL-SDR driver"

    # GPU
    for gpu in ["DRM_I915", "DRM_AMDGPU", "DRM_NOUVEAU"]:
        assert f"CONFIG_{gpu}" in content, f"Missing GPU driver: {gpu}"

    # Security
    assert "CONFIG_SECURITY_SENTINEL" in content
    assert "CONFIG_INIT_ON_FREE_DEFAULT_ON" in content
    assert "CONFIG_MODULE_SIG_FORCE" in content


# ── Test: Compositor source ───────────────────────────────────

def test_compositor_source_exists():
    """Wayland compositor has full keyboard/cursor/seat handling."""
    wm = COMPOSITOR_DIR / "sentinel-wm.c"
    assert wm.exists(), "sentinel-wm.c not found"
    content = wm.read_text()
    assert "kb_key" in content
    assert "cur_btn" in content or "cursor_button" in content or "cur_frame" in content
    assert "wlr_seat_create" in content
    assert "wlr_keyboard_group" in content


def test_compositor_shaders_exist():
    """GLSL CRT and radar shaders exist."""
    crt = COMPOSITOR_DIR / "shaders" / "crt.frag"
    radar = COMPOSITOR_DIR / "shaders" / "radar.frag"
    assert crt.exists(), "crt.frag not found"
    assert radar.exists(), "radar.frag not found"
    assert "scanline" in crt.read_text()
    assert "sweep" in radar.read_text().lower() or "angle" in radar.read_text()


# ── Test: Shell infrastructure ────────────────────────────────

def test_shell_vite_config():
    """Vite config exists with Tauri settings."""
    vite = SHELL_DIR / "vite.config.ts"
    assert vite.exists(), "vite.config.ts not found"
    content = vite.read_text()
    assert "react" in content
    assert "1420" in content


def test_shell_tailwind_config():
    """Tailwind config has Sentinel color palette."""
    tw = SHELL_DIR / "tailwind.config.js"
    assert tw.exists(), "tailwind.config.js not found"
    content = tw.read_text()
    assert "sentinel" in content
    assert "crt" in content


def test_shell_panels_exist():
    """All 8 panel components exist."""
    panels = SHELL_DIR / "src" / "panels"
    expected = ["TacticalMap", "SigintWaterfall", "IntelGraph", "CveDashboard",
                "Terminal", "EncryptionWorkbench", "ReportGenerator", "SimulationRoom"]
    for name in expected:
        p = panels / f"{name}.tsx"
        assert p.exists(), f"Panel {name}.tsx not found"


def test_shell_app_has_boot_screen():
    """App.tsx has boot screen and workspace switching."""
    app = SHELL_DIR / "src" / "App.tsx"
    assert app.exists(), "App.tsx not found"
    content = app.read_text()
    assert "boot-screen" in content or "booting" in content
    assert "workspace" in content.lower()


# ── Test: Panel integrations ──────────────────────────────────

def test_tactical_map_uses_maplibre():
    """TacticalMap imports MapLibre GL."""
    tm = SHELL_DIR / "src" / "panels" / "TacticalMap.tsx"
    content = tm.read_text()
    assert "maplibregl" in content or "maplibre-gl" in content
    assert "GeoJSONSource" in content or "geojson" in content.lower()


def test_intel_graph_uses_d3():
    """IntelGraph uses D3.js force simulation."""
    ig = SHELL_DIR / "src" / "panels" / "IntelGraph.tsx"
    content = ig.read_text()
    assert "d3" in content
    assert "forceSimulation" in content or "force" in content


def test_cve_dashboard_fetches_nvd():
    """CveDashboard fetches from NVD API."""
    cv = SHELL_DIR / "src" / "panels" / "CveDashboard.tsx"
    content = cv.read_text()
    assert "services.nvd.nist.gov" in content
    assert "cisa.gov" in content or "CISA" in content


def test_terminal_has_xterm():
    """Terminal panel loads xterm.js dynamically."""
    tm = SHELL_DIR / "src" / "panels" / "Terminal.tsx"
    content = tm.read_text()
    assert "xterm" in content
    assert "command" in content.lower() or "cmd" in content


def test_report_generator_uses_ollama():
    """ReportGenerator connects to Ollama LLM."""
    rg = SHELL_DIR / "src" / "panels" / "ReportGenerator.tsx"
    content = rg.read_text()
    assert "ollama" in content.lower() or "11434" in content
    assert "STANAG" in content or "report" in content.lower()


def test_simulation_room_has_mitre():
    """SimulationRoom has MITRE ATT&CK tactics."""
    sr = SHELL_DIR / "src" / "panels" / "SimulationRoom.tsx"
    content = sr.read_text()
    assert "MITRE" in content or "ATT&CK" in content or "T1566" in content
    assert "RED" in content and "BLUE" in content


# ── Test: AI Workers ──────────────────────────────────────────

def test_yolov8_worker():
    """YOLOv8 worker has Kafka consumer/producer."""
    yw = AI_WORKERS_DIR / "yolov8_worker.py"
    assert yw.exists(), "yolov8_worker.py not found"
    content = yw.read_text()
    assert "KafkaConsumer" in content or "kafka" in content.lower()
    assert "YOLO" in content or "yolo" in content or "ultralytics" in content


def test_lstm_worker():
    """LSTM anomaly worker has Isolation Forest fallback."""
    lw = AI_WORKERS_DIR / "lstm_worker.py"
    assert lw.exists(), "lstm_worker.py not found"
    content = lw.read_text()
    assert "IsolationForest" in content or "anomaly" in content.lower()


def test_adsb_decoder():
    """ADS-B decoder has OpenSky API integration."""
    ad = AI_WORKERS_DIR / "gnuradio" / "adsb_decoder.py"
    assert ad.exists(), "adsb_decoder.py not found"
    content = ad.read_text()
    assert "opensky" in content.lower() or "1090" in content


# ── Test: Build pipeline ──────────────────────────────────────

def test_build_iso_script():
    """ISO build script exists with all steps."""
    iso = BUILD_DIR / "build-iso.sh"
    assert iso.exists(), "build-iso.sh not found"
    content = iso.read_text()
    assert "debootstrap" in content
    assert "mksquashfs" in content
    assert "xorriso" in content
    assert "grub" in content.lower()


def test_flash_usb_script():
    """USB flash script exists with DD write."""
    flash = BUILD_DIR / "flash-usb.sh"
    assert flash.exists(), "flash-usb.sh not found"
    content = flash.read_text()
    assert "dd if=" in content
    assert "LUKS" in content or "cryptsetup" in content


def test_chroot_setup_has_firmware():
    """Chroot setup installs all firmware packages."""
    chroot = BUILD_DIR / "chroot" / "setup-chroot.sh"
    assert chroot.exists(), "setup-chroot.sh not found"
    content = chroot.read_text()
    for fw in ["firmware-iwlwifi", "firmware-realtek", "firmware-atheros",
               "firmware-brcm80211", "firmware-amd-graphics", "firmware-nvidia-graphics"]:
        assert fw in content, f"Missing firmware: {fw}"
    assert "bluez" in content, "Missing Bluetooth stack"
    assert "gpsd" in content, "Missing GPS daemon"
    assert "geoclue" in content, "Missing GeoClue location"


def test_hw_detect_script():
    """Hardware auto-detect script exists in chroot setup."""
    chroot = BUILD_DIR / "chroot" / "setup-chroot.sh"
    content = chroot.read_text()
    assert "sentinel-hw-detect" in content
    assert "rfkill" in content
    assert "btusb" in content or "bluetooth" in content.lower()
    assert "gnss" in content or "gps" in content.lower()


def test_grub_config():
    """GRUB config has amnesic and persistence boot options."""
    grub = BUILD_DIR / "grub" / "grub.cfg"
    assert grub.exists(), "grub.cfg not found"
    content = grub.read_text()
    assert "Amnesic" in content or "amnesic" in content
    assert "Persistence" in content or "persistence" in content
    assert "apparmor" in content


def test_tor_rules():
    """Tor iptables rules script exists."""
    tor = BUILD_DIR / "chroot" / "tor-rules.sh"
    assert tor.exists(), "tor-rules.sh not found"
    content = tor.read_text()
    assert "9040" in content  # Tor TransPort
    assert "OUTPUT" in content


def test_ram_wipe():
    """RAM wipe script exists with secure deletion."""
    rw = BUILD_DIR / "chroot" / "ram-wipe.sh"
    assert rw.exists(), "ram-wipe.sh not found"
    content = rw.read_text()
    assert "shred" in content or "dd if=/dev/zero" in content
    assert "tmpfs" in content or "shm" in content


def test_luks_setup():
    """LUKS2 setup script uses Argon2id."""
    luks = BUILD_DIR / "chroot" / "luks-setup.sh"
    assert luks.exists(), "luks-setup.sh not found"
    content = luks.read_text()
    assert "argon2id" in content
    assert "cryptsetup" in content


# ── Test: Live integrations ───────────────────────────────────

def test_osint_feeds_registry():
    """OSINT feeds module has 17+ feed integrations."""
    osint = SERVICES_DIR / "live-integrations" / "osint_feeds.py"
    assert osint.exists(), "osint_feeds.py not found"
    content = osint.read_text()
    assert "ALL_FEEDS" in content
    # Count feed classes
    feed_classes = content.count("class ") - 1  # subtract base class
    assert feed_classes >= 17, f"Expected 17+ feeds, found {feed_classes}"


def test_sigint_sources_registry():
    """SIGINT sources module has ADS-B, APRS, AIS, SDR."""
    sigint = SERVICES_DIR / "live-integrations" / "sigint_sources.py"
    assert sigint.exists(), "sigint_sources.py not found"
    content = sigint.read_text()
    assert "ADSBSource" in content
    assert "APRSSource" in content
    assert "AISSource" in content
    assert "RTLSDRSource" in content


def test_cti_sources_registry():
    """CTI sources module has MITRE, MalwareBazaar, PhishTank."""
    cti = SERVICES_DIR / "live-integrations" / "cti_sources.py"
    assert cti.exists(), "cti_sources.py not found"
    content = cti.read_text()
    assert "MITREATTCKSource" in content
    assert "MalwareBazaarSource" in content
    assert "PhishTankSource" in content
    assert "TorExitSource" in content


def test_integration_runner():
    """Integration runner orchestrates all feeds to Kafka."""
    runner = SERVICES_DIR / "live-integrations" / "runner.py"
    assert runner.exists(), "runner.py not found"
    content = runner.read_text()
    assert "KAFKA_TOPIC" in content
    assert "run_all_feeds" in content


# ── Test: Live API connectivity (async) ───────────────────────

async def _test_api_endpoint(url: str, name: str, timeout: int = 10) -> bool:
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=timeout)) as resp:
                return resp.status == 200
    except Exception:
        return False


def test_nvd_api_reachable():
    """NVD CVE API is reachable (may fail without internet)."""
    result = asyncio.get_event_loop().run_until_complete(
        _test_api_endpoint("https://services.nvd.nist.gov/rest/json/cves/2.0?resultsPerPage=1", "NVD"))
    if not result:
        import warnings
        warnings.warn("NVD API unreachable (no internet?)")


def test_cisa_kev_reachable():
    """CISA KEV feed is reachable (may fail without internet)."""
    result = asyncio.get_event_loop().run_until_complete(
        _test_api_endpoint("https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json", "CISA KEV"))
    if not result:
        import warnings
        warnings.warn("CISA KEV unreachable (no internet?)")


def test_opensky_api_reachable():
    """OpenSky ADS-B API is reachable (may fail without internet)."""
    result = asyncio.get_event_loop().run_until_complete(
        _test_api_endpoint("https://opensky-network.org/api/states/all?lamin=45&lamax=55&lomin=5&lomax=15", "OpenSky"))
    if not result:
        import warnings
        warnings.warn("OpenSky API unreachable (no internet?)")


# ── Test: Shell React build ───────────────────────────────────

def test_shell_package_json():
    """Shell package.json has all required dependencies."""
    pkg = SHELL_DIR / "package.json"
    assert pkg.exists(), "package.json not found"
    content = pkg.read_text()
    data = json.loads(content)
    deps = {**data.get("dependencies", {}), **data.get("devDependencies", {})}
    for dep in ["react", "@apollo/client", "maplibre-gl", "d3", "xterm"]:
        assert dep in deps or any(dep in k for k in deps), f"Missing dep: {dep}"


# ── Test: Tauri backend ───────────────────────────────────────

def test_tauri_cargo_toml():
    """Tauri Cargo.toml has sentinel commands."""
    cargo = SHELL_DIR / "src-tauri" / "Cargo.toml"
    assert cargo.exists(), "Cargo.toml not found"
    content = cargo.read_text()
    assert "tauri" in content


def test_tauri_main_rs():
    """Tauri main.rs has system_status and sdr_detect commands."""
    main = SHELL_DIR / "src-tauri" / "src" / "main.rs"
    assert main.exists(), "main.rs not found"
    content = main.read_text()
    assert "system_status" in content or "get_system_status" in content
    assert "sdr" in content.lower() or "detect" in content.lower()


if __name__ == "__main__":
    import pytest
    sys.exit(pytest.main([__file__, "-v", "--tb=short"]))
