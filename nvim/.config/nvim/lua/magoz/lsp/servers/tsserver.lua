-- Using typescript plugin
-- https://github.com/jose-elias-alvarez/typescript.nvim
-- Important: if you have require("lspconfig").setup({}) anywhere in your config, make sure to remove it
-- and pass any options you were using under the server key.
-- lspconfig doesn't allow more than one setup call, so your config will not work as expected.

local M = {}

M.setup = function(on_attach, capabilities)
	require("typescript").setup({
		server = {
			on_attach = function(client, bufnr)
				on_attach(client, bufnr)
			end,
			capabilities = capabilities,
		},
		-- prevent showing d.ts files
		go_to_source_definition = {
			fallback = true,
		},
	})

	require("which-key").register({
		t = {
			name = "Typescript", -- optional group name
			i = { ":TypescriptAddMissingImports<CR>", "Add missing imports" },
			I = { ":TypescriptRemoveUnused<CR>", "Remove unused imports" },
			o = { ":TypescriptOrganizeImports<CR>", "Organize imports" },
			f = { ":TypescriptFixAll<CR>", "Fix all issues" },
			r = { ":TypescriptRenameFile<CR>", "Rename file" },
		},
	}, { prefix = "<leader>" })
end

return M
