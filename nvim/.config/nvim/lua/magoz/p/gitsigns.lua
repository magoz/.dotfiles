return {
	{
		"lewis6991/gitsigns.nvim",
		event = { "BufReadPre", "BufNewFile" },
		opts = {
			signs = {
				add = { hl = "GitSignsAdd", text = "▎", numhl = "GitSignsAddNr", linehl = "GitSignsAddLn" },
				change = {
					hl = "GitSignsChange",
					text = "▎",
					numhl = "GitSignsChangeNr",
					linehl = "GitSignsChangeLn",
				},
				delete = {
					hl = "GitSignsDelete",
					text = "契",
					numhl = "GitSignsDeleteNr",
					linehl = "GitSignsDeleteLn",
				},
				topdelete = {
					hl = "GitSignsDelete",
					text = "契",
					numhl = "GitSignsDeleteNr",
					linehl = "GitSignsDeleteLn",
				},
				changedelete = {
					hl = "GitSignsChange",
					text = "▎",
					numhl = "GitSignsChangeNr",
					linehl = "GitSignsChangeLn",
				},
			},
		},

		-- TODO: not sure where to put these remaps
		config = function()
			require("which-key").register({ ["<leader>g"] = { name = "Git" } })

			vim.keymap.set("n", "<leader>gg", "<cmd>LazyGit<CR>", { desc = "Lazy Git" })
			vim.keymap.set(
				"n",
				"<leader>gd",
				"<cmd>DiffviewFileHistory %<CR>",
				{ desc = "Git File History via Diff View" }
			) -- via DiffView
			vim.keymap.set("n", "<leader>gD", "<cmd>DiffviewClose<CR>", { desc = "Close Diff View" }) -- via DiffView
			vim.keymap.set("n", "<leader>gh", "<cmd>0Gclog<CR>", { desc = "Git file history via Fugitive" }) -- via Fugitive
			vim.keymap.set(
				"n",
				"<leader>gt",
				"<cmd>Telescope git_bcommits<CR>",
				{ desc = "Git preview file history via Telescope" }
			) -- via Telescope
		end,
	},
}
