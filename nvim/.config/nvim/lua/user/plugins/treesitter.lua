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
		enable = true, -- false will disable the whole extension
	},
	incremental_selection = {
		enable = true,
		keymaps = {
			init_selection = "<c-n>",
			node_incremental = "<c-n>",
			node_decremental = "<c-p>",
			-- scope_incremental = "<c-s>",
		},
	},
})
