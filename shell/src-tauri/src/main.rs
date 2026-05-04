// ──────────────────────────────────────────────────────────────
// sentinel-os/shell/src-tauri/src/main.rs
// Sentinel OS Tauri v2 Shell — Rust Backend
//
// Provides OS-level access for the React HUD frontend:
//   - USB/SDR device detection
//   - Process spawning (terminal, SIGINT tools)
//   - IPC bridge between UI and OS services
// ──────────────────────────────────────────────────────────────

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::process::Command;

// ── System status response ────────────────────────────────────
#[derive(Serialize, Clone)]
struct SystemStatus {
    services_online: u32,
    services_total: u32,
    threat_level: String,
    tor_circuit_ok: bool,
    sdr_detected: bool,
    sdr_device: String,
    uptime_seconds: u64,
}

// ── All Sentinel OS microservices ─────────────────────────────
const SERVICES: &[(&str, &str)] = &[
    ("api-gateway",   "http://localhost:4000/healthz"),
    ("auth-service",  "http://localhost:4001/health"),
    ("ingestion",     "http://localhost:5000/health"),
    ("ai-service",    "http://localhost:5001/health"),
    ("cyber-service", "http://localhost:4002/health"),
    ("osint-service", "http://localhost:4003/health"),
    ("sigint-service","http://localhost:8080/health"),
    ("fusion-service","http://localhost:4004/health"),
    ("governance",    "http://localhost:4005/health"),
    ("response",      "http://localhost:4006/health"),
    ("geo-service",   "http://localhost:4007/health"),
    ("healing-agent", "http://localhost:4011/health"),
];

// ── Command: get system status ────────────────────────────────
#[tauri::command]
async fn get_system_status() -> Result<SystemStatus, String> {
    let sdr_detected = std::path::Path::new("/dev/sentinel-sdr0").exists()
        || Command::new("lsusb").output()
            .map(|o| String::from_utf8_lossy(&o.stdout).contains("RTL2838"))
            .unwrap_or(false);
    let sdr_device = if sdr_detected { "RTL-SDR".to_string() } else { "None".to_string() };

    // Check Tor circuit
    let tor_ok = Command::new("curl")
        .args(["--socks5", "localhost:9050", "-s", "--max-time", "3", "https://check.torproject.org/api/ip"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    // Check all services
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(2))
        .build().map_err(|e| e.to_string())?;

    let mut online = 0u32;
    for (_name, url) in SERVICES {
        if client.get(*url).send().await.map(|r| r.status().is_success()).unwrap_or(false) {
            online += 1;
        }
    }

    let total = SERVICES.len() as u32;
    let threat_level = if online == total { "NORMAL" }
        else if online >= total * 3 / 4 { "ELEVATED" }
        else if online >= total / 2 { "HIGH" }
        else { "CRITICAL" };

    Ok(SystemStatus {
        services_online: online,
        services_total: total,
        threat_level: threat_level.to_string(),
        tor_circuit_ok: tor_ok,
        sdr_detected,
        sdr_device,
        uptime_seconds: 0,
    })
}

// ── Command: detect USB SDR devices ──────────────────────────
#[tauri::command]
fn detect_sdr_devices() -> Result<Vec<String>, String> {
    let mut devices = Vec::new();

    // Check for RTL-SDR via our custom driver
    if std::path::Path::new("/dev/sentinel-sdr0").exists() {
        devices.push("RTL-SDR v4 (sentinel-sdr0)".to_string());
    }

    // Check via lsusb
    let output = Command::new("lsusb")
        .output()
        .map_err(|e| format!("lsusb failed: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    for line in stdout.lines() {
        if line.contains("Realtek") || line.contains("RTL2838") {
            devices.push(format!("RTL-SDR (USB): {}", line.trim()));
        }
        if line.contains("HackRF") {
            devices.push(format!("HackRF One (USB): {}", line.trim()));
        }
    }

    Ok(devices)
}

// ── Command: spawn terminal ──────────────────────────────────
#[tauri::command]
fn spawn_terminal() -> Result<(), String> {
    Command::new("kitty")
        .spawn()
        .map_err(|e| format!("Failed to spawn terminal: {}", e))?;
    Ok(())
}

// ── Command: spawn process ───────────────────────────────────
#[tauri::command]
fn spawn_process(program: String, args: Vec<String>) -> Result<(), String> {
    Command::new(&program)
        .args(&args)
        .spawn()
        .map_err(|e| format!("Failed to spawn {}: {}", program, e))?;
    Ok(())
}

// ── Command: get service health (all 12 services) ────────────
#[tauri::command]
async fn get_service_health() -> Result<serde_json::Value, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .map_err(|e| e.to_string())?;

    let mut results = serde_json::Map::new();
    for (name, url) in SERVICES {
        let status = match client.get(*url).send().await {
            Ok(resp) if resp.status().is_success() => "LIVE",
            Ok(_) => "DEGRADED",
            Err(_) => "OFFLINE",
        };
        results.insert(name.to_string(), serde_json::Value::String(status.to_string()));
    }

    Ok(serde_json::Value::Object(results))
}

// ── Main ─────────────────────────────────────────────────────
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            get_system_status,
            detect_sdr_devices,
            spawn_terminal,
            spawn_process,
            get_service_health,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Sentinel OS shell");
}
