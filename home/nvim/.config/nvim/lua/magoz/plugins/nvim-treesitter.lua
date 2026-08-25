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

			if not vim.g.magoz_treesitter_capture_list_compat then
				vim.g.magoz_treesitter_capture_list_compat = true

				-- Neovim 0.12 can pass capture matches as node lists.
				local unwrap_node = function(node)
					if type(node) ~= "table" or not vim.islist(node) then
						return node
					end

					local first = node[1]
					if type(first) ~= "userdata" then
						return node
					end

					return first
				end

				local get_range = vim.treesitter.get_range
				vim.treesitter.get_range = function(node, source, metadata)
					return get_range(unwrap_node(node), source, metadata)
				end

				local get_node_text = vim.treesitter.get_node_text
				vim.treesitter.get_node_text = function(node, source, opts)
					return get_node_text(unwrap_node(node), source, opts)
				end
			end

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
