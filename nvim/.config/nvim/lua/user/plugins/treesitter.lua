local status_ok, configs = pcall(require, "nvim-treesitter.configs")
if not status_ok then
	return
end

configs.setup({
	ensure_installed = {
		"help",
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
	highlight = {
		enable = true,
	},
	incremental_selection = {
		enable = true,
		keymaps = {
			init_selection = "<leader><space>",
			node_incremental = "<leader><space>",
			node_decremental = "<leader><bs>",
			-- scope_incremental = "<c-s>",
		},
	},
})
