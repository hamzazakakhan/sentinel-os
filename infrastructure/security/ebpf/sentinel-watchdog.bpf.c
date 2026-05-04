// ──────────────────────────────────────────────────────────────
// sentinel-os/infrastructure/security/ebpf/sentinel-watchdog.bpf.c
// eBPF kernel watchdog — monitors process exec, file writes, syscall anomalies
// Attaches to tracepoints: sched_process_exec, syscalls/sys_enter_write
// ──────────────────────────────────────────────────────────────

#include <vmlinux.h>
#include <bpf/bpf_helpers.h>
#include <bpf/bpf_tracing.h>
#include <bpf/bpf_core_read.h>

#define MAX_COMM_LEN 64
#define MAX_PATH_LEN 256
#define MAX_ARGS_LEN 128
#define MAX_EVENTS 4096

// ── Event types ──
#define EVT_PROCESS_EXEC    1
#define EVT_SENSITIVE_WRITE 2
#define EVT_SYSCALL_ANOMALY 3
#define EVT_BIND_SHELL      4

struct event {
    u32 event_type;
    u32 pid;
    u32 uid;
    u32 gid;
    char comm[MAX_COMM_LEN];
    char path[MAX_PATH_LEN];
    u64 timestamp;
    u32 retval;
};

// ── Ring buffer for events → userspace ──
struct {
    __uint(type, BPF_MAP_TYPE_RINGBUF);
    __uint(max_entries, 1 << 20);  // 1 MB
} events SEC(".maps");

// ── Config map (populated from userspace) ──
struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 64);
    __type(key, u32);
    __type(value, u32);
} config SEC(".maps");

// ── Watched paths map ──
struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 256);
    __type(key, char[MAX_PATH_LEN]);
    __type(value, u8);  // 1 = watched
} watched_paths SEC(".maps");

// ── Process exec tracepoint ──
SEC("tracepoint/sched/sched_process_exec")
int trace_process_exec(struct trace_event_raw_sched_process_exec *ctx)
{
    struct event *e;
    e = bpf_ringbuf_reserve(&events, sizeof(*e), 0);
    if (!e)
        return 0;

    __builtin_memset(e, 0, sizeof(*e));
    e->event_type = EVT_PROCESS_EXEC;
    e->pid = bpf_get_current_pid_tgid() >> 32;
    e->uid = bpf_get_current_uid_gid() & 0xFFFFFFFF;
    e->gid = bpf_get_current_uid_gid() >> 32;
    e->timestamp = bpf_ktime_get_ns();
    bpf_get_current_comm(&e->comm, sizeof(e->comm));

    // Get filename from ctx
    const char *filename = BPF_CORE_READ(ctx, filename);
    bpf_probe_read_kernel_str(&e->path, sizeof(e->path), filename);

    bpf_ringbuf_submit(e, 0);
    return 0;
}

// ── Sensitive file write detection ──
SEC("tracepoint/syscalls/sys_enter_write")
int trace_write(struct trace_event_raw_sys_enter *ctx)
{
    struct event *e;
    char path[MAX_PATH_LEN] = {};

    // Only monitor writes to watched paths
    // In production, resolve fd → path via task_struct/fdtable
    // Simplified: check if pid is in our watch list
    u32 pid = bpf_get_current_pid_tgid() >> 32;

    // Check watched paths for critical Sentinel files
    static const char sentinel_config[] = "/etc/sentinel/";
    static const char sentinel_bin[] = "/opt/sentinel/";

    // Get file path from fd (simplified — real impl needs dentry lookup)
    // For now, flag any write by sentinel-uid processes
    u32 uid = bpf_get_current_uid_gid() & 0xFFFFFFFF;

    u32 *watch_uid = bpf_map_lookup_elem(&config, &(u32){0});
    if (watch_uid && *watch_uid != uid) {
        // Not a sentinel-uid process — skip
        return 0;
    }

    e = bpf_ringbuf_reserve(&events, sizeof(*e), 0);
    if (!e)
        return 0;

    __builtin_memset(e, 0, sizeof(*e));
    e->event_type = EVT_SENSITIVE_WRITE;
    e->pid = pid;
    e->uid = uid;
    e->timestamp = bpf_ktime_get_ns();
    bpf_get_current_comm(&e->comm, sizeof(e->comm));

    // Read fd argument
    e->retval = ctx->args[0];  // fd

    bpf_ringbuf_submit(e, 0);
    return 0;
}

// ── Bind shell detection (network socket on suspicious port) ──
SEC("tracepoint/syscalls/sys_enter_bind")
int trace_bind(struct trace_event_raw_sys_enter *ctx)
{
    struct event *e;
    // In production: parse sockaddr from args[1] to get port
    // Flag binds to ports < 1024 by non-root, or known reverse-shell ports

    u32 uid = bpf_get_current_uid_gid() & 0xFFFFFFFF;
    if (uid == 0)
        return 0;  // root binds are normal for services

    e = bpf_ringbuf_reserve(&events, sizeof(*e), 0);
    if (!e)
        return 0;

    __builtin_memset(e, 0, sizeof(*e));
    e->event_type = EVT_BIND_SHELL;
    e->pid = bpf_get_current_pid_tgid() >> 32;
    e->uid = uid;
    e->timestamp = bpf_ktime_get_ns();
    bpf_get_current_comm(&e->comm, sizeof(e->comm));

    bpf_ringbuf_submit(e, 0);
    return 0;
}

char LICENSE[] SEC("license") = "GPL";
