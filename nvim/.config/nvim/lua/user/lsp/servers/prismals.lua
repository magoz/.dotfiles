local M = {}

M.setup = function(on_attach, capabilities)
	require("lspconfig").prismals.setup({})
end

return M
