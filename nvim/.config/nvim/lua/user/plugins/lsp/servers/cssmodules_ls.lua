local M = {}

M.setup = function()
	require("lspconfig").cssmodules_ls.setup({})
end

return M
