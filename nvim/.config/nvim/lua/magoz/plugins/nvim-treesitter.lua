return {
	{
		"nvim-treesitter/nvim-treesitter",
		event = { "BufReadPre", "BufNewFile" },
		build = ":TSUpdate",
		dependencies = {
			"windwp/nvim-ts-autotag",
		},
		config = function()
			local treesitter = require("nvim-treesitter.configs")

			treesitter.setup({
				highlight = {
					enable = true,
				},
				indent = { enable = true },

				-- enable autotagging (w/ nvim-ts-autotag plugin)
				autotag = {
					enable = true,
				},

				ensure_installed = {
					"vimdoc",
					"vim",
					"lua",
					"javascript",
					"typescript",
					"tsx",
					"jsdoc",
					"prisma",
					"css",
					"scss",
					"html",
					"sql",
					"gitignore",
					"json",
					"json5",
					"jsonc",
					"markdown",
					"markdown_inline",
					"dockerfile",
					"regex",
					"bash",
					"make",
					"yaml",
					"toml",
					"glsl",
					"rust",
					"query",
				},
				incremental_selection = {
					enable = true,
					keymaps = {
						init_selection = "<C-space>",
						node_incremental = "<C-space>",
						scope_incremental = false,
						node_decremental = "<bs>",
					},
				},
			})
		end,
	},
}
