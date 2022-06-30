local M = {}

local capabilities = vim.lsp.protocol.make_client_capabilities()
capabilities.textDocument.completion.completionItem.snippetSupport = true

-- require'lspconfig'.cssls.setup {
--   capabilities = capabilities,
-- }

M.setup = function()
	require("lspconfig").cssls.setup({
		capabilities = capabilities,
	})
end

return M
