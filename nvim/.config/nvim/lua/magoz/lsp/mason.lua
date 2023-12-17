local servers = {
	"lua_ls",
	"cssls",
	"cssmodules_ls",
	"html",
	"prismals",
	"tailwindcss",
	-- "markdownlint",
	"tsserver",
	"bashls",
	"jsonls",
	"yamlls",
}

local settings = {
	ui = {
		border = "none",
		icons = {
			package_installed = "◍",
			package_pending = "◍",
			package_uninstalled = "◍",
		},
	},
	log_level = vim.log.levels.INFO,
	max_concurrent_installers = 4,
}

local status_ok, mason = pcall(require, "mason")
if not status_ok then
	return
end

mason.setup(settings)
require("mason-lspconfig").setup({
	ensure_installed = servers,
	automatic_installation = true,
})

-- local lspconfig_status_ok, lspconfig = pcall(require, "lspconfig")
-- if not lspconfig_status_ok then
-- 	return
-- end

local on_attach = require("magoz.lsp.handlers").on_attach
local capabilities = require("magoz.lsp.handlers").capabilities

for _, server in pairs(servers) do
	-- opts = {
	-- 	on_attach = require("magoz.lsp.handlers").on_attach,
	-- 	capabilities = require("magoz.lsp.handlers").capabilities,
	-- }

	-- -- server = vim.split(server, "@")[1]
	--
	-- -- local require_ok, conf_opts = pcall(require, "magoz.lsp.servers." .. server)
	-- -- if require_ok then
	-- -- 	opts = vim.tbl_deep_extend("force", conf_opts, opts)
	-- -- end
	-- lspconfig[server].setup(opts)

	require("magoz.lsp.servers." .. server).setup(on_attach, capabilities)
end
