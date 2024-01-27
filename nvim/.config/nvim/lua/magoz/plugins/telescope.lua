return {
	"nvim-telescope/telescope.nvim",
	dependencies = {
		"nvim-lua/plenary.nvim",
		{ "nvim-telescope/telescope-fzf-native.nvim", build = "make" },
		"nvim-telescope/telescope-ui-select.nvim",
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
					-- -- Media
					-- "%.jpg",
					-- "%.jpgeg",
					-- "%.png",
					-- "%.gif",
					-- "%.webp",
					-- "%.mp4",
					-- "%.svg",
					-- "%.pdf",

					-- -- Fonts
					-- "%.woff",
					-- "%.woff2",
					-- "%.otf",
					-- "%.ttf",
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
			},
			extensions = {
				["ui-select"] = {
					require("telescope.themes").get_dropdown({}),
				},
			},
		})

		-- Extensions
		telescope.load_extension("fzf")
		telescope.load_extension("ui-select")

		require("which-key").register({ ["<leader>f"] = { name = "Telescope" } })

		vim.keymap.set("n", "<leader>ff", "<cmd>Telescope find_files<cr>", { desc = "Search Files" })
		vim.keymap.set("n", "<leader>fg", "<cmd>Telescope git_files<cr>", { desc = "Search Git Files" })
		vim.keymap.set("n", "<leader>fh", "<cmd>Telescope find_files hidden=true<cr>", { desc = "Search Hidden Files" })
		vim.keymap.set(
			"n",
			"<leader>fi",
			"<cmd>Telescope find_files no_ignore=true hidden=true<cr>",
			{ desc = "Search git including hidden or ignored Files" }
		)
		vim.keymap.set("n", "<leader>fc", "<cmd>Telescope live_grep<cr>", { desc = "Searh file contents" })
		vim.keymap.set("n", "<leader>fb", "<cmd>Telescope buffers<cr>", { desc = "Searh Buffers" })
		vim.keymap.set("n", "<leader>fq", "<cmd>Telescope quickfix<cr>", { desc = "Searh Quick Fix List" })
		vim.keymap.set("n", "<leader>fp", "<cmd>Telescope projects<cr>", { desc = "Searh Projects" })
		vim.keymap.set("n", "<leader>fr", "<cmd>Telescope oldfiles<cr>", { desc = "Searh Recent Files" })
		vim.keymap.set("n", "<leader>fs", "<cmd>Telescope grep_string<cr>", { desc = "Search string under cursor" })
		vim.keymap.set("n", "<leader>as", function()
			require("telescope.builtin").spell_suggest(require("telescope.themes").get_cursor({}))
		end, { desc = "Spelling Suggestions" })

		-- vim.keymap.set("n", "<leader>fr", "<cmd>Telescope oldfiles<cr>", { desc = "Fuzzy find recent files" })
		-- vim.keymap.set(
		-- 	"n",
		-- 	"<leader>fc",
		-- 	"<cmd>Telescope grep_string<cr>",
		-- 	{ desc = "Find string under cursor in cwd" }
		-- )
	end,
}
