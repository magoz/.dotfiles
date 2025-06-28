return {
	"vuki656/package-info.nvim",
	event = "VeryLazy",
	dependencies = {
		"MunifTanjim/nui.nvim",
	},
	config = function()
		require("package-info").setup({
			autostart = false,
		})

		require("which-key").add({ "<leader>p", group = "package.json actions" })
		vim.keymap.set(
			"n",
			"<leader>pp",
			"<cmd>lua require('package-info').show()<cr>",
			{ desc = "Show Package Versions" }
		)
		vim.keymap.set(
			"n",
			"<leader>pv",
			"<cmd>lua require('package-info').change_version()<cr>",
			{ desc = "Change Package Version" }
		)
		vim.keymap.set("n", "<leader>pd", "<cmd>lua require('package-info').delete()<cr>", { desc = "Delete Package" })
	end,
}
