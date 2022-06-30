-- Based on
-- https://github.com/jose-elias-alvarez/dotfiles/blob/c645925651598ef296ce7c04f0f4dbbc4e3ee48d/config/nvim/lua/lsp/tsserver.lua

require("typescript")
-- require("typescript").setup({
--     -- disable_commands = false, -- prevent the plugin from creating Vim commands
--     debug = true , -- enable debug logging for commands
-- })
--


print('hey')

return {
  settings = {
    debug = true,
  },
}
--
-- local u = require("user.utils")
--
-- local M = {}
-- M.setup = function(on_attach, capabilities)
-- 	require("typescript").setup({
--     debug = true,
-- 		server = {
-- 			on_attach = function(client, bufnr)
-- 				u.buf_map(bufnr, "n", "<leader>ti", ":TypescriptAddMissingImports<CR>")
-- 				u.buf_map(bufnr, "n", "<leader>tr", ":TypescriptRemoveUnused<CR>")
-- 				u.buf_map(bufnr, "n", "<leader>to", ":TypescriptOrganizeImports<CR>")
-- 				u.buf_map(bufnr, "n", "<leader>tf", ":TypescriptFixAll<CR>")
-- 				u.buf_map(bufnr, "n", "<leader>tr", ":TypescriptRenameFile<CR>")
--
-- 				on_attach(client, bufnr)
-- 			end,
-- 			capabilities = capabilities,
-- 		},
-- 	})
-- end
--
-- return M
