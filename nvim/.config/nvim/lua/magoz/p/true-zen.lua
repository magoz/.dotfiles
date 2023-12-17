return {
	"Pocco81/true-zen.nvim",
	config = function()
		require("true-zen").setup({
			modes = { -- configurations per mode
				ataraxis = {
					minimum_writing_area = { -- minimum size of main window
						width = 80,
						height = 44,
					},
					padding = { -- padding windows
						left = 100,
						right = 100,
						top = 70,
						bottom = 70,
					},

					-- For some reason, Lualine is visible on ataraxis activation.
					-- https://github.com/Pocco81/true-zen.nvim/issues/110
					-- We are using this workaround until the issue gets fixed.
					callbacks = {
						open_pre = function()
							require("lualine").hide({})
						end,
						close_pre = function()
							require("lualine").hide({ unhide = true })
						end,
					},
				},
			},
		})

		vim.keymap.set("n", "<leader>z", "<cmd>:TZAtaraxis<CR>", { desc = "Toggle Zen mode (Ataraxis)" })
	end,
}
