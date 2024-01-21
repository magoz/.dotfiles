return {
	"ThePrimeagen/harpoon",
	branch = "harpoon2",
	dependencies = {
		"nvim-lua/plenary.nvim",
	},
	config = function()
		local harpoon = require("harpoon")
		harpoon:setup()

		require("which-key").register({ ["<leader>h"] = { name = "Harpoon" } })

		vim.keymap.set("n", "<leader>ha", function()
			harpoon:list():append()
		end, { desc = "Add file to harpoon" })

		vim.keymap.set("n", "<leader>hl", function()
			harpoon.ui:toggle_quick_menu(harpoon:list())
		end, { desc = "Toggle Harpoon menu" })

		vim.keymap.set("n", "<leader>hn", function()
			harpoon:list():prev({ ui_nav_wrap = true })
		end, { desc = "Go to previous harpoon" })

		vim.keymap.set("n", "<leader>hp", function()
			harpoon:list():next({ ui_nav_wrap = true })
		end, { desc = "Go to next harpoon" })

		vim.keymap.set("n", "<leader>1", function()
			harpoon:list():select(1)
		end, { desc = "Go to harpoon 1" })

		vim.keymap.set("n", "<leader>2", function()
			harpoon:list():select(2)
		end, { desc = "Go to harpoon 1" })

		vim.keymap.set("n", "<leader>3", function()
			harpoon:list():select(3)
		end, { desc = "Go to harpoon 3" })

		vim.keymap.set("n", "<leader-4>", function()
			harpoon:list():select(4)
		end, { desc = "Go to harpoon 4" })
	end,
}
