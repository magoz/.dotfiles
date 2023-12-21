return {
	{
		"lewis6991/gitsigns.nvim",
		config = function()
			require("gitsigns").setup({})

			-- TODO: not sure where to put these remaps
			require("which-key").register({ ["<leader>g"] = { name = "Git" } })

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
