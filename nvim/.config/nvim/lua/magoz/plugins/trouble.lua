local wk = require("which-key")

local status_ok, project = pcall(require, "trouble")
if not status_ok then
	return
end

project.setup({
	position = "bottom",
})

-- ---------------------------------
-- ----------- REMAPS --------------
-- ---------------------------------
wk.register({
	i = {
		i = { "<cmd>Trouble<CR>", "Show issues via Trouble" },
		a = { "<cmd>Trouble workspace_diagnostics<CR>", "Trouble all files" },
		f = { "<cmd>Trouble quickfix<CR>", "Trouble quickfix" },
	},
}, { prefix = "<leader>" })
