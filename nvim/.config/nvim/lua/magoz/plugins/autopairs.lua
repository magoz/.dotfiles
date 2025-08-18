return {
	{
		"windwp/nvim-autopairs",
		event = "InsertEnter",
		config = function()
			require("nvim-autopairs").setup({
				check_ts = true, -- treesitter integration
				disable_filetype = { "TelescopePrompt" },
			})
		end,
	},
}
