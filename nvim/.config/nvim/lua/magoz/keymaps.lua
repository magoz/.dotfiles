-- Shorten function name
local keymap = vim.keymap.set
-- Silent keymap option
local opts = { silent = true }

-- Modes
--   normal_mode = "n",
--   insert_mode = "i",
--   visual_mode = "v",
--   visual_block_mode = "x",
--   term_mode = "t",
--   command_mode = "c",

local wk = require("which-key")
-- --------------------------------------------------
-- ---------------- Navigation ---------------------
-- --------------------------------------------------
vim.api.nvim_set_keymap(
	"n",
	"<leader>c",
	':let dir_path = expand("%:p:h") | execute "lcd" dir_path | echo "Current directory changed to " . dir_path<CR>',
	{ noremap = true, silent = false, expr = false, desc = "Change current directory to current file" }
)

-- Open current file in Finder
keymap("n", "<leader>o", ":!open -R %<CR>", { silent = true, desc = "Open in Finder" })

-- --------------------------------------------------
-- ------------------ Globals -----------------------
-- --------------------------------------------------
-- Ctrl+Z in Neovim is the default Unix behavior for job control, where Ctrl+Z suspends the current foreground process.
-- While this can be useful in some scenarios, it can indeed be annoying when working with Neovim. Let's disable it.
keymap("n", "<C-Z>", "<nop>", { noremap = true, silent = true })
keymap("i", "<C-Z>", "<nop>", { noremap = true, silent = true })
keymap("v", "<C-Z>", "<nop>", { noremap = true, silent = true })

-- --------------------------------------------------
-- ---------------- Normal Mode ---------------------
-- --------------------------------------------------
-- Move lines up and down
-- https://dockyard.com/blog/2013/09/26/vim-moving-lines-aint-hard
keymap("n", "<C-j>", "<ESC>:m .+1<CR>==", opts)
keymap("n", "<C-k>", "<ESC>:m .-2<CR>==", opts)

-- Duplicate lines up and down
keymap("n", "<C-h>", ":t-1<CR>==", opts)
keymap("n", "<C-l>", ":t.<CR>==", opts)

-- Center the cursor in view when navigating up and down
keymap("n", "<C-d>", "<C-d>zz")
keymap("n", "<C-u>", "<C-u>zz")

-- Center the cursor in view when searching, and moving to next instance with n and N
keymap("n", "n", "nzzzv")
keymap("n", "N", "Nzzzv")

-- Resize with arrows
keymap("n", "<C-Up>", ":resize -2<CR>", opts)
keymap("n", "<C-Down>", ":resize +2<CR>", opts)
keymap("n", "<C-Left>", ":vertical resize -2<CR>", opts)
keymap("n", "<C-Right>", ":vertical resize +2<CR>", opts)

-- Clear search highlights on double <ESC>
-- https://stackoverflow.com/a/19877212
-- We use which-key to hide the keymap from the help menu
-- keymap("n", "<ESC><ESC>", "<ESC>:nohlsearch<CR><ESC>", opts)
wk.add({ "<ESC><ESC>", "<ESC>:nohlsearch<CR><ESC>", hidden = true })

-- Remove Search highlights after hitting enter
keymap("n", "<cr>", ":noh<CR><CR>", opts)

-- Close buffers
keymap("n", "<S-q>", "<cmd>Bdelete!<CR>", opts)
keymap("n", "<S-q>", "<cmd>Bdelete!<CR>", opts)

-- --------------------------------------------------
-- ---------------- Insert Mode ---------------------
-- --------------------------------------------------
-- Move lines up and down
keymap("i", "<C-j>", "<ESC>:m .+1<CR>==gi", opts)
keymap("i", "<C-k>", "<ESC>:m .-2<CR>==gi", opts)

-- Duplicate lines up and down
keymap("i", "<C-h>", "<ESC> :t-1<CR>==i", opts)
keymap("i", "<C-l>", "<ESC> :t.<CR>==i", opts)

-- Press jj ,kk, jk to exit insert mode
keymap("i", "jj", "<ESC>", opts)
keymap("i", "kk", "<ESC>", opts)
keymap("i", "jk", "<ESC>", opts)

-- --------------------------------------------------
-- ---------------- Visual Mode ---------------------
-- --------------------------------------------------
-- Move lines up and down
keymap("v", "<C-j>", ":m '>+1<CR>gv=gv", opts)
keymap("v", "<C-k>", ":m '<-2<CR>gv=gv", opts)

-- Duplicate lines up and down
keymap("v", "<C-h>", ":t '<-1<CR>==", opts)
keymap("v", "<C-l>", ":t '>.<CR>==", opts)

-- Stay in indent mode
keymap("v", "<", "<gv", opts)
keymap("v", ">", ">gv", opts)

-- Better paste (don't replace clipboard with deleted text)
keymap("v", "p", '"_dP', opts)

-- --------------------------------------------------
-- --------------- Colon Commands -------------------
-- --------------------------------------------------
-- Make :W behave like :w
vim.api.nvim_create_user_command("W", "w", {})

-- --------------------------------------------------
-- --------------------------------------------------
-- --------------------------------------------------
-- ------------------ Plugins -----------------------
-- --------------------------------------------------
-- --------------------------------------------------
-- --------------------------------------------------

-- Git
wk.add({ "<leader>g", group = "Git" })

vim.keymap.set("n", "<leader>gg", "<cmd>LazyGit<CR>", { desc = "Lazy Git" })
vim.keymap.set("n", "<leader>gd", "<cmd>DiffviewFileHistory %<CR>", { desc = "Git File History via Diff View" }) -- via DiffView
vim.keymap.set("n", "<leader>gD", "<cmd>DiffviewClose<CR>", { desc = "Close Diff View" }) -- via DiffView
vim.keymap.set("n", "<leader>gh", "<cmd>0Gclog<CR>", { desc = "Git file history via Fugitive" }) -- via Fugitive
vim.keymap.set(
	"n",
	"<leader>gt",
	"<cmd>Telescope git_bcommits<CR>",
	{ desc = "Git preview file history via Telescope" }
) -- via Telescope

-- Undo
vim.keymap.set("n", "<leader>u", vim.cmd.UndotreeToggle)
