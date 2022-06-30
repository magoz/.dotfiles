local status_ok, lsp_installer = pcall(require, "nvim-lsp-installer")
if not status_ok then
  return
end

local servers = {
  "sumneko_lua",
  "cssls",
  "cssmodules_ls",
  "html",
  "marksman",
  -- "tsserver",
  "bashls",
  "jsonls",
  "yamlls",
}

lsp_installer.setup({
  automatic_installation = true
})

local lspconfig_status_ok, lspconfig = pcall(require, "lspconfig")
if not lspconfig_status_ok then
  return
end

local opts = {}

for _, server in pairs(servers) do
  opts = {
    on_attach = require("user.plugins.lsp.handlers").on_attach,
    capabilities = require("user.plugins.lsp.handlers").capabilities,
  }

  lspconfig[server].setup(opts)
end

