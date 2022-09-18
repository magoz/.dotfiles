local wk = require("which-key")

local status_ok, true_zen = pcall(require, "true-zen")
if not status_ok then
	return
end

true_zen.setup()

-- ---------------------------------
-- ----------- REMAPS --------------
-- ---------------------------------
wk.register({
	z = { "<cmd>:TZAtaraxis<CR>", "Toggle Zen mode (Ataraxis)" },
}, { prefix = "<leader>" })
