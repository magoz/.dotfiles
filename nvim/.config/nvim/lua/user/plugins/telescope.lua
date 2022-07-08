local wk = require("which-key")

local status_ok, telescope = pcall(require, "telescope")
if not status_ok then
	return
end

local actions = require("telescope.actions")

telescope.setup({
	defaults = {

		prompt_prefix = " ",
		selection_caret = " ",
		path_display = { "smart" },
		file_ignore_patterns = { ".git/", "node_modules" },

		mappings = {
			i = {
				["<Down>"] = actions.cycle_history_next,
				["<Up>"] = actions.cycle_history_prev,
				["<C-j>"] = actions.move_selection_next,
				["<C-k>"] = actions.move_selection_previous,
			},
		},

		vimgrep_arguments = {
			"rg",
			"--color=never",
			"--no-heading",
			"--with-filename",
			"--line-number",
			"--column",
			"--smart-case",
			"-uu", -- search hidden files
		},
	},
})

-- ---------------------------------
-- ----------- REMAPS --------------
-- ---------------------------------
wk.register({
	f = {
		name = "Telescope", -- group name
		f = { ":Telescope find_files hidden=true <CR>", "Search files" },
		t = { ":Telescope live_grep<CR>", "Search inside files" },
		b = { ":Telescope buffers<CR>", "Search Buffers" },
		p = { ":Telescope projects<CR>", "Search Projects" },
	},
}, { prefix = "<leader>" })

-- -- keymap("n", "<leader>ff", "<cmd>lua require'telescope.builtin'.find_files()<cr>", opts)
-- keymap("n", "<leader>ff", ":Telescope find_files hidden=true <CR>", opts)
-- keymap("n", "<leader>fp", ":Telescope projects<CR>", opts)
-- keymap("n", "<leader>fb", ":Telescope buffers<CR>", opts)
-- keymap("n", "<leader>ft", ":Telescope live_grep<CR>", opts)
