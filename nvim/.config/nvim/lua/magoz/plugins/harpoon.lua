return {
	"ThePrimeagen/harpoon",
	dependencies = {
		"nvim-lua/plenary.nvim",
	},
	config = function()
		require("which-key").register({ ["<leader>h"] = { name = "Harpoon" } })

		vim.keymap.set(
			"n",
			"<leader>ha",
			"<cmd>lua require('harpoon.mark').add_file()<cr>",
			{ desc = "Add file to harpoon" }
		)
		vim.keymap.set(
			"n",
			"<leader>hl",
			"<cmd>lua require('harpoon.ui').toggle_quick_menu()<cr>",
			{ desc = "Toggle Harpoon menu" }
		)
		vim.keymap.set(
			"n",
			"<leader>hn",
			"<cmd>lua require('harpoon.ui').nav_next()<cr>",
			{ desc = "Go to next harpoon mark" }
		)
		vim.keymap.set(
			"n",
			"<leader>hp",
			"<cmd>lua require('harpoon.ui').nav_prev()<cr>",
			{ desc = "Go to previous harpoon mark" }
		)
		vim.keymap.set(
			"n",
			"<leader>h1",
			"<cmd>lua require('harpoon.ui').nav_file(1)<cr>",
			{ desc = "Go to harpoon mark 1" }
		)
		vim.keymap.set(
			"n",
			"<leader>h2",
			"<cmd>lua require('harpoon.ui').nav_file(2)<cr>",
			{ desc = "Go to harpoon mark 2" }
		)
		vim.keymap.set(
			"n",
			"<leader>h3",
			"<cmd>lua require('harpoon.ui').nav_file(3)<cr>",
			{ desc = "Go to harpoon mark 3" }
		)
		vim.keymap.set(
			"n",
			"<leader>h4",
			"<cmd>lua require('harpoon.ui').nav_file(4)<cr>",
			{ desc = "Go to harpoon mark 4" }
		)
	end,
}
