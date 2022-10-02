local wk = require("which-key")
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

local border_opts = { border = "single", focusable = false, scope = "line" }

lsp.handlers["textDocument/signatureHelp"] = lsp.with(lsp.handlers.signature_help, border_opts)
lsp.handlers["textDocument/hover"] = lsp.with(lsp.handlers.hover, border_opts)

-- Format on save
local augroup = vim.api.nvim_create_augroup("LspFormatting", {})

local on_attach = function(client, bufnr)
	-- COMMANDS
	-- Jump
	u.buf_command(bufnr, "LspReferences", vim.lsp.buf.references)
	u.buf_command(bufnr, "LspImplementation", vim.lsp.buf.implementation)
	u.buf_command(bufnr, "LspDeclaration", vim.lsp.buf.declaration)
	u.buf_command(bufnr, "LspDefinition", vim.lsp.buf.definition)
	u.buf_command(bufnr, "LspTypeDefinition", vim.lsp.buf.type_definition)

	-- Actions
	u.buf_command(bufnr, "LspHover", vim.lsp.buf.hover)
	u.buf_command(bufnr, "LspSignatureHelp", vim.lsp.buf.signature_help)
	u.buf_command(bufnr, "LspRename", function()
		vim.lsp.buf.rename()
	end)

	-- Issues / Diagnostics
	u.buf_command(bufnr, "LspDiagLine", vim.diagnostic.open_float)
	u.buf_command(bufnr, "LspDiagPrev", vim.diagnostic.goto_prev)
	u.buf_command(bufnr, "LspDiagNext", vim.diagnostic.goto_next)
	u.buf_command(bufnr, "LspDiagQuickfix", vim.diagnostic.setqflist)

	wk.register({
		j = {
			name = "Jump to..", -- group name
			i = { ":LspImplementation<CR>", "Implementation" },
			r = { ":Telescope lsp_references<CR>", "References" },
			d = { ":LspDefinition<CR>", "Definition" },
			D = { ":LspDeclaration<CR>", "Declaration (not supported in ts/js/css)" },
			t = { ":LspTypeDefinition<CR>", "Type Definition" },
		},
		a = {
			name = "Actions", -- group name
			h = { ":LspHover<CR>", "Hover" },
			-- h = { "<cmd> LspSignatureHaelp<CR>", "Show Signature Help" },
			f = { "<cmd>lua vim.lsp.buf.formatting()<cr>", "Format code" },
			r = { ":LspRename<CR>", "Rename Variable" },
			a = { ":lua vim.lsp.buf.code_action()<CR>", "Show Actions (extract code, move to file, etc)" },
			-- FIX: actions for when in visual mode
			-- A = {
			-- 	":lua vim.lsp.buf.range_code_action()<CR>",
			-- 	"Visual Mode Show Actions (extract code, move to file, etc)",
			-- },
		},
		i = {
			name = "Issues", -- group name
			d = { ":LspDiagLine<CR>", "Show Diagnostics" },
			n = { ":LspDiagNext<CR>", "Show Next Diagnostic" },
		},
	}, { prefix = "<leader>" })

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
	"cssmodules_ls",
	-- "html",
	-- "marksman",
	"tsserver",
	"null-ls",
	"bashls",
	"jsonls",
	"yamlls",
}) do
	require("user.plugins.lsp.servers." .. server).setup(on_attach, capabilities)
end
