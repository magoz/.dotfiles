local status_ok, project = pcall(require, "trouble")
if not status_ok then
	return
end

project.setup({
   position = "bottom"
})

-- ---------------------------------
-- ----------- REMAPS --------------
-- ---------------------------------
local keymap = vim.keymap.set
local opts = { silent = true }

keymap("n", "<leader>xx", "<cmd>Trouble<cr>", opts)
-- keymap("n", "<leader>x", "<cmd>Trouble workspace_diagnostics<CR>", opts)
keymap("n", "<leader>xq", "<cmd>Trouble quickfix<cr>", opts)
