return {
	"lukas-reineke/indent-blankline.nvim",
	main = "ibl",
	opts = {
		indent = {
			-- char = "▏",
			-- highlight = {
			-- 	"CursorColumn",
			-- 	"Whitespace",
			-- },
		},
		exclude = {
			filetypes = {
				"help",
				"NvimTree",
			},
			buftypes = {
				"terminal",
				"nofile",
			},
		},
		-- show_current_context = true,
		-- _blankline_char = "▏",
		-- indent_blankline_show_trailing_blankline_indent = false,
		-- indent_blankline_show_first_indent_level = true,
		-- indent_blankline_use_treesitter = true,
		-- indent_blankline_show_current_context = true,
		-- indent_blankline_buftype_exclude = { "terminal", "nofile" },
		-- indent_blankline_filetype_exclude = {
		-- 	"help",
		-- 	"packer",
		-- 	"NvimTree",
		-- },
	},
}
