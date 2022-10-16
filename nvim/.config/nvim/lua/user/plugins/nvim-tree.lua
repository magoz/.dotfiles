local status_ok, nvim_tree = pcall(require, "nvim-tree")
if not status_ok then
	return
end

local config_status_ok, nvim_tree_config = pcall(require, "nvim-tree.config")
if not config_status_ok then
	return
end

local tree_cb = nvim_tree_config.nvim_tree_callback

nvim_tree.setup({
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
		adaptive_size = true,
		side = "left",
		mappings = {
			list = {
				{ key = { "l", "<CR>", "o" }, cb = tree_cb("edit") },
				{ key = "h", cb = tree_cb("close_node") },
				{ key = "v", cb = tree_cb("vsplit") },
			},
		},
	},
})

-- Automatically open file upon creation
-- https://github.com/nvim-tree/nvim-tree.lua/issues/1120
local events_status_ok, nvim_tree_events = pcall(require, "nvim-tree.events")
if not events_status_ok then
	return
end

-- TODO: fix deprecated
-- https://github.com/nvim-tree/nvim-tree.lua/issues/1120
nvim_tree_events.on_file_created(function(file)
	vim.cmd("edit " .. file.fname)
end)

-- ---------------------------------
-- ----------- REMAPS --------------
-- ---------------------------------
local keymap = vim.keymap.set
local opts = { silent = true }

keymap("n", "<leader>e", ":NvimTreeToggle<CR>", opts)
