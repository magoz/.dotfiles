return {
	"folke/zen-mode.nvim",
	config = function()
		require("zen-mode").setup({
			window = {
				backdrop = 0.95, -- shade the backdrop of the Zen window. Set to 1 to keep the same as Normal
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
				tmux = { enabled = false }, -- disables the tmux statusline
				-- this will hide the lualine
				-- (requires lualine)
				lualine = { enabled = true },
			},
			on_open = function(win)
				-- Hide lualine when zen mode opens
				require("lualine").hide()
			end,
			on_close = function()
				-- Show lualine when zen mode closes
				require("lualine").hide({ unhide = true })
			end,
		})

		vim.keymap.set("n", "<leader>z", "<cmd>:ZenMode<CR>", { desc = "Toggle Zen mode" })
	end,
}
