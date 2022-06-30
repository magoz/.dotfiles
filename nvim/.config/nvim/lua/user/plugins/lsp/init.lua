local u = require("user.utils")

local status_ok, _ = pcall(require, "lspconfig")
if not status_ok then
	return
end

local lsp = vim.lsp
local signs = {
	{ name = "DiagnosticSignError", text = "" },
	{ name = "DiagnosticSignWarn", text = "" },
	{ name = "DiagnosticSignHint", text = "" },
	{ name = "DiagnosticSignInfo", text = "" },
}

for _, sign in ipairs(signs) do
	vim.fn.sign_define(sign.name, { texthl = sign.name, text = sign.text, numhl = "" })
end

local diagnostic_config = {
	virtual_text = true, -- inline text at the end of the line showing the error
	signs = {
		active = signs, -- show signs
	},
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

vim.diagnostic.config(diagnostic_config)

local eslint_disabled_buffers = {}

local border_opts = { border = "single", focusable = false, scope = "line" }

lsp.handlers["textDocument/signatureHelp"] = lsp.with(lsp.handlers.signature_help, border_opts)
lsp.handlers["textDocument/hover"] = lsp.with(lsp.handlers.hover, border_opts)

-- Format on save
local augroup = vim.api.nvim_create_augroup("LspFormatting", {})

local on_attach = function(client, bufnr)
	--  -- Navigation
	-- keymap(bufnr, "n", "gD", "<cmd>lua vim.lsp.buf.declaration()<CR>", opts)
	-- keymap(bufnr, "n", "gd", "<cmd>lua vim.lsp.buf.definition()<CR>", opts)
	-- keymap(bufnr, "n", "gI", "<cmd>lua vim.lsp.buf.implementation()<CR>", opts)
	-- keymap(bufnr, "n", "gr", "<cmd>lua vim.lsp.buf.references()<CR>", opts)
	--
	--  -- Formatting
	--  keymap(bufnr, "n", "<leader>lf", "<cmd>lua vim.lsp.buf.formatting()<cr>", opts)
	--
	--  -- Linting
	--  keymap(bufnr, "n", "K", "<cmd>lua vim.lsp.buf.hover()<CR>", opts) -- Hover equivalent of vscode
	--  keymap(bufnr, "n", "gl", "<cmd>lua vim.diagnostic.open_float()<CR>", opts) -- Tell me what's wrong
	--  -- keymap(bufnr, "n", "<leader>lj", "<cmd>lua vim.diagnostic.goto_next({buffer=0})<cr>", opts)
	--  keymap(bufnr, "n", "<leader>lk", "<cmd>lua vim.diagnostic.goto_prev({buffer=0})<cr>", opts)
	--
	--  -- Lsp Info
	-- keymap(bufnr, "n", "<leader>li", "<cmd>LspInfo<cr>", opts)
	-- keymap(bufnr, "n", "<leader>lI", "<cmd>LspInstallInfo<cr>", opts)
	--
	--  -- Not sure what this does
	--  keymap(bufnr, "n", "<leader>ls", "<cmd>lua vim.lsp.buf.signature_help()<CR>", opts) -- Not sure what this does
	--  keymap(bufnr, "n", "<leader>lq", "<cmd>lua vim.diagnostic.setloclist()<CR>", opts) -- Not sure what this does
	-- keymap(bufnr, "n", "<leader>la", "<cmd>lua vim.lsp.buf.code_action()<cr>", opts) -- Not sure what this does
	-- keymap(bufnr, "n", "<leader>lr", "<cmd>lua vim.lsp.buf.rename()<cr>", opts) -- Not sure what this does
	--
	-- -- Create a command accessible via :Format that formats the document
	-- vim.cmd([[ command! Format execute 'lua vim.lsp.buf.formatting()']])

	-- Elias config
	-- commands
	u.buf_command(bufnr, "LspHover", vim.lsp.buf.hover)
	u.buf_command(bufnr, "LspDiagPrev", vim.diagnostic.goto_prev)
	u.buf_command(bufnr, "LspDiagNext", vim.diagnostic.goto_next)
	u.buf_command(bufnr, "LspDiagLine", vim.diagnostic.open_float)
	u.buf_command(bufnr, "LspDiagQuickfix", vim.diagnostic.setqflist)
	u.buf_command(bufnr, "LspSignatureHelp", vim.lsp.buf.signature_help)
	u.buf_command(bufnr, "LspTypeDef", vim.lsp.buf.type_definition)
	u.buf_command(bufnr, "LspRangeAct", vim.lsp.buf.range_code_action)
	-- not sure why this is necessary?
	u.buf_command(bufnr, "LspRename", function()
		vim.lsp.buf.rename()
	end)

	-- bindings
	u.buf_map(bufnr, "n", "gi", ":LspRename<CR>") -- Rename variable
	u.buf_map(bufnr, "n", "K", ":LspHover<CR>") -- Hover equivalent of VScode
	u.buf_map(bufnr, "n", "<Leader>a", ":LspDiagLine<CR>") -- Tell me what's wrong
	u.buf_map(bufnr, "n", "[a", ":LspDiagPrev<CR>") -- Prev what's wrong
	u.buf_map(bufnr, "n", "]a", ":LspDiagNext<CR>") -- Next what's wrong
	u.buf_map(bufnr, "i", "<C-x><C-x>", "<cmd> LspSignatureHelp<CR>")

	u.buf_map(bufnr, "n", "gy", ":LspRef<CR>") -- go to reference
	u.buf_map(bufnr, "n", "gh", ":LspTypeDef<CR>") -- go to definition
	u.buf_map(bufnr, "n", "gd", ":LspDef<CR>") -- go to declation
	u.buf_map(bufnr, "n", "ga", ":LspAct<CR>")
	u.buf_map(bufnr, "v", "ga", "<Esc><cmd> LspRangeAct<CR>")

	-- Format code
	u.buf_map(bufnr, "n", "<leader>lf", "<cmd>lua vim.lsp.buf.formatting()<cr>")

	-- Format on save
	if client.supports_method("textDocument/formatting") then
		vim.api.nvim_clear_autocmds({ group = augroup, buffer = bufnr })
		vim.api.nvim_create_autocmd("BufWritePre", {
			group = augroup,
			buffer = bufnr,
			callback = function()
				-- on 0.8, you should use vim.lsp.buf.format({ bufnr = bufnr }) instead
				vim.lsp.buf.formatting_sync()
			end,
		})
	end

	-- Sometimes when opening a file, it asks to select a language server.
	-- That's because the lsp is providing formatting and linting in addition to null-lsp.
	-- We can force to use null-lsp by default for spefic clients like this:
	if client.name == "tsserver" then
		client.resolved_capabilities.document_formatting = false
	end

	if client.name == "sumneko_lua" then
		client.resolved_capabilities.document_formatting = false
	end

	-- Illumiate
	require("illuminate").on_attach(client)
end

local capabilities = vim.lsp.protocol.make_client_capabilities()
capabilities = require("cmp_nvim_lsp").update_capabilities(capabilities)

for _, server in ipairs({
	-- Server lists with configuration options and including installation instructions
	-- https://github.com/neovim/nvim-lspconfig/blob/master/doc/server_configurations.md
	--
	"sumneko_lua",
	"cssls",
	-- "cssmodules_ls",
	-- "html",
	-- "marksman",
	"tsserver",
	"null-ls",
	-- "bashls",
	"jsonls",
	-- "yamlls",
}) do
	require("user.plugins.lsp.servers." .. server).setup(on_attach, capabilities)
end
