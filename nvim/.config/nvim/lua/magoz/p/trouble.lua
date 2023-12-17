return {
	"folke/trouble.nvim",
	-- dependencies = { "nvim-tree/nvim-web-devicons" },
	opts = {
		position = "bottom",
	},
	config = function()
		require("which-key").register({ ["<leader>i"] = { name = "Issues" } })

		vim.keymap.set("n", "<leader>ii", "<cmd>Trouble<CR>", { desc = "Show issues via Trouble" })
		vim.keymap.set("n", "<leader>ia", "<cmd>Trouble workspace_diagnostics<CR>", { desc = "Trouble all files" })
		vim.keymap.set("n", "<leader>if", "<cmd>Trouble quickfix<CR>", { desc = "Trouble quickfix" })
	end,
}
