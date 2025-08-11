return {
	"folke/zen-mode.nvim",
	config = function()
		require("zen-mode").setup({
			window = {
				backdrop = 1, -- shade the backdrop of the Zen window. Set to 1 to keep the same as Normal
				width = 80, -- width of the Zen window
				height = 0.8, -- height of the Zen window
				options = {
					signcolumn = "no", -- disable signcolumn
					number = false, -- disable number column
					relativenumber = false, -- disable relative numbers
					cursorline = false, -- disable cursorline
					cursorcolumn = false, -- disable cursor column
					foldcolumn = "0", -- disable fold column
					list = false, -- disable whitespace characters
					listchars = "", -- remove all listchars to hide indentation guides
					wrap = true, -- enable line wrapping
				},
			},
			plugins = {
				options = {
					enabled = true,
					ruler = false, -- disables the ruler text in the cmd line area
					showcmd = false, -- disables the command in the last line of the screen
				},
				twilight = { enabled = false }, -- disable twilight integration
				gitsigns = { enabled = false }, -- disables git signs
			},

			-- Enable/Disable indent-blankline
			on_open = function(win)
				vim.cmd("IBLDisable")
			end,
			on_close = function()
				vim.cmd("IBLEnable")
			end,
		})

		vim.keymap.set("n", "<leader>z", "<cmd>:ZenMode<CR>", { desc = "Toggle Zen mode" })
	end,
}
