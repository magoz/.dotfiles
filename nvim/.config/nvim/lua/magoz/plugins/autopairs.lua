return {
	{
		"windwp/nvim-autopairs",
		config = function()
			require("nvim-autopairs").setup({
				check_ts = true, -- treesitter integration
				map_cr = false, -- apparently without this nvim-cmp crashes often
				disable_filetype = { "TelescopePrompt" },
			})

			-- TODO: Decide if this should live here, or in cmp, or elsewhere
			local cmp_autopairs = require("nvim-autopairs.completion.cmp")
			local cmp_status_ok, cmp = pcall(require, "cmp")
			if not cmp_status_ok then
				return
			end
			cmp.event:on("confirm_done", cmp_autopairs.on_confirm_done({}))
		end,
	},
}
