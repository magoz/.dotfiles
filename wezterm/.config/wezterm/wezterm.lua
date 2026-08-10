local wezterm = require("wezterm")

local config = wezterm.config_builder()
config.exit_behavior = "Hold" -- prevents closing the pane

config.font = wezterm.font("MesloLGS Nerd Font Mono")
config.font_size = 12
config.enable_tab_bar = false
config.window_decorations = "RESIZE"

-- Force global CSI-u (fixterms) key encoding so modified keys like
-- Shift+Enter and Ctrl+Shift+<key> are distinguishable (legacy encoding sends
-- Shift+Enter as plain Enter).
--
-- KEPT FOR TMUX: tmux does not request the kitty keyboard protocol from the
-- outer terminal, so enable_kitty_keyboard below does not cover it. tmux's
-- extended-keys setup (tmux.conf: extended-keys on, extended-keys-format
-- csi-u, terminal-features 'xterm*:extkeys') assumes the outer terminal
-- speaks CSI-u — this flag is what makes that assumption true. Remove both
-- halves together if tmux is ever retired.
--
-- Apps that request kitty protocol themselves (herdr, nvim, etc.) are
-- unaffected: kitty requests take precedence over this global fallback.
config.enable_csi_u_key_encoding = true

-- NOTE: enable_kitty_keyboard was tried (for native cmd+1..9 to herdr) but
-- removed: herdr never requests the kitty protocol, and honoring requests
-- from pi's TUI broke Esc-to-cancel (Esc arrives kitty-encoded instead of
-- raw 0x1b). Cmd+1..9 works via the SendKey alt remap below instead.

-- Fix €, £, and other composed key combinations with alt not working
config.send_composed_key_when_left_alt_is_pressed = true
config.send_composed_key_when_right_alt_is_pressed = true

-- config.debug_key_events = true

-- Keybindings
-- See: https://wezfurlong.org/wezterm/config/default-keys.html
config.keys = {
	-- Remove fullscreen keybinding
	{
		key = "Enter",
		mods = "ALT",
		action = wezterm.action.DisableDefaultAssignment,
	},
	-- Disable command palette
	{
		key = "p",
		mods = "CTRL|SHIFT",
		action = wezterm.action.DisableDefaultAssignment,
	},
	-- Disable Hide
	{
		key = "m",
		mods = "CMD",
		action = wezterm.action.DisableDefaultAssignment,
	},
	-- Disable creating tabs
	{
		key = "t",
		mods = "CMD",
		action = wezterm.action.DisableDefaultAssignment,
	},
	{
		key = "t",
		mods = "CTRL|SHIFT",
		action = wezterm.action.DisableDefaultAssignment,
	},
	{
		key = "T",
		mods = "CMD|SHIFT",
		action = wezterm.action.DisableDefaultAssignment,
	},
	-- CMD+1..9 → send Alt+1..9 to the pane. herdr maps alt+1..9 to agent-panel
	-- rows (keys.indexed.agents = "alt"), so with priority sort Cmd+1 jumps to
	-- the top-priority agent. Remap needed because herdr doesn't request the
	-- kitty keyboard protocol, so cmd/super can't be transmitted natively.
	{ key = "1", mods = "CMD", action = wezterm.action.SendKey({ key = "1", mods = "ALT" }) },
	{ key = "2", mods = "CMD", action = wezterm.action.SendKey({ key = "2", mods = "ALT" }) },
	{ key = "3", mods = "CMD", action = wezterm.action.SendKey({ key = "3", mods = "ALT" }) },
	{ key = "4", mods = "CMD", action = wezterm.action.SendKey({ key = "4", mods = "ALT" }) },
	{ key = "5", mods = "CMD", action = wezterm.action.SendKey({ key = "5", mods = "ALT" }) },
	{ key = "6", mods = "CMD", action = wezterm.action.SendKey({ key = "6", mods = "ALT" }) },
	{ key = "7", mods = "CMD", action = wezterm.action.SendKey({ key = "7", mods = "ALT" }) },
	{ key = "8", mods = "CMD", action = wezterm.action.SendKey({ key = "8", mods = "ALT" }) },
	{ key = "9", mods = "CMD", action = wezterm.action.SendKey({ key = "9", mods = "ALT" }) },
	-- Disable split pane vertically
	{ key = '"', mods = "CMD", action = wezterm.action.DisableDefaultAssignment },
	-- Disable split pane horizontally
	{ key = "%", mods = "CMD", action = wezterm.action.DisableDefaultAssignment },
	-- Disable split pane horizontally
	{ key = "%", mods = "CMD", action = wezterm.action.DisableDefaultAssignment },
}

config.window_padding = {
	left = 50,
	right = 50,
	top = 30,
	bottom = 20,
}

-- config.window_background_opacity = 0.8
-- config.macos_window_background_blur = 10

config.colors = {
	foreground = "#c7c7c7",
	background = "#000000",
	-- background = "#23283D", -- Match Tokyonight bg
	cursor_bg = "#d930e6",
	cursor_border = "#d930e6",
	cursor_fg = "#000000",
	selection_bg = "#033259",
	selection_fg = "#CBE0F0",
	ansi = { "#214969", "#f5480f", "#44FFB1", "#FFE073", "#019CE6", "#d930e6", "#24EAF7", "#ffffff" },
	brights = { "#214969", "#fc4503", "#44FFB1", "#FFE073", "#b93ec1", "#d930e6", "#d930e6", "#ffffff" },
}

wezterm.on("window-config-reloaded", function(window, pane)
	wezterm.log_info("Configuration reloaded!")
end)

wezterm.on("format-window-title", function(tab, pane, tabs, panes, config)
	wezterm.log_info("Window title formatting")
	return "WezTerm"
end)

return config
