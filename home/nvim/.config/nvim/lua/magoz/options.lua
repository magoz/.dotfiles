-- Basics
vim.opt.fileencoding = "utf-8" -- the encoding written to a file
vim.opt.mouse = "a" -- allow the mouse to be used in neovim
vim.opt.termguicolors = true -- set term gui colors (most terminals support this)
vim.opt.clipboard = "unnamedplus" -- allows neovim to access the system clipboard

-- Navigation
vim.opt.scrolloff = 8 -- start scrolling before the cursor goes to the edge
vim.opt.sidescrolloff = 8 -- horizontal scroll

-- Lines
vim.opt.relativenumber = true
vim.opt.number = true -- set numbered lines
vim.opt.cursorline = true -- highlight the current line
vim.opt.wrap = false -- display lines as one long line
vim.opt.conceallevel = 0 -- so that `` is visible in markdown files

-- Spelling
vim.opt.spell = true
vim.opt.spelllang = { "en_us" }
vim.opt.spelloptions = "camel"

-- Search
vim.opt.hlsearch = true -- highlight all matches on previous search pattern
vim.opt.incsearch = true
vim.opt.ignorecase = true -- ignore case in search patterns
vim.opt.smartcase = true -- smart case

-- Indentation
vim.opt.smarttab = true
vim.opt.smartindent = true -- make indenting smarter
vim.opt.autoindent = true
vim.opt.expandtab = true -- convert tabs to spaces
vim.opt.shiftwidth = 2 -- the number of spaces inserted for each indentation
vim.opt.tabstop = 2 -- insert 2 spaces for a tab

-- Splits
vim.opt.splitbelow = true -- force all horizontal splits to go below current window
vim.opt.splitright = true -- force all vertical splits to go to the right of current window

-- Interface
vim.opt.showtabline = 0 -- hide tabs and buffers
vim.opt.cmdheight = 1 -- more space in the neovim command line for displaying messages
vim.opt.pumheight = 10 -- pop up menu height
vim.opt.signcolumn = "yes" -- always show the sign column, otherwise it would shift the text each time
vim.opt.numberwidth = 4 -- set number column width to 2 {default 4}
vim.opt.showmode = false -- we don't need to see things like -- INSERT -- anymore
vim.opt.showcmd = false
vim.opt.ruler = false
-- vim.opt.guifont = "monospace:h17"               -- the font used in graphical neovim applications
vim.opt.fillchars.eob = " "
vim.opt.laststatus = 3 -- Status bar

-- History
vim.opt.undofile = true -- enable persistent undo
vim.opt.backup = false -- creates a backup file
vim.opt.writebackup = false -- if a file is being edited by another program (or was written to file while editing with another program), it is not allowed to be edited
vim.opt.swapfile = false -- creates a swapfile

-- Performance
vim.opt.timeoutlen = 1000 -- time to wait for a mapped sequence to complete (in milliseconds)
vim.opt.updatetime = 300 -- faster completion (4000ms default)
