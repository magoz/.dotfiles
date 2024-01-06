return {
	"dmmulroy/tsc.nvim",
	config = function()
		require("tsc").setup({
			auto_open_qflist = true,
		})
	end,
}
