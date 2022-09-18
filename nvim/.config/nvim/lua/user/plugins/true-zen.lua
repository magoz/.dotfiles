local wk = require("which-key")

local status_ok, true_zen = pcall(require, "true-zen")
if not status_ok then
	return
end

true_zen.setup({
	modes = { -- configurations per mode
		ataraxis = {
			minimum_writing_area = { -- minimum size of main window
				width = 80,
				height = 44,
			},
			padding = { -- padding windows
				left = 100,
				right = 100,
				top = 70,
				bottom = 70,
			},
		},
	},
})

-- ---------------------------------
-- ----------- REMAPS --------------
-- ---------------------------------
wk.register({
	z = { "<cmd>:TZAtaraxis<CR>", "Toggle Zen mode (Ataraxis)" },
}, { prefix = "<leader>" })
