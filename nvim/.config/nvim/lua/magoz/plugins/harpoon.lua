local wk = require("which-key")

wk.register({
	h = {
		name = "Harpoon", -- optional group name
		a = { "<cmd>lua require('harpoon.mark').add_file()<CR>", "Add mark to Harpoon" },
		l = { "<cmd>lua require('harpoon.ui').toggle_quick_menu()<CR>", "Toggle Harpoon Menu" },
		n = { "<cmd>lua require('harpoon.ui').nav_next()<CR>", "Go to next mark" },
		p = { "<cmd>lua require('harpoon.ui').nav_prev()<CR>", "Go to previous mark" },
	},
}, { prefix = "<leader>" })
