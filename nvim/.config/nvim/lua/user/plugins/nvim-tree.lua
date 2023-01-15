local status_ok, nvim_tree = pcall(require, "nvim-tree")
if not status_ok then
	return
end

local config_status_ok, nvim_tree_config = pcall(require, "nvim-tree.config")
if not config_status_ok then
	return
end

local tree_cb = nvim_tree_config.nvim_tree_callback

-- Float window ratio
local HEIGHT_RATIO = 0.8
local WIDTH_RATIO = 0.8

nvim_tree.setup({
	actions = {
		open_file = {
			quit_on_open = true,
		},
	},
	filters = {
		dotfiles = false, -- display dotfiles by default. Can be toggled with H
		custom = { -- always hide these files
			".DS_Store",
		},
		exclude = { -- always show these files
			".env",
			".env.local",
		},
	},
	git = {
		ignore = false, -- show listed files in .gitignore by default. Can be toggled with I
	},
	update_focused_file = {
		enable = true,
		update_cwd = true,
	},
	renderer = {
		root_folder_modifier = ":t",
		icons = {
			glyphs = {
				default = "",
				symlink = "",
				folder = {
					arrow_open = "",
					arrow_closed = "",
					default = "",
					open = "",
					empty = "",
					empty_open = "",
					symlink = "",
					symlink_open = "",
				},
				git = {
					unstaged = "",
					staged = "S",
					unmerged = "",
					renamed = "➜",
					untracked = "U",
					deleted = "",
					ignored = "◌",
				},
			},
		},
	},
	diagnostics = {
		enable = true,
		show_on_dirs = true,
		icons = {
			hint = "",
			info = "",
			warning = "",
			error = "",
		},
	},
	view = {
		float = {
			enable = true,
			open_win_config = function()
				local screen_w = vim.opt.columns:get()
				local screen_h = vim.opt.lines:get() - vim.opt.cmdheight:get()
				local window_w = screen_w * WIDTH_RATIO
				local window_h = screen_h * HEIGHT_RATIO
				local window_w_int = math.floor(window_w)
				local window_h_int = math.floor(window_h)
				local center_x = (screen_w - window_w) / 2
				local center_y = ((vim.opt.lines:get() - window_h) / 2) - vim.opt.cmdheight:get()
				return {
					border = "rounded",
					relative = "editor",
					row = center_y,
					col = center_x,
					width = window_w_int,
					height = window_h_int,
				}
			end,
		},
		width = function()
			return math.floor(vim.opt.columns:get() * WIDTH_RATIO)
		end,
		mappings = {
			list = {
				{ key = { "l", "<CR>", "o" }, cb = tree_cb("edit") },
				{ key = "h", cb = tree_cb("close_node") },
				{ key = "v", cb = tree_cb("vsplit") },
			},
		},
	},
})

-- Automatically open file on creation
-- https://github.com/nvim-tree/nvim-tree.lua/issues/1120
local api_status_ok, api = pcall(require, "nvim-tree.api")
if not api_status_ok then
	return
end

api.events.subscribe(api.events.Event.FileCreated, function(file)
	vim.cmd("edit " .. file.fname)
end)

-- ---------------------------------
-- ----------- REMAPS --------------
-- ---------------------------------
local wk_status_ok, wk = pcall(require, "which-key")
if not wk_status_ok then
	return
end

wk.register({
	e = { ":NvimTreeToggle<CR>", "Toggle nvim tree" },
}, { prefix = "<leader>" })
