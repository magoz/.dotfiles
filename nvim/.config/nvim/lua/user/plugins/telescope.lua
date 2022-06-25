local status_ok, telescope = pcall(require, "telescope")
if not status_ok then
  return
end

local actions = require "telescope.actions"

telescope.setup {
  defaults = {

    prompt_prefix = " ",
    selection_caret = " ",
    path_display = { "smart" },
    file_ignore_patterns = { ".git/", "node_modules" },

    mappings = {
      i = {
        ["<Down>"] = actions.cycle_history_next,
        ["<Up>"] = actions.cycle_history_prev,
        ["<C-j>"] = actions.move_selection_next,
        ["<C-k>"] = actions.move_selection_previous,
      },
    },
  },
}

-- ---------------------------------
-- ----------- REMAPS --------------
-- ---------------------------------
local keymap = vim.keymap.set
local opts = { silent = true }

-- keymap("n", "<leader>ff", "<cmd>lua require'telescope.builtin'.find_files()<cr>", opts)
keymap("n", "<leader>ff", ":Telescope find_files hidden=true <CR>", opts)
keymap("n", "<leader>fp", ":Telescope projects<CR>", opts)
keymap("n", "<leader>fb", ":Telescope buffers<CR>", opts)
keymap("n", "<leader>ft", ":Telescope live_grep<CR>", opts)
