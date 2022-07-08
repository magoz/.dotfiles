local wk = require("which-key")

local status_ok, toggleterm = pcall(require, "toggleterm")
if not status_ok then
	return
end

toggleterm.setup({
	size = 20,
	open_mapping = [[<c-\>]],
	hide_numbers = true,
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
	-- vim.api.nvim_buf_set_keymap(0, 't', '<esc>', [[<C-\><C-n>]], opts)
	vim.api.nvim_buf_set_keymap(0, "t", "<C-h>", [[<C-\><C-n><C-W>h]], opts)
	vim.api.nvim_buf_set_keymap(0, "t", "<C-j>", [[<C-\><C-n><C-W>j]], opts)
	vim.api.nvim_buf_set_keymap(0, "t", "<C-k>", [[<C-\><C-n><C-W>k]], opts)
	vim.api.nvim_buf_set_keymap(0, "t", "<C-l>", [[<C-\><C-n><C-W>l]], opts)
end

vim.cmd("autocmd! TermOpen term://* lua set_terminal_keymaps()")

local Terminal = require("toggleterm.terminal").Terminal
local lazygit = Terminal:new({ cmd = "lazygit", hidden = true })

function _LAZYGIT_TOGGLE()
	lazygit:toggle()
end

-- ---------------------------------
-- ----------- REMAPS --------------
-- ---------------------------------
wk.register({
	gg = { "<cmd>lua _LAZYGIT_TOGGLE()<CR>", "Toggle Lazy Git" },
	-- g = {
	-- 	name = "Go to..", -- group name
	-- 	r = { ":LspReferences<CR>", "Show References" },
	-- 	d = { ":LspDefinition<CR>", "Go to Definition" },
	-- 	D = { ":LspDeclaration<CR>", "Go to Declaration (not supported in ts/js/css)" },
	-- 	t = { ":LspTypeDefinition<CR>", "Go to Type Definition" },
	-- 	a = { ":LspAct<CR>", "LSP Act" }, -- Not sure what this does
	-- 	A = { "<Esc><cmd> LspRangeAct<CR>", "Actions (extract code, move to file, etc)", mode = "v" },
	-- },
}, { prefix = "<leader>" })

-- keymap("n", "<leader>gg", "<cmd>lua _LAZYGIT_TOGGLE()<CR>", opts)
