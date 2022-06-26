local status_ok, lsp_installer = pcall(require, "nvim-lsp-installer")
if not status_ok then
  return
end

local servers = {
  "sumneko_lua",
  "cssls",
  "html",
  "eslint",
  "marksman",
  "tsserver",
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

  if server == "jsonls" then
    local jsonls_opts = require "user.plugins.lsp.settings.jsonls"
    opts = vim.tbl_deep_extend("force", jsonls_opts, opts)
  end

  if server == "sumneko_lua" then
    local sumneko_opts = require "user.plugins.lsp.settings.sumneko_lua"
    opts = vim.tbl_deep_extend("force", sumneko_opts, opts)
  end


  lspconfig[server].setup(opts)
end
