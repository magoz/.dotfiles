return {
	"dmmulroy/tsc.nvim",
	config = function()
		require("tsc").setup({
			auto_open_qflist = true,
			flags = {
				build = true, -- make it work with monorepos/turborepo
			},
		})
	end,
}
