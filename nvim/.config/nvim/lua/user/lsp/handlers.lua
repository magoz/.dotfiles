local u = require("user.utils")

local status_which_key_ok, wk = pcall(require, "which-key")
if not status_which_key_ok then
	return
end

local status_cmp_ok, cmp_nvim_lsp = pcall(require, "cmp_nvim_lsp")
if not status_cmp_ok then
	return
end

local M = {}

--Enable (broadcasting) snippet capability for completion
-- Used by html, jsonls, cssls
-- https://github.com/neovim/nvim-lspconfig/blob/master/doc/server_configurations.md
M.capabilities = vim.lsp.protocol.make_client_capabilities()
M.capabilities.textDocument.completion.completionItem.snippetSupport = true
M.capabilities = cmp_nvim_lsp.default_capabilities(M.capabilities)

M.setup = function()
	local signs = {

		{ name = "DiagnosticSignError", text = "" },
		{ name = "DiagnosticSignWarn", text = "" },
		{ name = "DiagnosticSignHint", text = "" },
		{ name = "DiagnosticSignInfo", text = "" },
	}

	for _, sign in ipairs(signs) do
		vim.fn.sign_define(sign.name, { texthl = sign.name, text = sign.text, numhl = "" })
	end

	local config = {
		virtual_text = false, -- disable virtual text
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

	vim.diagnostic.config(config)

	vim.lsp.handlers["textDocument/hover"] = vim.lsp.with(vim.lsp.handlers.hover, {
		border = "rounded",
	})

	vim.lsp.handlers["textDocument/signatureHelp"] = vim.lsp.with(vim.lsp.handlers.signature_help, {
		border = "rounded",
	})
end

local function lsp_keymaps(bufnr)
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
			f = { "<cmd>lua vim.lsp.buf.format({ async = true })<cr>", "Format code" },
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
end

-- Format on save
-- Avoiding LSP formatting conflicts
-- https://github.com/jose-elias-alvarez/null-ls.nvim/wiki/Avoiding-LSP-formatting-conflicts
local lsp_formatting = function(bufnr)
	vim.lsp.buf.format({
		filter = function(client)
			-- apply whatever logic you want (in this example, we'll only use null-ls)
			return client.name == "null-ls"
		end,
		bufnr = bufnr,
	})
end

-- if you want to set up formatting on save, you can use this as a callback
local augroup = vim.api.nvim_create_augroup("LspFormatting", {})

M.on_attach = function(client, bufnr)
	-- if client.name == "tsserver" then
	-- 	client.server_capabilities.documentFormattingProvider = false
	-- end
	--
	-- if client.name == "sumneko_lua" then
	-- 	client.server_capabilities.documentFormattingProvider = false
	-- end

	-- keymaps
	lsp_keymaps(bufnr)

	-- Format on save
	-- https://github.com/jose-elias-alvarez/null-ls.nvim/wiki/Formatting-on-save
	if client.supports_method("textDocument/formatting") then
		vim.api.nvim_clear_autocmds({ group = augroup, buffer = bufnr })
		vim.api.nvim_create_autocmd("BufWritePre", {
			group = augroup,
			buffer = bufnr,
			callback = function()
				lsp_formatting(bufnr)
			end,
		})
	end

	-- illuminate
	local illuminate_status_ok, illuminate = pcall(require, "illuminate")
	if not illuminate_status_ok then
		return
	end
	illuminate.on_attach(client)
end

return M
