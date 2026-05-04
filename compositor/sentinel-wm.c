/* ──────────────────────────────────────────────────────────────
 * sentinel-os/compositor/sentinel-wm.c
 * Sentinel-WM: Custom Wayland compositor for Sentinel OS
 *
 * Built on wlroots 0.19 — same base as Sway/Hyprland
 * Full keyboard/pointer/seat handling, workspace switching
 * ────────────────────────────────────────────────────────────── */

#define WLR_USE_UNSTABLE
#include <wlr/backend.h>
#include <wlr/render/allocator.h>
#include <wlr/render/wlr_renderer.h>
#include <wlr/types/wlr_cursor.h>
#include <wlr/types/wlr_compositor.h>
#include <wlr/types/wlr_data_device.h>
#include <wlr/types/wlr_input_device.h>
#include <wlr/types/wlr_keyboard.h>
#include <wlr/types/wlr_keyboard_group.h>
#include <wlr/types/wlr_output.h>
#include <wlr/types/wlr_output_layout.h>
#include <wlr/types/wlr_scene.h>
#include <wlr/types/wlr_seat.h>
#include <wlr/types/wlr_subcompositor.h>
#include <wlr/types/wlr_xcursor_manager.h>
#include <wlr/types/wlr_xdg_shell.h>
#include <wlr/util/log.h>
#include <xkbcommon/xkbcommon.h>

#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/wait.h>
#include <wayland-server-core.h>

#define WORKSPACE_COUNT 6
static const char *workspace_names[WORKSPACE_COUNT] = {
    "INTEL", "CYBER", "COMMS", "SIGINT", "MAP", "TERMINAL"
};

#define MOD_KEY WLR_MODIFIER_ALT
static const struct { uint32_t mod; xkb_keysym_t sym; const char *act; } binds[] = {
    { MOD_KEY, XKB_KEY_1, "ws0" }, { MOD_KEY, XKB_KEY_2, "ws1" },
    { MOD_KEY, XKB_KEY_3, "ws2" }, { MOD_KEY, XKB_KEY_4, "ws3" },
    { MOD_KEY, XKB_KEY_5, "ws4" }, { MOD_KEY, XKB_KEY_6, "ws5" },
    { WLR_MODIFIER_ALT|WLR_MODIFIER_SHIFT, XKB_KEY_Return, "spawn_term" },
    { WLR_MODIFIER_ALT|WLR_MODIFIER_SHIFT, XKB_KEY_q, "kill" },
    { MOD_KEY, XKB_KEY_Tab, "cycle" },
};
#define BINDS_COUNT (sizeof(binds)/sizeof(binds[0]))

struct sentinel_view {
    struct wlr_xdg_surface *xdg;
    struct wlr_scene_tree *tree;
    struct wl_list link;
    int ws; bool mapped;
    struct wl_listener map, unmap, destroy, req_move, req_resize;
};

struct sentinel_kb {
    struct wlr_keyboard_group *grp;
    struct wl_listener key, mods, destroy;
};

struct sentinel_server {
    struct wl_display *disp;
    struct wlr_backend *be;
    struct wlr_renderer *ren;
    struct wlr_allocator *alloc;
    struct wlr_compositor *comp;
    struct wlr_subcompositor *subcomp;
    struct wlr_xdg_shell *xdg_shell;
    struct wlr_seat *seat;
    struct wlr_cursor *cur;
    struct wlr_output_layout *olay;
    struct wlr_scene *scene;
    struct wlr_xcursor_manager *xcursor;
    struct wlr_keyboard_group *kb_grp;
    struct wl_list views;
    int active_ws;
    struct sentinel_view *focused;
    struct wl_listener new_out, new_in, new_xdg;
    struct wl_listener cur_motion, cur_abs, cur_btn, cur_axis, cur_frame;
    struct wl_listener seat_cursor, seat_sel;
};

static struct sentinel_server *g_srv = NULL;

static void spawn(const char *cmd) {
    pid_t p = fork();
    if (p == 0) { if (fork() == 0) { setsid(); execl("/bin/sh","sh","-c",cmd,NULL); _exit(1); } _exit(0); }
    if (p > 0) waitpid(p, NULL, 0);
}

static void ws_visibility(struct sentinel_server *s) {
    struct sentinel_view *v;
    wl_list_for_each(v, &s->views, link)
        wlr_scene_node_set_enabled(&v->tree->node, v->mapped && v->ws == s->active_ws);
    wlr_log(WLR_INFO, "workspace → %s", workspace_names[s->active_ws]);
}

static void focus(struct sentinel_server *s, struct sentinel_view *v) {
    if (!v || !v->mapped) return;
    struct wlr_surface *sf = v->xdg->surface;
    struct wlr_surface *prev = s->seat->keyboard_state.focused_surface;
    if (prev == sf) return;
    if (prev && wlr_surface_is_xdg_surface(prev)) {
        struct wlr_xdg_surface *px = wlr_xdg_surface_from_wlr_surface(prev);
        wlr_xdg_toplevel_set_activated(px->toplevel, false);
    }
    wlr_xdg_toplevel_set_activated(v->xdg->toplevel, true);
    struct wlr_keyboard *kb = wlr_seat_get_keyboard(s->seat);
    if (kb) wlr_seat_keyboard_notify_enter(s->seat, sf, kb->keycodes,
        kb->num_keycodes, &kb->modifiers);
    s->focused = v;
}

static struct sentinel_view *view_at(struct sentinel_server *s, double lx, double ly,
        struct wlr_surface **sf, double *sx, double *sy) {
    struct wlr_scene_node *n = wlr_scene_node_at(&s->scene->tree.node, lx, ly, sx, sy);
    if (!n || n->type != WLR_SCENE_NODE_BUFFER) return NULL;
    struct wlr_scene_buffer *buf = wlr_scene_buffer_from_node(n);
    struct wlr_scene_surface *ss = wlr_scene_surface_try_from_buffer(buf);
    if (!ss) return NULL;
    *sf = ss->surface;
    struct wlr_scene_tree *t = n->parent;
    while (t && !t->node.data) t = t->node.parent;
    if (!t) return NULL;
    struct sentinel_view *v = t->node.data;
    return (v->mapped && v->ws == s->active_ws) ? v : NULL;
}

/* ── View listeners ─────────────────────────────────────────── */
static void v_map(struct wl_listener *l, void *d) {
    struct sentinel_view *v = wl_container_of(l, v, map);
    v->mapped = true;
    wlr_scene_node_set_enabled(&v->tree->node, v->ws == g_srv->active_ws);
    if (v->xdg->toplevel) wlr_xdg_toplevel_set_maximized(v->xdg->toplevel, true);
    focus(g_srv, v);
}
static void v_unmap(struct wl_listener *l, void *d) {
    struct sentinel_view *v = wl_container_of(l, v, unmap);
    v->mapped = false;
    wlr_scene_node_set_enabled(&v->tree->node, false);
    if (g_srv->focused == v) g_srv->focused = NULL;
}
static void v_destroy(struct wl_listener *l, void *d) {
    struct sentinel_view *v = wl_container_of(l, v, destroy);
    wl_list_remove(&v->map.link); wl_list_remove(&v->unmap.link);
    wl_list_remove(&v->destroy.link); wl_list_remove(&v->link);
    if (g_srv->focused == v) g_srv->focused = NULL;
    free(v);
}
static void v_move(struct wl_listener *l, void *d) {}
static void v_resize(struct wl_listener *l, void *d) {}

/* ── XDG surface ─────────────────────────────────────────────── */
static void new_xdg(struct wl_listener *l, void *d) {
    struct sentinel_server *s = wl_container_of(l, s, new_xdg);
    struct wlr_xdg_surface *xdg = d;
    if (xdg->role == WLR_XDG_SURFACE_ROLE_POPUP) return;
    if (xdg->role != WLR_XDG_SURFACE_ROLE_TOPLEVEL) return;
    struct sentinel_view *v = calloc(1, sizeof(*v));
    v->xdg = xdg;
    v->tree = wlr_scene_xdg_surface_create(&s->scene->tree, xdg);
    if (!v->tree) { free(v); return; }
    v->tree->node.data = v;
    v->ws = s->active_ws;
    v->mapped = false;
    v->map.notify = v_map;   wl_signal_add(&xdg->surface->events.map, &v->map);
    v->unmap.notify = v_unmap; wl_signal_add(&xdg->surface->events.unmap, &v->unmap);
    v->destroy.notify = v_destroy; wl_signal_add(&xdg->events.destroy, &v->destroy);
    if (xdg->toplevel) {
        v->req_move.notify = v_move; wl_signal_add(&xdg->toplevel->events.request_move, &v->req_move);
        v->req_resize.notify = v_resize; wl_signal_add(&xdg->toplevel->events.request_resize, &v->req_resize);
    }
    wl_list_insert(&s->views, &v->link);
}

/* ── Keybinding ─────────────────────────────────────────────── */
static bool do_bind(struct sentinel_server *s, xkb_keysym_t sym, uint32_t mod) {
    for (size_t i = 0; i < BINDS_COUNT; i++) {
        if (binds[i].sym != sym || binds[i].mod != mod) continue;
        if (binds[i].act[0] == 'w' && binds[i].act[1] == 's') {
            int ws = binds[i].act[2] - '0';
            if (ws >= 0 && ws < WORKSPACE_COUNT) { s->active_ws = ws; ws_visibility(s); }
            return true;
        }
        if (!strcmp(binds[i].act, "spawn_term")) { spawn("kitty"); return true; }
        if (!strcmp(binds[i].act, "kill")) {
            if (s->focused && s->focused->mapped)
                wlr_xdg_toplevel_send_close(s->focused->xdg->toplevel);
            s->focused = NULL; return true;
        }
        if (!strcmp(binds[i].act, "cycle")) {
            s->active_ws = (s->active_ws + 1) % WORKSPACE_COUNT;
            ws_visibility(s); return true;
        }
        return true;
    }
    return false;
}

/* ── Keyboard ───────────────────────────────────────────────── */
static void kb_mods(struct wl_listener *l, void *d) {
    struct sentinel_kb *kb = wl_container_of(l, kb, mods);
    wlr_keyboard_notify_modifiers(&kb->grp->keyboard,
        kb->grp->keyboard.modifiers.depressed, kb->grp->keyboard.modifiers.latched,
        kb->grp->keyboard.modifiers.locked, kb->grp->keyboard.modifiers.group);
}
static void kb_key(struct wl_listener *l, void *d) {
    struct sentinel_kb *kb = wl_container_of(l, kb, key);
    struct wlr_keyboard_key_event *ev = d;
    struct wlr_keyboard *k = &kb->grp->keyboard;
    if (ev->state == WL_KEYBOARD_KEY_STATE_PRESSED) {
        xkb_keycode_t kc = ev->keycode + 8;
        xkb_keysym_t *syms; int ns = xkb_state_key_get_syms(k->xkb_state, kc, &syms);
        uint32_t mods = wlr_keyboard_get_modifiers(k);
        for (int i = 0; i < ns; i++)
            if (do_bind(g_srv, syms[i], mods)) return;
    }
    wlr_seat_keyboard_notify_key(g_srv->seat, ev->time_msec, ev->keycode, ev->state);
}
static void kb_destroy(struct wl_listener *l, void *d) {
    struct sentinel_kb *kb = wl_container_of(l, kb, destroy);
    wl_list_remove(&kb->key.link); wl_list_remove(&kb->mods.link);
    wl_list_remove(&kb->destroy.link); free(kb);
}

/* ── Input ──────────────────────────────────────────────────── */
static void new_input(struct wl_listener *l, void *d) {
    struct sentinel_server *s = wl_container_of(l, s, new_in);
    struct wlr_input_device *dev = d;
    switch (dev->type) {
    case WLR_INPUT_DEVICE_KEYBOARD: {
        struct wlr_keyboard *kb = wlr_keyboard_from_input_device(dev);
        struct xkb_context *ctx = xkb_context_new(XKB_CONTEXT_NO_FLAGS);
        struct xkb_rule_names rules = { .layout = "us", .options = "caps:escape" };
        struct xkb_keymap *km = xkb_keymap_new_from_names(ctx, &rules, XKB_KEYMAP_COMPILE_NO_FLAGS);
        wlr_keyboard_set_keymap(kb, km); xkb_keymap_unref(km); xkb_context_unref(ctx);
        wlr_keyboard_set_repeat_info(kb, 25, 600);
        wlr_keyboard_group_add_keyboard(s->kb_grp, kb);
        struct sentinel_kb *skb = calloc(1, sizeof(*skb));
        skb->grp = s->kb_grp;
        skb->key.notify = kb_key; wl_signal_add(&kb->events.key, &skb->key);
        skb->mods.notify = kb_mods; wl_signal_add(&kb->events.modifiers, &skb->mods);
        skb->destroy.notify = kb_destroy; wl_signal_add(&dev->events.destroy, &skb->destroy);
        break;
    }
    case WLR_INPUT_DEVICE_POINTER:
        wlr_cursor_attach_input_device(s->cur, dev); break;
    default: break;
    }
    wlr_seat_set_capabilities(s->seat, WL_SEAT_CAPABILITY_KEYBOARD|WL_SEAT_CAPABILITY_POINTER);
}

/* ── Cursor ─────────────────────────────────────────────────── */
static void cur_motion(struct wl_listener *l, void *d) {
    struct sentinel_server *s = wl_container_of(l, s, cur_motion);
    struct wlr_pointer_motion_event *e = d;
    wlr_cursor_move(s->cur, &e->pointer->base, e->delta_x, e->delta_y);
    wlr_seat_pointer_notify_motion(s->seat, e->time_msec, s->cur->x, s->cur->y);
}
static void cur_abs(struct wl_listener *l, void *d) {
    struct sentinel_server *s = wl_container_of(l, s, cur_abs);
    struct wlr_pointer_motion_absolute_event *e = d;
    wlr_cursor_warp_absolute(s->cur, &e->pointer->base, e->x, e->y);
    wlr_seat_pointer_notify_motion(s->seat, e->time_msec, s->cur->x, s->cur->y);
}
static void cur_btn(struct wl_listener *l, void *d) {
    struct sentinel_server *s = wl_container_of(l, s, cur_btn);
    struct wlr_pointer_button_event *e = d;
    if (e->state == WLR_BUTTON_PRESSED) {
        double sx, sy; struct wlr_surface *sf = NULL;
        struct sentinel_view *v = view_at(s, s->cur->x, s->cur->y, &sf, &sx, &sy);
        if (v) focus(s, v);
    }
    wlr_seat_pointer_notify_button(s->seat, e->time_msec, e->button, e->state);
}
static void cur_axis(struct wl_listener *l, void *d) {
    struct sentinel_server *s = wl_container_of(l, s, cur_axis);
    struct wlr_pointer_axis_event *e = d;
    wlr_seat_pointer_notify_axis(s->seat, e->time_msec, e->orientation,
        e->delta, e->delta_discrete, e->source);
}
static void cur_frame(struct wl_listener *l, void *d) {
    struct sentinel_server *s = wl_container_of(l, s, cur_frame);
    wlr_seat_pointer_notify_frame(s->seat);
}
static void seat_cursor(struct wl_listener *l, void *d) {
    struct sentinel_server *s = wl_container_of(l, s, seat_cursor);
    struct wlr_seat_pointer_request_set_cursor_event *e = d;
    if (e->seat_client == s->seat->pointer_state.focused_client)
        wlr_cursor_set_surface(s->cur, e->surface, e->hotspot_x, e->hotspot_y);
}
static void seat_sel(struct wl_listener *l, void *d) {
    struct sentinel_server *s = wl_container_of(l, s, seat_sel);
    struct wlr_seat_request_set_selection_event *e = d;
    wlr_seat_set_selection(s->seat, e->source, e->serial);
}

/* ── Output ─────────────────────────────────────────────────── */
static void new_output(struct wl_listener *l, void *d) {
    struct sentinel_server *s = wl_container_of(l, s, new_out);
    struct wlr_output *o = d;
    wlr_output_init_render(o, s->alloc, s->ren);
    struct wlr_output_state st; wlr_output_state_init(&st);
    wlr_output_state_set_enabled(&st, true);
    struct wlr_output_mode *m = wlr_output_preferred_mode(o);
    if (m) wlr_output_state_set_mode(&st, m);
    wlr_output_commit_state(o, &st); wlr_output_state_finish(&st);
    wlr_output_layout_add_auto(s->olay, o);
}

/* ── Main ───────────────────────────────────────────────────── */
static volatile sig_atomic_t quit = 0;
static void on_sig(int s) { (void)s; quit = 1; }

int main(int argc, char *argv[]) {
    wlr_log_init(WLR_INFO, NULL);
    struct sigaction sa = { .sa_handler = on_sig };
    sigaction(SIGTERM, &sa, NULL); sigaction(SIGINT, &sa, NULL);

    struct sentinel_server s = {0};
    s.active_ws = 0; s.focused = NULL;
    wl_list_init(&s.views);
    g_srv = &s;

    s.disp = wl_display_create();
    s.be = wlr_backend_autocreate(wl_display_get_event_loop(s.disp), &s.disp);
    if (!s.be) { wlr_log(WLR_ERROR, "no backend"); return 1; }

    s.ren = wlr_renderer_autocreate(s.be);
    s.alloc = wlr_allocator_autocreate(s.be, s.ren);
    wlr_renderer_init_wl_display(s.ren, s.disp);

    s.comp = wlr_compositor_create(s.disp, 5, s.ren);
    s.subcomp = wlr_subcompositor_create(s.disp);
    s.scene = wlr_scene_create();
    s.olay = wlr_output_layout_create(s.disp);

    s.new_out.notify = new_output;
    wl_signal_add(&s.be->events.new_output, &s.new_out);

    s.cur = wlr_cursor_create();
    s.xcursor = wlr_xcursor_manager_create(NULL, 24);
    wlr_xcursor_manager_load(s.xcursor, 1);

    s.cur_motion.notify = cur_motion; wl_signal_add(&s.cur->events.motion, &s.cur_motion);
    s.cur_abs.notify = cur_abs; wl_signal_add(&s.cur->events.motion_absolute, &s.cur_abs);
    s.cur_btn.notify = cur_btn; wl_signal_add(&s.cur->events.button, &s.cur_btn);
    s.cur_axis.notify = cur_axis; wl_signal_add(&s.cur->events.axis, &s.cur_axis);
    s.cur_frame.notify = cur_frame; wl_signal_add(&s.cur->events.frame, &s.cur_frame);

    s.kb_grp = wlr_keyboard_group_create();
    s.new_in.notify = new_input; wl_signal_add(&s.be->events.new_input, &s.new_in);

    s.seat = wlr_seat_create(s.disp, "sentinel-seat");
    s.seat_cursor.notify = seat_cursor; wl_signal_add(&s.seat->events.request_set_cursor, &s.seat_cursor);
    s.seat_sel.notify = seat_sel; wl_signal_add(&s.seat->events.request_set_selection, &s.seat_sel);

    s.xdg_shell = wlr_xdg_shell_create(s.disp, 2);
    s.new_xdg.notify = new_xdg; wl_signal_add(&s.xdg_shell->events.new_surface, &s.new_xdg);

    const char *sock = wl_display_add_socket_auto(s.disp);
    if (!sock) { wlr_log(WLR_ERROR, "no socket"); return 1; }
    setenv("WAYLAND_DISPLAY", sock, true);
    wlr_log(WLR_INFO, "WAYLAND_DISPLAY=%s", sock);

    if (!wlr_backend_start(s.be)) { wlr_log(WLR_ERROR, "backend failed"); return 1; }
    wlr_log(WLR_INFO, "Sentinel-WM running — workspace → %s", workspace_names[s.active_ws]);

    wl_display_run(s.disp);

    wl_display_destroy_clients(s.disp);
    wlr_xcursor_manager_destroy(s.xcursor);
    wlr_cursor_destroy(s.cur);
    wlr_keyboard_group_destroy(s.kb_grp);
    wlr_output_layout_destroy(s.olay);
    wlr_scene_destroy(s.scene);
    wl_display_destroy(s.disp);
    return 0;
}
