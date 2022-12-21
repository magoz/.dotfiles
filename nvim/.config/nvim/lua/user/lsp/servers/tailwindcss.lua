local M = {}

M.setup = function(on_attach, capabilities)
	require("lspconfig").tailwindcss.setup({
		on_attach = function(client, bufnr)
			on_attach(client, bufnr)
		end,

		capabilities = capabilities,

		settings = {
			tailwindCSS = {
				lint = {
					cssConflict = "warning",
					invalidApply = "error",
					invalidConfigPath = "error",
					invalidScreen = "error",
					invalidTailwindDirective = "error",
					invalidVariant = "error",
					recommendedVariantOrder = "warning",
				},
				validate = true,

				-- Add autocomplete for Class Variance Authority package
				-- https://github.com/joe-bell/cva#tailwind-css-intellisense
				-- https://github.com/tailwindlabs/tailwindcss-intellisense
				experimental = {
					classRegex = {
						"tw`([^`]*)",
						'tw="([^"]*)',
						'tw={"([^"}]*)',
						"tw\\.\\w+`([^`]*)",
						"tw\\(.*?\\)`([^`]*)",
						{ "cva\\(([^)]*)\\)", "[\"'`]([^\"'`]*).*?[\"'`]" },
						{ "clsx\\(([^)]*)\\)", "(?:'|\"|`)([^']*)(?:'|\"|`)" },
						{ "classnames\\(([^)]*)\\)", "'([^']*)'" },
					},
				},
			},
		},
	})
end

return M
