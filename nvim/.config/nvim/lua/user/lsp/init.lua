local status_ok, _ = pcall(require, "lspconfig")
if not status_ok then
	return
end

require("user.lsp.neodev") -- IMPORTANT: make sure to setup neodev BEFORE lspconfig (called by mason)
require("user.lsp.mason")
require("user.lsp.handlers").setup()
require("user.lsp.null-ls")
