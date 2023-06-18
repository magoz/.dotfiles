local wk = require("which-key")

local status_ok, telescope = pcall(require, "telescope")
if not status_ok then
	return
end

local actions = require("telescope.actions")

telescope.setup({
	defaults = {

		prompt_prefix = " ",
		selection_caret = " ",
		path_display = { "smart" },

		file_ignore_patterns = {
			".DS_Store",
			".git/",

			-- TS
			".next/",
			"%.lock",
			"node_modules/",
			"%.tsbuildinfo",
			"npm-debug.log",
			"yarn-debug.log",
			"yarn-error.log",

			-- Media
			"%.jpg",
			"%.jpgeg",
			"%.png",
			"%.gif",
			"%.webp",
			"%.mp4",
			"%.svg",
			"%.pdf",

			-- Fonts
			"%.woff",
			"%.woff2",
			"%.otf",
			"%.ttf",
		},

		mappings = {
			i = {
				["<Down>"] = actions.cycle_history_next,
				["<Up>"] = actions.cycle_history_prev,
				["<C-j>"] = actions.move_selection_next,
				["<C-k>"] = actions.move_selection_previous,
			},

			n = {
				["q"] = actions.close,
			},
		},
		-- vimgrep_arguments = {
		-- 	"rg",
		-- 	"--color=never",
		-- 	"--no-heading",
		-- 	"--with-filename",
		-- 	"--line-number",
		-- 	"--column",
		-- 	"--smart-case",
		-- 	"-uu", -- search hidden files
		-- },
	},
	pickers = {
		live_grep = {
			additional_args = function()
				return { "--hidden" }
			end,
		},
	}, -- search inside of hidden files/folders
})

-- To get fzf loaded and working with telescope, you need to call
-- load_extension, somewhere after setup function:
telescope.load_extension("fzf")

-- ---------------------------------
-- ----------- REMAPS --------------
-- ---------------------------------
wk.register({
	f = {
		name = "Telescope", -- group name
		f = { ":Telescope find_files<CR>", "Search files" },
		h = { ":Telescope find_files hidden=true<CR>", "Search hidden files" },
		i = { ":Telescope find_files no_ignore=true<CR>", "Search git ignored files" },

		c = { ":Telescope live_grep<CR>", "Search files contents" },

		b = { ":Telescope buffers<CR>", "Search Buffers" },
		p = { ":Telescope projects<CR>", "Search Projects" },
	},
}, { prefix = "<leader>" })
