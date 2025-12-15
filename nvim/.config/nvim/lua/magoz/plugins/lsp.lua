return {
	{
		"williamboman/mason.nvim",
		dependencies = {
			"williamboman/mason-lspconfig.nvim",
			"WhoIsSethDaniel/mason-tool-installer.nvim",
			"saghen/blink.cmp",
		},
		config = function()
			local wk = require("which-key")

			-- used to enable autocompletion (assign to every lsp server config)
			local capabilities = require("blink.cmp").get_lsp_capabilities()

			local on_attach = function()
				-- Jump to
				wk.add({ "<leader>j", group = "Jump to..." })
				vim.keymap.set("n", "<leader>ji", function()
					require("telescope.builtin").lsp_implementations({ reuse_win = true })
				end, { desc = "Implementation" })
				vim.keymap.set("n", "<leader>jr", function()
					require("telescope.builtin").lsp_references({ reuse_win = true })
				end, { desc = "References" })

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

				-- vtsls-specific keymaps (only for TypeScript files)
				local filetype = vim.bo.filetype
				if
					filetype == "typescript"
					or filetype == "typescriptreact"
					or filetype == "javascript"
					or filetype == "javascriptreact"
				then
					vim.keymap.set("n", "<leader>ai", function()
						vim.lsp.buf.code_action({
							apply = true,
							context = { only = { "source.addMissingImports" } },
						})
					end, { desc = "Add missing imports" })

					vim.keymap.set("n", "<leader>aI", function()
						vim.lsp.buf.code_action({
							apply = true,
							context = { only = { "source.removeUnused" } },
						})
					end, { desc = "Remove unused imports" })

					vim.keymap.set("n", "<leader>ao", function()
						vim.lsp.buf.code_action({
							apply = true,
							context = { only = { "source.organizeImports" } },
						})
					end, { desc = "Organize imports" })

					vim.keymap.set("n", "<leader>aF", function()
						vim.lsp.buf.code_action({
							apply = true,
							context = { only = { "source.fixAll" } },
						})
					end, { desc = "Fix all issues" })

					vim.keymap.set("n", "<leader>aR", function()
						require("vtsls").commands.rename_file()
					end, { desc = "Rename file" })

					vim.keymap.set("n", "<leader>js", function()
						require("vtsls").commands.goto_source_definition(0)
					end, { desc = "Jump to source definition" })

					vim.keymap.set("n", "<leader>jR", function()
						require("vtsls").commands.file_references(0)
					end, { desc = "File references" })

					-- Pick a TypeScript version
					vim.keymap.set("n", "<leader>at", function()
						vim.lsp.buf.execute_command({ command = "typescript.selectTypeScriptVersion" })
					end, { desc = "Select TypeScript Version" })

					-- Two Slash to see the type
					vim.api.nvim_set_keymap(
						"n",
						"<leader>a/",
						"<cmd>TwoslashQueriesInspect<CR>",
						{ desc = "Inspect with Two Slash" }
					)
				end
			end

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
			--  Mason and LSP setup
			--

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
				automatic_enable = false, -- Disable auto-enable so we can configure manually
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

			-- Modern LSP configurations using vim.lsp.config() (Neovim 0.11+)

			-- Basic servers with default config
			local basic_servers = { "html", "cssls", "bashls", "prismals", "rust_analyzer", "cssmodules_ls" }
			for _, server in ipairs(basic_servers) do
				vim.lsp.config(server, {
					capabilities = capabilities,
					on_attach = on_attach,
				})
			end

			-- Custom configurations for specific servers
			vim.lsp.config("vtsls", {
				capabilities = capabilities,
				on_attach = function(client, bufnr)
					on_attach()
					require("twoslash-queries").attach(client, bufnr)
				end,
				settings = {
					vtsls = {
						autoUseWorkspaceTsdk = true,
						experimental = {
							completion = {
								enableServerSideFuzzyMatch = true,
							},
						},
					},
					typescript = {
						tsserver = {
							pluginPaths = { "./node_modules" },
						},
						preferences = {
							go_to_source_definition = {
								fallback = true,
							},
							updateImportsOnFileMove = {
								enabled = "always",
							},
						},
					},
				},
			})

			vim.lsp.config("tailwindcss", {
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

			vim.lsp.config("jsonls", {
				capabilities = capabilities,
				on_attach = on_attach,
				settings = {
					json = {
						schemas = require("schemastore").json.schemas(),
					},
				},
			})

			vim.lsp.config("lua_ls", {
				capabilities = capabilities,
				on_attach = on_attach,
				settings = {
					Lua = {
						diagnostics = {
							globals = { "vim" },
						},
						workspace = {
							library = {
								[vim.fn.expand("$VIMRUNTIME/lua")] = true,
								[vim.fn.stdpath("config") .. "/lua"] = true,
							},
						},
					},
				},
			})

			vim.lsp.config("yamlls", {
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

			-- Enable all configured servers
			local all_servers = {
				"html",
				"cssls",
				"bashls",
				"prismals",
				"rust_analyzer",
				"cssmodules_ls",
				"vtsls",
				"tailwindcss",
				"jsonls",
				"lua_ls",
				"yamlls",
			}
			for _, server in ipairs(all_servers) do
				vim.lsp.enable(server)
			end
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
			"b0o/schemastore.nvim",
		},
		config = function()
			-- LSP configs are now handled above in mason setup
		end,
	},
}
