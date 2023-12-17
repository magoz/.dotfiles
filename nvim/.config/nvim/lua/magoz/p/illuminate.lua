return {
	"RRethy/vim-illuminate",
	config = function()
		require("illuminate").configure({
			active = true,
			on_config_done = nil,
			options = {
				large_file_cutoff = 2000,
				large_file_overrides = {
					providers = { "lsp" },
				},
			},
		})
	end,
}
