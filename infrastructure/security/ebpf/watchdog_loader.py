#!/usr/bin/env python3
# ──────────────────────────────────────────────────────────────
# sentinel-os/infrastructure/security/ebpf/watchdog_loader.py
# Userspace loader for sentinel-watchdog eBPF program
# Reads events from ring buffer and publishes to Kafka
# ──────────────────────────────────────────────────────────────

"""
Loads the sentinel-watchdog.bpf.o eBPF program and consumes
events from the ring buffer. Publishes anomaly events to
Kafka topic sentinel.security.kernel-events.

Requirements:
  pip install bcc bpfcc  (or bpftool + libbpf)
"""

import json
import os
import sys
import signal
import struct
from datetime import datetime, timezone

# ── Optional eBPF loader ──
try:
    from bcc import BPF
    BCC_AVAILABLE = True
except ImportError:
    BCC_AVAILABLE = False

# ── Optional Kafka ──
try:
    from aiokafka import AIOKafkaProducer
    import asyncio
    KAFKA_AVAILABLE = True
except ImportError:
    KAFKA_AVAILABLE = False

KAFKA_TOPIC = "sentinel.security.kernel-events"
KAFKA_BROKER = os.getenv("KAFKA_BROKERS", "localhost:9092")

EVT_PROCESS_EXEC = 1
EVT_SENSITIVE_WRITE = 2
EVT_SYSCALL_ANOMALY = 3
EVT_BIND_SHELL = 4

EVT_NAMES = {
    EVT_PROCESS_EXEC: "PROCESS_EXEC",
    EVT_SENSITIVE_WRITE: "SENSITIVE_WRITE",
    EVT_SYSCALL_ANOMALY: "SYSCALL_ANOMALY",
    EVT_BIND_SHELL: "BIND_SHELL",
}


def format_event(event_type, pid, uid, gid, comm, path, timestamp, retval):
    """Format an eBPF event into a structured dict."""
    return {
        "eventType": EVT_NAMES.get(event_type, f"UNKNOWN_{event_type}"),
        "pid": pid,
        "uid": uid,
        "gid": gid,
        "comm": comm,
        "path": path,
        "timestamp": datetime.fromtimestamp(timestamp / 1e9, tz=timezone.utc).isoformat(),
        "retval": retval,
        "source": "sentinel-watchdog-ebpf",
    }


def handle_event(cpu, data, size):
    """Callback for eBPF ring buffer events."""
    if not BCC_AVAILABLE:
        return

    # Parse the C struct (must match sentinel-watchdog.bpf.c)
    # struct event { u32 event_type; u32 pid; u32 uid; u32 gid;
    #   char comm[64]; char path[256]; u64 timestamp; u32 retval; }
    fmt = "IIII64s256sQI"
    expected_size = struct.calcsize(fmt)
    if size < expected_size:
        return

    event_type, pid, uid, gid, comm_raw, path_raw, timestamp, retval = struct.unpack_from(fmt, data)

    comm = comm_raw.split(b'\x00')[0].decode('utf-8', errors='replace')
    path = path_raw.split(b'\x00')[0].decode('utf-8', errors='replace')

    event = format_event(event_type, pid, uid, gid, comm, path, timestamp, retval)
    print(json.dumps(event), flush=True)

    # TODO: publish to Kafka when available


def run_with_bcc():
    """Run watchdog using BCC (Python eBPF loader)."""
    bpf_source = """
    #include <uapi/linux/ptrace.h>
    #include <linux/sched.h>

    struct event {
        u32 event_type;
        u32 pid;
        u32 uid;
        u32 gid;
        char comm[64];
        char path[256];
        u64 timestamp;
        u32 retval;
    };

    BPF_PERF_OUTPUT(events);

    int trace_exec(struct pt_regs *ctx,
                   struct linux_binprm *bprm) {
        struct event e = {};
        u32 pid = bpf_get_current_pid_tgid() >> 32;
        e.event_type = 1;
        e.pid = pid;
        e.uid = bpf_get_current_uid_gid() & 0xFFFFFFFF;
        e.gid = bpf_get_current_uid_gid() >> 32;
        e.timestamp = bpf_ktime_get_ns();
        bpf_get_current_comm(&e.comm, sizeof(e.comm));
        bpf_probe_read_kernel_str(&e.path, sizeof(e.path), bprm->filename);
        events.perf_submit(ctx, &e, sizeof(e));
        return 0;
    }
    """

    b = BPF(text=bpf_source)
    b.attach_kprobe(event="do_execve", fn_name="trace_exec")

    print("[watchdog] eBPF watchdog armed — monitoring process execution", file=sys.stderr)
    b["events"].open_perf_buffer(handle_event)

    running = True
    def shutdown(sig, frame):
        nonlocal running
        running = False
    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    while running:
        b.perf_buffer_poll(timeout=1000)

    print("[watchdog] eBPF watchdog stopped", file=sys.stderr)


def run_simulation():
    """Simulate watchdog events for testing without eBPF."""
    print("[watchdog] Running in simulation mode (no eBPF/BCC)", file=sys.stderr)

    sample_events = [
        format_event(EVT_PROCESS_EXEC, 1234, 0, 0, "sentinel-ai", "/opt/sentinel/ai-service", 1e9 * 1700000000, 0),
        format_event(EVT_SENSITIVE_WRITE, 5678, 1000, 1000, "unknown-proc", "/etc/sentinel/config.yaml", 1e9 * 1700000010, 3),
        format_event(EVT_BIND_SHELL, 9012, 1000, 1000, "reverse-shell", "", 1e9 * 1700000020, 4444),
    ]

    for event in sample_events:
        print(json.dumps(event), flush=True)

    print("[watchdog] Simulation complete — 3 sample events emitted", file=sys.stderr)


def main():
    if BCC_AVAILABLE and os.getuid() == 0:
        run_with_bcc()
    else:
        if os.getuid() != 0:
            print("[watchdog] WARNING: Not running as root — eBPF requires CAP_BPF", file=sys.stderr)
        run_simulation()


if __name__ == "__main__":
    main()
