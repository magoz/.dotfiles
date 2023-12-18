return {
	"neovim/nvim-lspconfig",
	event = { "BufReadPre", "BufNewFile" },
	dependencies = {
		"hrsh7th/cmp-nvim-lsp",
		{ "antosha417/nvim-lsp-file-operations", config = true },
		"b0o/schemastore.nvim",
	},
	config = function()
		-- import lspconfig plugin
		local lspconfig = require("lspconfig")

		-- import cmp-nvim-lsp plugin
		local cmp_nvim_lsp = require("cmp_nvim_lsp")

		local on_attach = function()
			-- Jump to
			require("which-key").register({ ["<leader>j"] = { name = "Jump to..." } })
			vim.keymap.set("n", "<leader>ji", function()
				require("telescope.builtin").lsp_implementations({ reuse_win = true })
			end, { desc = "Implementation" })
			vim.keymap.set("n", "<leader>jr", "<cmd>Telescope lsp_references<CR>", { desc = "References" }) -- TODO: check how to do telescope
			vim.keymap.set("n", "<leader>jd", function()
				require("telescope.builtin").lsp_definitions({ reuse_win = true })
			end, { desc = "Definition" }) -- TODO: see how we can do typescript defintion. -- fallbacks to LspDefinition if not found.
			vim.keymap.set(
				"n",
				"<leader>D",
				vim.lsp.buf.declaration,
				{ desc = "Declaration (not supported in ts/js/css)" }
			)
			vim.keymap.set("n", "<leader>t", function()
				require("telescope.builtin").lsp_type_definitions({ reuse_win = true })
			end, { desc = "Type Definition" })

			-- Actions
			require("which-key").register({ ["<leader>a"] = { name = "Actions" } })
			vim.keymap.set("n", "<leader>ah", vim.lsp.buf.hover, { desc = "Hover" })
			vim.keymap.set("n", "<leader>aH", vim.lsp.buf.signature_help, { desc = "Show Signature Help" })
			vim.keymap.set("n", "<leader>ar", vim.lsp.buf.rename, { desc = "Rename Variable" })
			vim.keymap.set(
				"n",
				"<leader>aa",
				vim.lsp.buf.code_action,
				{ desc = "Show Actions (extract code, move to file, etc)" }
			)

			-- Issues
			require("which-key").register({ ["<leader>i"] = { name = "Issues" } })
			vim.keymap.set("n", "<leader>id", vim.lsp.diagnostic.open_float, { desc = "Show Diagnostics" })
			vim.keymap.set("n", "<leader>in", vim.lsp.diagnostic.goto_next, { desc = "Show Next Diagnostic" })
			vim.keymap.set("n", "<leader>ip", vim.lsp.diagnostic.goto_prev, { desc = "Show Prev Diagnostic" })
			vim.keymap.set("n", "<leader>iq", vim.lsp.diagnostic.goto_prev, { desc = "Set Quick Fix List" })
		end

		-- used to enable autocompletion (assign to every lsp server config)
		local capabilities = cmp_nvim_lsp.default_capabilities()

		-- DIAGNOSTICS
		local config = {
			virtual_text = false, -- disable virtual text
			update_in_insert = true,
			underline = true,
			severity_sort = true,
			float = {
				focusable = true,
				style = "minimal",
				border = "rounded",
				source = "always",
				header = "",
				prefix = "",
			},
		}

		vim.diagnostic.config(config)

		local signs = {
			Error = " ",
			Warn = " ",
			Hint = "",
			Info = " ",
		}
		for type, icon in pairs(signs) do
			local hl = "DiagnosticSign" .. type
			vim.fn.sign_define(hl, { text = icon, texthl = hl, numhl = "" })
		end

		-- FLOATING WINDOW
		vim.lsp.handlers["textDocument/hover"] = vim.lsp.with(vim.lsp.handlers.hover, {
			border = "rounded",
		})

		vim.lsp.handlers["textDocument/signatureHelp"] = vim.lsp.with(vim.lsp.handlers.signature_help, {
			border = "rounded",
		})

		--
		--  Configure and enable LSPs
		--

		lspconfig["html"].setup({
			capabilities = capabilities,
			on_attach = on_attach,
		})

		lspconfig["tsserver"].setup({
			capabilities = capabilities,
			on_attach = on_attach,
			-- prevent showing d.ts files
			go_to_source_definition = {
				fallback = true,
			},
		})

		lspconfig["jsonls"].setup({
			capabilities = capabilities,
			on_attach = on_attach,

			settings = {
				json = {
					schemas = require("schemastore").json.schemas(),
				},
			},
		})

		lspconfig["cssls"].setup({
			capabilities = capabilities,
			on_attach = on_attach,
		})

		lspconfig["tailwindcss"].setup({
			capabilities = capabilities,
			on_attach = on_attach,
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

		lspconfig["cssmodules_ls"].setup({
			capabilities = capabilities,
			on_attach = on_attach,
		})

		lspconfig["prismals"].setup({
			capabilities = capabilities,
			on_attach = on_attach,
		})

		-- lspconfig["graphql"].setup({
		-- 	capabilities = capabilities,
		-- 	on_attach = on_attach,
		-- 	filetypes = { "graphql", "gql", "svelte", "typescriptreact", "javascriptreact" },
		-- })

		lspconfig["emmet_ls"].setup({
			capabilities = capabilities,
			on_attach = on_attach,
			filetypes = { "html", "typescriptreact", "javascriptreact", "css", "sass", "scss", "less" },
		})

		lspconfig["bashls"].setup({
			capabilities = capabilities,
			on_attach = on_attach,
		})

		lspconfig["yamlls"].setup({
			capabilities = capabilities,
			on_attach = on_attach,

			settings = {
				yaml = {
					schemaStore = {
						enable = true,
					},
				},
			},
		})

		lspconfig["lua_ls"].setup({
			capabilities = capabilities,
			on_attach = on_attach,
			settings = { -- custom settings for lua
				Lua = {
					-- make the language server recognize "vim" global
					diagnostics = {
						globals = { "vim" },
					},
					workspace = {
						-- make language server aware of runtime files
						library = {
							[vim.fn.expand("$VIMRUNTIME/lua")] = true,
							[vim.fn.stdpath("config") .. "/lua"] = true,
						},
					},
				},
			},
		})
	end,
}
