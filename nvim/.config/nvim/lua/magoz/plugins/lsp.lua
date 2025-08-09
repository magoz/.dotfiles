return {
	{
		"williamboman/mason.nvim",
		dependencies = {
			"williamboman/mason-lspconfig.nvim",
			"WhoIsSethDaniel/mason-tool-installer.nvim",
		},
		config = function()
			require("mason").setup({
				ui = {
					icons = {
						package_installed = "✓",
						package_pending = "➜",
						package_uninstalled = "✗",
					},
				},
			})

			require("mason-lspconfig").setup({
				ensure_installed = {
					"lua_ls",
					"cssls",
					"cssmodules_ls",
					"html",
					"prismals",
					-- "graphql",
					"tailwindcss",
					-- "markdownlint",
					"vtsls",
					"rust_analyzer",
					"bashls",
					"jsonls",
					"yamlls",
				},
				handlers = {
					-- Custom vtsls configuration
					vtsls = function()
						local lspconfig = require("lspconfig")
						local cmp_nvim_lsp = require("cmp_nvim_lsp")
						local capabilities = cmp_nvim_lsp.default_capabilities()
						
						lspconfig.vtsls.setup({
							capabilities = capabilities,
							on_attach = function(client, bufnr)
								-- vtsls-specific keymaps
								vim.keymap.set("n", "<leader>ai", function()
									vim.lsp.buf.code_action({
										apply = true,
										context = { only = { "source.addMissingImports" } }
									})
								end, { buffer = bufnr, desc = "Add missing imports" })
								
								vim.keymap.set("n", "<leader>aI", function()
									vim.lsp.buf.code_action({
										apply = true,
										context = { only = { "source.removeUnused" } }
									})
								end, { buffer = bufnr, desc = "Remove unused imports" })
								
								vim.keymap.set("n", "<leader>ao", function()
									vim.lsp.buf.code_action({
										apply = true,
										context = { only = { "source.organizeImports" } }
									})
								end, { buffer = bufnr, desc = "Organize imports" })
								
								vim.keymap.set("n", "<leader>aF", function()
									vim.lsp.buf.code_action({
										apply = true,
										context = { only = { "source.fixAll" } }
									})
								end, { buffer = bufnr, desc = "Fix all issues" })
								
								vim.keymap.set("n", "<leader>aR", function()
									vim.lsp.buf.rename()
								end, { buffer = bufnr, desc = "Rename file" })
								
								vim.keymap.set("n", "<leader>js", function()
									require("vtsls").commands.goto_source_definition(0)
								end, { buffer = bufnr, desc = "Jump to source definition" })
								
								vim.keymap.set("n", "<leader>jR", function()
									require("vtsls").commands.file_references(0)
								end, { buffer = bufnr, desc = "File references" })
							end,
							settings = {
								vtsls = {
									experimental = {
										completion = {
											enableServerSideFuzzyMatch = true,
										},
									},
								},
								typescript = {
									preferences = {
										go_to_source_definition = {
											fallback = true,
										},
									},
								},
							},
						})
					end,
				},
			})

			require("mason-tool-installer").setup({
				ensure_installed = {
					"prettier",
					"stylua",
					"eslint",
					-- Shell
					"shfmt",
					"shellcheck",
				},
			})
		end,
	},
	{

		"williamboman/mason-lspconfig.nvim",
		config = function() end,
	},

	{
		"neovim/nvim-lspconfig",
		event = { "BufReadPre", "BufNewFile" },
		dependencies = {
			"hrsh7th/cmp-nvim-lsp",
			{ "antosha417/nvim-lsp-file-operations", config = true },
			"b0o/schemastore.nvim",
		},
		config = function()
			local wk = require("which-key")
			local lspconfig = require("lspconfig")
			local cmp_nvim_lsp = require("cmp_nvim_lsp")

			local on_attach = function()
				-- Jump to
				wk.add({ "<leader>j", group = "Jump to..." })
				vim.keymap.set("n", "<leader>ji", function()
					require("telescope.builtin").lsp_implementations({ reuse_win = true })
				end, { desc = "Implementation" })
				vim.keymap.set("n", "<leader>jr", function()
					require("telescope.builtin").lsp_references({ reuse_win = true })
				end, { desc = "References" })
				-- vim.keymap.set(
				-- 	"n",
				-- 	"<leader>jd",
				-- 	vim.lsp.buf.definition,
				-- 	{ desc = "Definition" }
				-- )

				-- vim.keymap.set("n", "<leader>jd", function()
				-- 	require("telescope.builtin").lsp_definitions({ reuse_win = true })
				-- end, { desc = "Definition" })

				vim.keymap.set("n", "<leader>jd", function()
					local current_win = vim.api.nvim_get_current_win()
					local win_config = vim.api.nvim_win_get_config(current_win)

					if win_config.relative ~= "" then
						local word = vim.fn.expand("<cword>")

						-- Close hover and execute definition in original buffer context
						vim.api.nvim_win_close(current_win, true)

						vim.defer_fn(function()
							require("telescope.builtin").lsp_workspace_symbols({
								query = word,
								reuse_win = true,
							})
							-- Use telescope with the word as query
						end, 100)

					-- Normal jump to definition
					else
						require("telescope.builtin").lsp_definitions({ reuse_win = true })
					end
				end, { desc = "Definition" })

				vim.keymap.set("n", "<leader>t", function()
					require("telescope.builtin").lsp_type_definitions({ reuse_win = true })
				end, { desc = "Type Definition" })
				vim.keymap.set(
					"n",
					"<leader>D",
					vim.lsp.buf.declaration,
					{ desc = "Declaration (not supported in ts/js/css)" }
				)

				-- Actions
				wk.add({ "<leader>a", group = "Actions" })
				vim.keymap.set("n", "<leader>ah", function()
					vim.lsp.buf.hover({ border = "rounded", max_height = 50 })
				end, { desc = "Show Hover" })
				vim.keymap.set("n", "<leader>aH", function()
					vim.lsp.buf.signature_help({ border = "rounded", max_height = 50 })
				end, { desc = "Show Signature Help" })
				vim.keymap.set("n", "<leader>ar", vim.lsp.buf.rename, { desc = "Rename Variable" })
				vim.keymap.set(
					"n",
					"<leader>aa",
					vim.lsp.buf.code_action,
					{ desc = "Show Actions (extract code, move to file, etc)" }
				)
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

			config.signs = {
				text = {
					[vim.diagnostic.severity.ERROR] = "",
					[vim.diagnostic.severity.WARN] = "",
					[vim.diagnostic.severity.HINT] = "󰌶",
					[vim.diagnostic.severity.INFO] = "",
				},
			}

			vim.diagnostic.config(config)

			--
			--  Configure and enable LSPs
			--

			lspconfig["html"].setup({
				capabilities = capabilities,
				on_attach = on_attach,
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

			lspconfig["rust_analyzer"].setup({
				capabilities = capabilities,
				on_attach = on_attach,
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
	},
}
