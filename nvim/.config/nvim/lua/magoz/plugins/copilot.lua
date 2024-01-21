return {
	{
		"zbirenbaum/copilot.lua",
		cmd = "Copilot",
		event = "InsertEnter",
		config = function()
			require("copilot").setup({
				suggestion = {
					enabled = true,
					auto_trigger = true,
					keymap = {
						accept = false, -- We are setting this in cmp. Otherwise we can't use tab in insert mode.
					},
				},
			})
		end,
	},
}
