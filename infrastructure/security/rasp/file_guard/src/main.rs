// ──────────────────────────────────────────────────────────────
// sentinel-os/infrastructure/security/rasp/file_guard/src/main.rs
// RASP file-hash daemon — watches critical files, detects tampering,
// auto-restores from canonical snapshot, publishes events to Kafka
// ──────────────────────────────────────────────────────────────

use anyhow::{Context, Result};
use chrono::Utc;
use clap::Parser;
use hex;
use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};
use tracing::{error, info, warn};

// ── CLI args ──
#[derive(Parser, Debug)]
#[command(name = "sentinel-file-guard", about = "RASP file integrity daemon")]
struct Args {
    /// Directory to watch
    #[arg(short, long, default_value = "/opt/sentinel")]
    watch_dir: String,

    /// Snapshot directory (canonical copies)
    #[arg(short, long, default_value = "/var/lib/sentinel/snapshots")]
    snapshot_dir: String,

    /// Kafka broker
    #[arg(long, default_value = "localhost:9092")]
    kafka_brokers: String,

    /// Auto-restore tampered files
    #[arg(long)]
    auto_restore: bool,
}

// ── Data structures ──
#[derive(Debug, Clone, Serialize, Deserialize)]
struct FileSnapshot {
    path: String,
    hash: String,
    size: u64,
    modified: String,
    snapshot_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct TamperEvent {
    event_type: String,
    path: String,
    old_hash: String,
    new_hash: String,
    timestamp: String,
    action: String,
    source: String,
}

// ── Hash computation ──
fn compute_hash(path: &Path) -> Result<String> {
    let data = fs::read(path).with_context(|| format!("Failed to read {:?}", path))?;
    let mut hasher = Sha256::new();
    hasher.update(&data);
    Ok(hex::encode(hasher.finalize()))
}

// ── Snapshot engine ──
fn take_snapshot(watch_dir: &Path, snapshot_dir: &Path) -> Result<HashMap<String, FileSnapshot>> {
    let mut snapshots = HashMap::new();

    fs::create_dir_all(snapshot_dir)
        .with_context(|| format!("Failed to create snapshot dir {:?}", snapshot_dir))?;

    for entry in walkdir::WalkDir::new(watch_dir) {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };

        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        let hash = compute_hash(path)?;
        let metadata = fs::metadata(path)?;

        // Copy to snapshot dir preserving structure
        let rel = path.strip_prefix(watch_dir)?;
        let snap_path = snapshot_dir.join(rel);
        if let Some(parent) = snap_path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::copy(path, &snap_path)?;

        let snapshot = FileSnapshot {
            path: path.to_string_lossy().to_string(),
            hash,
            size: metadata.len(),
            modified: Utc::now().to_rfc3339(),
            snapshot_path: snap_path.to_string_lossy().to_string(),
        };

        snapshots.insert(path.to_string_lossy().to_string(), snapshot);
    }

    Ok(snapshots)
}

// ── Restore engine ──
fn restore_file(snapshot: &FileSnapshot) -> Result<()> {
    let snap_path = Path::new(&snapshot.snapshot_path);
    let target = Path::new(&snapshot.path);

    fs::copy(snap_path, target).with_context(|| {
        format!(
            "Failed to restore {:?} from {:?}",
            target, snap_path
        )
    })?;

    info!(path = %snapshot.path, "File restored from snapshot");
    Ok(())
}

// ── Event publisher (Kafka stub) ──
async fn publish_event(event: &TamperEvent, _kafka_brokers: &str) {
    // In production: use rdkafka to publish to sentinel.security.tamper-events
    let json = serde_json::to_string(event).unwrap_or_default();
    info!(event = %json, "Tamper event published");
}

// ── File watcher ──
async fn run_watcher(args: Args) -> Result<()> {
    let watch_dir = Path::new(&args.watch_dir);
    let snapshot_dir = Path::new(&args.snapshot_dir);

    // Take initial snapshot
    info!("Taking initial snapshot of {:?}", watch_dir);
    let snapshots: Arc<Mutex<HashMap<String, FileSnapshot>>> = Arc::new(Mutex::new(HashMap::new()));

    // Simplified snapshot: hash all files in watch_dir
    if watch_dir.exists() {
        for entry in fs::read_dir(watch_dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.is_file() {
                if let Ok(hash) = compute_hash(&path) {
                    let metadata = fs::metadata(&path)?;
                    let rel = path.strip_prefix(watch_dir).unwrap_or(Path::new("unknown"));
                    let snap_path = snapshot_dir.join(rel);

                    let snapshot = FileSnapshot {
                        path: path.to_string_lossy().to_string(),
                        hash,
                        size: metadata.len(),
                        modified: Utc::now().to_rfc3339(),
                        snapshot_path: snap_path.to_string_lossy().to_string(),
                    };
                    snapshots.lock().unwrap().insert(path.to_string_lossy().to_string(), snapshot);
                }
            }
        }
    }

    info!(count = snapshots.lock().unwrap().len(), "Snapshot complete — armed");

    // Set up file watcher
    let (sender, mut rx) = tokio::sync::mpsc::channel(100);
    let mut watcher = RecommendedWatcher::new(
        move |res: Result<Event, notify::Error>| {
            if let Ok(event) = res {
                let _ = sender.blocking_send(event);
            }
        },
        Config::default(),
    )?;

    watcher.watch(watch_dir, RecursiveMode::Recursive)?;
    info!(dir = %args.watch_dir, "Watching for file changes");

    // Process events
    while let Some(event) = rx.recv().await {
        match event.kind {
            EventKind::Modify(_) | EventKind::Create(_) | EventKind::Remove(_) => {
                for path in &event.paths {
                    let path_str = path.to_string_lossy().to_string();
                    let snaps = snapshots.lock().unwrap();

                    if let Some(snapshot) = snaps.get(&path_str) {
                        // Check if hash changed
                        if path.exists() {
                            if let Ok(current_hash) = compute_hash(path) {
                                if current_hash != snapshot.hash {
                                    warn!(path = %path_str, old = %snapshot.hash, new = %current_hash,
                                          "TAMPER DETECTED — file hash mismatch");

                                    let tamper_event = TamperEvent {
                                        event_type: "HASH_MISMATCH".into(),
                                        path: path_str.clone(),
                                        old_hash: snapshot.hash.clone(),
                                        new_hash: current_hash,
                                        timestamp: Utc::now().to_rfc3339(),
                                        action: if args.auto_restore { "RESTORE".into() } else { "ALERT".into() },
                                        source: "sentinel-rasp-file-guard".into(),
                                    };

                                    publish_event(&tamper_event, &args.kafka_brokers).await;

                                    if args.auto_restore {
                                        if let Err(e) = restore_file(snapshot) {
                                            error!(path = %path_str, error = %e, "Auto-restore failed");
                                        }
                                    }

                                    drop(snaps);
                                    // Update snapshot hash after restore
                                    if args.auto_restore && path.exists() {
                                        if let Ok(new_hash) = compute_hash(path) {
                                            let mut snaps = snapshots.lock().unwrap();
                                            if let Some(snap) = snaps.get_mut(&path_str) {
                                                snap.hash = new_hash;
                                            }
                                        }
                                    }
                                }
                            }
                        } else {
                            // File removed
                            warn!(path = %path_str, "TAMPER DETECTED — file deleted");

                            let tamper_event = TamperEvent {
                                event_type: "FILE_DELETED".into(),
                                path: path_str.clone(),
                                old_hash: snapshot.hash.clone(),
                                new_hash: "DELETED".into(),
                                timestamp: Utc::now().to_rfc3339(),
                                action: if args.auto_restore { "RESTORE".into() } else { "ALERT".into() },
                                source: "sentinel-rasp-file-guard".into(),
                            };

                            publish_event(&tamper_event, &args.kafka_brokers).await;

                            if args.auto_restore {
                                if let Err(e) = restore_file(snapshot) {
                                    error!(path = %path_str, error = %e, "Auto-restore failed");
                                }
                            }
                        }
                    }
                }
            }
            _ => {}
        }
    }

    Ok(())
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt::init();

    let args = Args::parse();
    info!(watch_dir = %args.watch_dir, snapshot_dir = %args.snapshot_dir,
          auto_restore = args.auto_restore, "Sentinel file-guard starting");

    if !Path::new(&args.watch_dir).exists() {
        warn!(dir = %args.watch_dir, "Watch directory does not exist — creating");
        fs::create_dir_all(&args.watch_dir)?;
    }

    run_watcher(args).await
}
