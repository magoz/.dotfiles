local wezterm = require("wezterm")

local config = wezterm.config_builder()
config.exit_behavior = "Hold" -- prevents closing the pane

config.font = wezterm.font("MesloLGS Nerd Font Mono")
config.font_size = 12
config.enable_tab_bar = false
config.window_decorations = "RESIZE"

-- Fix €, £, and other composed key combinations not working
config.send_composed_key_when_left_alt_is_pressed = true
config.send_composed_key_when_right_alt_is_pressed = true

-- Keybindings
-- See: https://wezfurlong.org/wezterm/config/default-keys.html
config.keys = {
	-- Remove fullscreen keybinding
	{
		key = "Enter",
		mods = "ALT",
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

config.debug_key_events = true

wezterm.on("window-config-reloaded", function(window, pane)
	wezterm.log_info("Configuration reloaded!")
end)

wezterm.on("format-window-title", function(tab, pane, tabs, panes, config)
	wezterm.log_info("Window title formatting")
	return "WezTerm"
end)

return config
