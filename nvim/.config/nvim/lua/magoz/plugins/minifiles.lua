return {
	{
		"echasnovski/mini.files",
		version = false,
		keys = {
			{
				"<leader>e",
				function()
					local miniFiles = require("mini.files")
					local bufname = vim.api.nvim_buf_get_name(0)

					local path = vim.fn.fnamemodify(bufname, ":p")
					local is_dir = vim.fn.isdirectory(path) == 1
					local is_file = vim.fn.filereadable(path) == 1

					-- Noop if the buffer isn't valid.
					if path and (is_dir or is_file) then
						miniFiles.open(bufname, false)
						miniFiles.reveal_cwd()
					end
				end,
				desc = "File explorer with mini.files",
			},
		},
		opts = {
			content = {
				filter = function(entry)
					return entry.fs_type ~= "file" or entry.name ~= ".DS_Store"
				end,
				prefix = nil,
				-- In which order to show file system entries
				sort = nil,
			},

			-- Module mappings created only inside explorer.
			-- Use `''` (empty string) to not create one.
			mappings = {
				close = "q",
				go_in = "l",
				go_in_plus = "<CR>",
				go_out = "H",
				go_out_plus = "h",
				mark_goto = "'",
				mark_set = "m",
				reset = "<BS>",
				reveal_cwd = ".",
				show_help = "?",
				synchronize = "=",
				trim_left = "<",
				trim_right = ">",
			},

			options = {
				permanent_delete = true,
				use_as_default_explorer = true,
			},

			-- Customization of explorer windows
			windows = {
				-- Maximum number of windows to show side by side
				max_number = math.huge,
				-- Whether to show preview of file/directory under cursor
				preview = true,
				-- Width of focused window
				width_focus = 50,
				-- Width of non-focused window
				width_nofocus = 15,
				-- Width of preview window
				width_preview = 25,
			},
		},
	},
}
