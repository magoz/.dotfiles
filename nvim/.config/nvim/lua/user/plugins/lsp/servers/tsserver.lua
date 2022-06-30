local u = require("user.utils")

local M = {}

M.setup = function(on_attach, capabilities)
    require("typescript").setup({
        server = {
            on_attach = function(client, bufnr)
                u.buf_map(bufnr, "n", "<leader>ti", ":TypescriptAddMissingImports<CR>")
                u.buf_map(bufnr, "n", "<leader>tr", ":TypescriptRemoveUnused<CR>")
                u.buf_map(bufnr, "n", "<leader>to", ":TypescriptOrganizeImports<CR>")
                u.buf_map(bufnr, "n", "<leader>tf", ":TypescriptFixAll<CR>")
                u.buf_map(bufnr, "n", "<leader>tr", ":TypescriptRenameFile<CR>")
                on_attach(client, bufnr)
            end,
            capabilities = capabilities,
        },
    })
end

return M
