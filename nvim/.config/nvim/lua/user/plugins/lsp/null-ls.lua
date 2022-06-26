-- Based on
-- https://github.com/LunarVim/nvim-basic-ide/blob/master/lua/user/lsp/null-ls.lua
-- https://www.youtube.com/watch?v=b7OguLuaYvE

local null_ls_status_ok, null_ls = pcall(require, "null-ls")
if not null_ls_status_ok then
  return
end

local formatting = null_ls.builtins.formatting
-- local diagnostics = null_ls.builtins.diagnostics

-- Reference
-- Formatting: https://github.com/jose-elias-alvarez/null-ls.nvim/tree/main/lua/null-ls/builtins
-- Completion: https://github.com/jose-elias-alvarez/null-ls.nvim/tree/main/lua/null-ls/builtins/completion
-- Diagnostics: https://github.com/jose-elias-alvarez/null-ls.nvim/tree/main/lua/null-ls/builtins/diagnostics
-- Hover: https://github.com/jose-elias-alvarez/null-ls.nvim/tree/main/lua/null-ls/builtins/hover

null_ls.setup {
  debug = true,
  sources = {
    formatting.prettier.with {
      extra_filetypes = { "toml" }
    },
    formatting.stylua,
  },
}
