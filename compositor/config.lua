-- ──────────────────────────────────────────────────────────────
-- sentinel-os/compositor/config.lua
-- Sentinel-WM Window Manager Configuration
-- Workspaces, keybindings, HUD widget scripting
-- ──────────────────────────────────────────────────────────────

-- ── Workspaces ───────────────────────────────────────────────
workspaces = {
    { name = "INTEL",   layout = "fullscreen", icon = "◈" },
    { name = "CYBER",   layout = "tile",       icon = "⬡" },
    { name = "COMMS",   layout = "tile",       icon = "◈" },
    { name = "SIGINT",  layout = "fullscreen", icon = "◈" },
    { name = "MAP",     layout = "fullscreen", icon = "◈" },
    { name = "TERMINAL",layout = "tile",       icon = "◈" },
}

-- ── Keybindings ──────────────────────────────────────────────
keys = {
    -- Workspace switching (Alt+1..6)
    { mod = "Alt", key = "1", action = "workspace 1" },
    { mod = "Alt", key = "2", action = "workspace 2" },
    { mod = "Alt", key = "3", action = "workspace 3" },
    { mod = "Alt", key = "4", action = "workspace 4" },
    { mod = "Alt", key = "5", action = "workspace 5" },
    { mod = "Alt", key = "6", action = "workspace 6" },

    -- Window management
    { mod = "Alt+Shift", key = "Return", action = "spawn kitty" },
    { mod = "Alt+Shift", key = "q",      action = "kill" },
    { mod = "Alt+Shift", key = "c",      action = "kill" },
    { mod = "Alt",        key = "Tab",    action = "next_workspace" },
    { mod = "Alt+Shift",  key = "Tab",   action = "prev_workspace" },

    -- Sentinel OS specific
    { mod = "Alt+Shift", key = "s", action = "spawn /opt/sentinel/shell/sentinel-hud" },
    { mod = "Alt+Shift", key = "m", action = "workspace MAP" },
    { mod = "Alt+Shift", key = "t", action = "workspace TERMINAL" },
    { mod = "Alt+Shift", key = "i", action = "workspace INTEL" },

    -- Volume / Brightness
    { mod = "", key = "XF86AudioRaiseVolume", action = "volume +5" },
    { mod = "", key = "XF86AudioLowerVolume", action = "volume -5" },
    { mod = "", key = "XF86MonBrightnessUp",  action = "brightness +5" },
    { mod = "", key = "XF86MonBrightnessDown", action = "brightness -5" },
}

-- ── Window rules ─────────────────────────────────────────────
rules = {
    -- Tauri HUD goes to INTEL workspace, fullscreen
    { app_id = "com.sentinel-os.hud", workspace = "INTEL", fullscreen = true },

    -- SIGINT waterfall goes to SIGINT workspace
    { app_id = "com.sentinel-os.sigint", workspace = "SIGINT", fullscreen = true },

    -- Tactical map goes to MAP workspace
    { app_id = "com.sentinel-os.map", workspace = "MAP", fullscreen = true },

    -- Terminal goes to TERMINAL workspace
    { app_id = "kitty", workspace = "TERMINAL" },

    -- Firefox/Tor Browser goes to COMMS workspace
    { app_id = "firefox", workspace = "COMMS" },
    { title = "Tor Browser", workspace = "COMMS" },
}

-- ── Visual settings ──────────────────────────────────────────
visual = {
    -- CRT scanline overlay
    scanlines = true,
    scanline_opacity = 0.015,
    scanline_spacing = 3,

    -- Vignette effect
    vignette = true,
    vignette_radius = 0.7,

    -- Color scheme (matches blueprint CSS vars)
    colors = {
        void   = "#000407",
        deep   = "#010912",
        panel  = "#061525",
        crt    = "#00e5ff",
        lime   = "#76ff03",
        ember  = "#ff6f00",
        blood  = "#d50000",
        gold   = "#ffd600",
        text   = "#b2ebf2",
    },

    -- Fonts
    fonts = {
        display = "Bebas Neue",
        mono    = "Space Mono",
        body    = "DM Sans",
    },

    -- Borders
    border_width = 1,
    border_color_focused = "#00e5ff",
    border_color_unfocused = "#0e2a44",
    gap = 1,
}

-- ── Startup commands ─────────────────────────────────────────
startup = {
    "systemctl --user start sentinel-hud.service",
    "systemctl --user start sentinel-sigint.service",
    "kitty --title 'Sentinel Terminal' &",
}

-- ── HUD widgets (rendered by compositor overlay) ─────────────
widgets = {
    {
        name = "clock",
        position = "top-right",
        format = "%H:%M:%S UTC",
        font = "Space Mono",
        size = 11,
        color = "#00e5ff",
    },
    {
        name = "threat_level",
        position = "top-right",
        source = "sentinel.threat_level",
        font = "Space Mono",
        size = 9,
    },
    {
        name = "workspace_label",
        position = "top-left",
        source = "sentinel.workspace_name",
        font = "Bebas Neue",
        size = 22,
        color = "#00e5ff",
    },
}
