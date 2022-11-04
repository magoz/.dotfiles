local M = {}

M.setup = function(on_attach, capabilities)
	require("lspconfig").yamlls.setup({
		on_attach = on_attach,
		capabilities = capabilities,
		settings = {
			yaml = {
				schemaStore = {
					enable = true,
				},
			},
		},
	})
end

return M
