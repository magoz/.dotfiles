local M = {}

local capabilities = vim.lsp.protocol.make_client_capabilities()
capabilities.textDocument.completion.completionItem.snippetSupport = true

M.setup = function(on_attach)
	require("lspconfig").cssls.setup({
		on_attach = on_attach,
		capabilities = capabilities,
	})
end

return M
