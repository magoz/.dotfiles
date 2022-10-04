local null_ls_status_ok, null_ls = pcall(require, "null-ls")
if not null_ls_status_ok then
	return
end

local b = null_ls.builtins

local sources = {
	-- Formatting
	-- https://github.com/jose-elias-alvarez/null-ls.nvim/tree/main/lua/null-ls/builtins/formatting
	b.formatting.prettier,
	-- b.formatting.textlint,
	-- b.formatting.mdformat,
	b.formatting.stylua,
	-- Diagnostics
	-- https://github.com/jose-elias-alvarez/null-ls.nvim/tree/main/lua/null-ls/builtins/diagnostics
	b.diagnostics.eslint,
	b.diagnostics.markdownlint,
}

-- Completion
-- https://github.com/jose-elias-alvarez/null-ls.nvim/tree/main/lua/null-ls/builtins/completion
--

-- Hover
-- https://github.com/jose-elias-alvarez/null-ls.nvim/tree/main/lua/null-ls/builtins/hover
--

local M = {}
M.setup = function(on_attach)
	if not vim.g.started_by_firenvim then
		null_ls.setup({
			-- debug = true,
			sources = sources,
			on_attach = on_attach,
		})
	end
end

return M
