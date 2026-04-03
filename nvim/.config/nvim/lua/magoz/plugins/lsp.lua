return {
	{
		"williamboman/mason.nvim",
		dependencies = {
			"neovim/nvim-lspconfig",
			"williamboman/mason-lspconfig.nvim",
			"WhoIsSethDaniel/mason-tool-installer.nvim",
			"saghen/blink.cmp",
		},
		config = function()
			local wk = require("which-key")

			-- used to enable autocompletion (assign to every lsp server config)
			local capabilities = require("blink.cmp").get_lsp_capabilities()

			-- LspAttach autocmd (vim.lsp.config does NOT support on_attach)
			vim.api.nvim_create_autocmd("LspAttach", {
				callback = function(args)
					local bufnr = args.buf
					local client = vim.lsp.get_clients({ id = args.data.client_id })[1]
					local opts = function(desc)
						return { buf = bufnr, desc = desc }
					end

					-- Jump to
					wk.add({ "<leader>j", group = "Jump to..." })
					vim.keymap.set("n", "<leader>ji", function()
						require("telescope.builtin").lsp_implementations({ reuse_win = true })
					end, opts("Implementation"))
					vim.keymap.set("n", "<leader>jr", function()
						require("telescope.builtin").lsp_references({ reuse_win = true })
					end, opts("References"))

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
					end, opts("Definition"))

					vim.keymap.set("n", "<leader>t", function()
						require("telescope.builtin").lsp_type_definitions({ reuse_win = true })
					end, opts("Type Definition"))
					vim.keymap.set(
						"n",
						"<leader>D",
						vim.lsp.buf.declaration,
						opts("Declaration (not supported in ts/js/css)")
					)

					-- Actions
					wk.add({ "<leader>a", group = "Actions" })
					vim.keymap.set("n", "<leader>ah", function()
						vim.lsp.buf.hover({ border = "rounded", max_height = 50 })
					end, opts("Show Hover"))
					vim.keymap.set("n", "<leader>aH", function()
						vim.lsp.buf.signature_help({ border = "rounded", max_height = 50 })
					end, opts("Show Signature Help"))
					vim.keymap.set("n", "<leader>ar", vim.lsp.buf.rename, opts("Rename Variable"))
					vim.keymap.set(
						"n",
						"<leader>aa",
						vim.lsp.buf.code_action,
						opts("Show Actions (extract code, move to file, etc)")
					)

					-- vtsls-specific keymaps
					if client and client.name == "vtsls" then
						require("twoslash-queries").attach(client, bufnr)

						vim.keymap.set("n", "<leader>ai", function()
							vim.lsp.buf.code_action({
								apply = true,
								context = { only = { "source.addMissingImports" } },
							})
						end, opts("Add missing imports"))

						vim.keymap.set("n", "<leader>aI", function()
							vim.lsp.buf.code_action({
								apply = true,
								context = { only = { "source.removeUnused" } },
							})
						end, opts("Remove unused imports"))

						vim.keymap.set("n", "<leader>ao", function()
							vim.lsp.buf.code_action({
								apply = true,
								context = { only = { "source.organizeImports" } },
							})
						end, opts("Organize imports"))

						vim.keymap.set("n", "<leader>aF", function()
							vim.lsp.buf.code_action({
								apply = true,
								context = { only = { "source.fixAll" } },
							})
						end, opts("Fix all issues"))

						vim.keymap.set("n", "<leader>aR", function()
							require("vtsls").commands.rename_file()
						end, opts("Rename file"))

						vim.keymap.set("n", "<leader>js", function()
							require("vtsls").commands.goto_source_definition(0)
						end, opts("Jump to source definition"))

						vim.keymap.set("n", "<leader>jR", function()
							require("vtsls").commands.file_references(0)
						end, opts("File references"))

						vim.keymap.set("n", "<leader>at", function()
							vim.lsp.buf.execute_command({ command = "typescript.selectTypeScriptVersion" })
						end, opts("Select TypeScript Version"))

						vim.keymap.set(
							"n",
							"<leader>a/",
							"<cmd>TwoslashQueriesInspect<CR>",
							opts("Inspect with Two Slash")
						)
					end
				end,
			})

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
				})
			end

			-- Custom configurations for specific servers
			vim.lsp.config("vtsls", {
				capabilities = capabilities,
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
				settings = {
					json = {
						schemas = require("schemastore").json.schemas(),
					},
				},
			})

			vim.lsp.config("lua_ls", {
				capabilities = capabilities,
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
		lazy = false,
		dependencies = {
			"b0o/schemastore.nvim",
		},
	},
}
