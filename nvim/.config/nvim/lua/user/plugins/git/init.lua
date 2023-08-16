require("user.plugins.git.gitsigns")

local wk_status_ok, wk = pcall(require, "which-key")
if not wk_status_ok then
	return
end

wk.register({
	gg = { "<cmd>LazyGit<CR>", "Lazy Git" },
	gd = { "<cmd>DiffviewFileHistory %<CR>", "Git File History via Diff View" }, -- via DiffView
	gD = { "<cmd>DiffviewClose<CR>", "Close Diff View" }, -- via DiffView
	gh = { "<cmd>0Gclog<CR>", "Git file history via Fugitive" }, -- via Fugitive
	gt = { "<cmd>Telescope git_bcommits<CR>", "Git preview file history via Telescope" }, -- via Telescope
}, { prefix = "<leader>" })
