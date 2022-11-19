local M = {}

M.setup = function(on_attach, capabilities)
	require("lspconfig").tailwindcss.setup({
		server = {
			on_attach = function(client, bufnr)
				on_attach(client, bufnr)
			end,
			capabilities = capabilities,
		},
	})
end

return M
