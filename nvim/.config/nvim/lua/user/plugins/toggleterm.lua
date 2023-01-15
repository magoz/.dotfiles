local wk = require("which-key")

local status_ok, toggleterm = pcall(require, "toggleterm")
if not status_ok then
	return
end

toggleterm.setup({
	size = 20,
	hide_numbers = true,
	open_mapping = [[<c-\>]],
	shade_terminals = true,
	shading_factor = 2,
	start_in_insert = true,
	insert_mappings = true,
	persist_size = true,
	direction = "float",
	close_on_exit = true,
	shell = vim.o.shell,
	float_opts = {
		border = "curved",
	},
})

function _G.set_terminal_keymaps()
	local opts = { noremap = true }
	-- We use <esc><esc> to close terminal floating window because a single <esc> is used by the terminal Vi mode.
	vim.api.nvim_buf_set_keymap(0, "t", "<esc><esc>", [[<C-\><C-o>:ToggleTerm<CR>]], opts)
	-- vim.api.nvim_buf_set_keymap(0, "t", "<C-h>", [[<C-\><C-n><C-W>h]], opts)
	-- vim.api.nvim_buf_set_keymap(0, "t", "<C-j>", [[<C-\><C-n><C-W>j]], opts)
	-- vim.api.nvim_buf_set_keymap(0, "t", "<C-k>", [[<C-\><C-n><C-W>k]], opts)
	-- vim.api.nvim_buf_set_keymap(0, "t", "<C-l>", [[<C-\><C-n><C-W>l]], opts)
end

vim.cmd("autocmd! TermOpen term://*toggleterm#* lua set_terminal_keymaps()")

local Terminal = require("toggleterm.terminal").Terminal
local lazygit = Terminal:new({
	cmd = "lazygit",
	hidden = true,
	direction = "float",
	float_opts = {
		-- width = function()
		-- 	return math.ceil(vim.o.columns * 0.95)
		-- end,
		width = 100000,
		height = 100000,
	},
})

function _LAZYGIT_TOGGLE()
	lazygit:toggle()
end

-- ---------------------------------
-- ----------- REMAPS --------------
-- ---------------------------------
wk.register({
	s = { "<cmd>:ToggleTerm<CR>", "Toggle Shell" },
	gg = { "<cmd>lua _LAZYGIT_TOGGLE()<CR>", "Toggle Lazy Git" },
}, { prefix = "<leader>" })
