return {
	"folke/trouble.nvim",
	-- dependencies = { "nvim-tree/nvim-web-devicons" },
	opts = {
		position = "bottom",
	},
	config = function()
		-- Issues
		require("which-key").add({ "<leader>i", group = "Issues" })
		vim.keymap.set("n", "<leader>id", vim.diagnostic.open_float, { desc = "Show Diagnostics" })
		vim.keymap.set("n", "<leader>in", vim.diagnostic.goto_next, { desc = "Show Next Diagnostic" })
		vim.keymap.set("n", "<leader>ip", vim.diagnostic.goto_prev, { desc = "Show Prev Diagnostic" })
		vim.keymap.set("n", "<leader>ii", function()
			require("trouble").toggle()
		end, { desc = "Show issues via Trouble" })
		vim.keymap.set("n", "<leader>ia", function()
			require("trouble").toggle("workspace_diagnostics")
		end, { desc = "Trouble all files" })
	end,
}
