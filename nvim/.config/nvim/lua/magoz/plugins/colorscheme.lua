return {
	{
		"folke/tokyonight.nvim",
		lazy = false,
		name = "tokyonight",
		priority = 1000,
		config = function()
			require("tokyonight").setup({
				-- style = "night",
				-- on_colors = function(colors)
				-- 	colors.bg = "#0D1116"
				-- end,
			})

			vim.cmd.colorscheme("tokyonight")
		end,
	},
	-- {
	-- 	"bluz71/vim-nightfly-guicolors",
	-- 	priority = 1000, -- make sure to load this before all the other start plugins
	-- 	config = function()
	-- 		vim.cmd.colorscheme("nightfly")
	-- 	end,
	-- },
}
