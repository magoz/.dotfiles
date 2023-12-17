return {
	"nvim-telescope/telescope.nvim",
	dependencies = {
		"nvim-lua/plenary.nvim",
		{ "nvim-telescope/telescope-fzf-native.nvim", build = "make" },
	},
	config = function()
		local telescope = require("telescope")
		local actions = require("telescope.actions")

		telescope.setup({
			defaults = {
				prompt_prefix = " ",
				selection_caret = " ",
				path_display = { truncate = 4 },

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
						["<C-q>"] = actions.send_selected_to_qflist + actions.open_qflist,
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

		require("which-key").register({ ["<leader>f"] = { name = "Telescope" } })

		vim.keymap.set("n", "<leader>ff", "<cmd>Telescope find_files<cr>", { desc = "Search Files" })
		vim.keymap.set("n", "<leader>fh", "<cmd>Telescope find_files hidden=true<cr>", { desc = "Search Hidden Files" })
		vim.keymap.set(
			"n",
			"<leader>fi",
			"<cmd>Telescope find_files no_ignore=true<cr>",
			{ desc = "Search git ignored Files" }
		)
		vim.keymap.set("n", "<leader>fc", "<cmd>Telescope live_grep<cr>", { desc = "Searh file contents" })
		vim.keymap.set("n", "<leader>fb", "<cmd>Telescope buffers<cr>", { desc = "Searh Buffers" })
		vim.keymap.set("n", "<leader>fp", "<cmd>Telescope projects<cr>", { desc = "Searh Projects" })
		vim.keymap.set("n", "<leader>fr", "<cmd>Telescope oldfiles<cr>", { desc = "Searh Recent Files" })
		vim.keymap.set("n", "<leader>fs", "<cmd>Telescope grep_string<cr>", { desc = "Search string under cursor" })

		-- vim.keymap.set("n", "<leader>fr", "<cmd>Telescope oldfiles<cr>", { desc = "Fuzzy find recent files" })
		-- vim.keymap.set(
		-- 	"n",
		-- 	"<leader>fc",
		-- 	"<cmd>Telescope grep_string<cr>",
		-- 	{ desc = "Find string under cursor in cwd" }
		-- )
	end,
}
