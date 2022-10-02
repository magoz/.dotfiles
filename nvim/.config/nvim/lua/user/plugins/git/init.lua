require("user.plugins.git.gitsigns")

local wk = require("which-key")

wk.register({
	gh = { "<cmd>Telescope git_bcommits<CR>", "Git preview file history" }, -- via Telescope
	gH = { "<cmd>0Gclog<CR>", "Git file history" }, -- via Fugitive
}, { prefix = "<leader>" })
