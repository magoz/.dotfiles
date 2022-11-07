local wk = require("which-key")

local M = {}

M.setup = function(on_attach, capabilities)
	require("typescript").setup({
		server = {
			on_attach = function(client, bufnr)
				on_attach(client, bufnr)
			end,
			capabilities = capabilities,
		},
	})
end

wk.register({
	t = {
		name = "Typescript", -- optional group name
		i = { ":TypescriptAddMissingImports<CR>", "Add missing imports" },
		I = { ":TypescriptRemoveUnused<CR>", "Remove unused imports" },
		o = { ":TypescriptOrganizeImports<CR>", "Organize imports" },
		f = { ":TypescriptFixAll<CR>", "Fix all issues" },
		r = { ":TypescriptRenameFile<CR>", "Rename file" },
	},
}, { prefix = "<leader>" })
return M
