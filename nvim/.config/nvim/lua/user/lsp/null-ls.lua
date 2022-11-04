local null_ls_status_ok, null_ls = pcall(require, "null-ls")
if not null_ls_status_ok then
	return
end

local b = null_ls.builtins

local sources = {
	-- Formatting
	-- https://github.com/jose-elias-alvarez/null-ls.nvim/tree/main/lua/null-ls/builtins/formatting
	b.formatting.prettier,
	b.formatting.stylua,
	b.formatting.markdownlint,
	-- TODO: make markdown formatting work
	-- b.formatting.markdownlint.with({
	-- 	extra_args = { "--disable", "MD041" },
	-- }),
	--
	-- Diagnostics
	-- https://github.com/jose-elias-alvarez/null-ls.nvim/tree/main/lua/null-ls/builtins/diagnostics
	b.diagnostics.eslint,
	b.diagnostics.markdownlint.with({
		-- disables rule MD041 - First line in a file should be a top-level heading
		-- https://github.com/DavidAnson/markdownlint/blob/main/doc/Rules.md#md041---first-line-in-a-file-should-be-a-top-level-heading
		extra_args = { "--disable", "MD041" },
	}),
}

-- Completion
-- https://github.com/jose-elias-alvarez/null-ls.nvim/tree/main/lua/null-ls/builtins/completion
--

-- Hover
-- https://github.com/jose-elias-alvarez/null-ls.nvim/tree/main/lua/null-ls/builtins/hover
--
null_ls.setup({
	debug = false,
	sources = sources,
})
