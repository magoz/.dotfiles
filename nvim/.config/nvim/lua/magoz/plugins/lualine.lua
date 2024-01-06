return {
	"nvim-lualine/lualine.nvim",
	dependencies = {
		"AndreM222/copilot-lualine",
	},
	config = function()
		local diagnostics = {
			"diagnostics",
			sources = { "nvim_diagnostic" },
			sections = { "error", "warn" },
			symbols = {
				hint = "󰌶 ",
				info = " ",
				warn = " ",
				error = " ",
			},
			colored = false,
			always_visible = true,
		}

		local filename = {
			"filename",
			file_status = true, -- Displays file status (readonly status, modified status)
			newfile_status = false, -- Display new file status (new file means no write after created)
			path = 4, -- 0: Just the filename
			-- 1: Relative path
			-- 2: Absolute path
			-- 3: Absolute path, with tilde as the home directory
			-- 4: Filename and parent dir, with tilde as the home directory

			shorting_target = 40, -- Shortens path to leave 40 spaces in the window
			-- for other components. (terrible name, any suggestions?)
			symbols = {
				modified = "[+]", -- Text to show when the file is modified.
				readonly = "[-]", -- Text to show when the file is non-modifiable or readonly.
				unnamed = "[No Name]", -- Text to show for unnamed buffers.
				newfile = "[New]", -- Text to show for newly created file before first write
			},
		}

		local location = {
			"location",
			padding = 0,
		}

		local copilot = {
			"copilot",
			symbols = {
				status = {
					icons = {
						enabled = "",
						disabled = "",
						warning = "",
						unknown = "",
					},
					hl = {
						enabled = "#50FA7B",
						disabled = "#6272A4",
						warning = "#FFB86C",
						unknown = "#FF5555",
					},
				},
				spinners = require("copilot-lualine.spinners").dots,
				spinner_color = "#6272A4",
			},
			show_colors = true,
			show_loading = true,
		}

		-- local diff = {
		-- 	"diff",
		-- 	colored = false,
		-- 	symbols = { added = "", modified = "", removed = "" }, -- changes diff symbols
		-- 	cond = hide_in_width,
		-- }
		--
		-- local filetype = {
		-- 	"filetype",
		-- 	icons_enabled = false,
		-- }

		-- local hide_in_width = function()
		-- 	return vim.fn.winwidth(0) > 80
		-- end

		-- local spaces = function()
		-- 	return "spaces: " .. vim.api.nvim_buf_get_option(0, "shiftwidth")
		-- end

		require("lualine").setup({
			options = {
				globalstatus = true,
				icons_enabled = true,
				theme = "auto",
				component_separators = { left = "", right = "" },
				section_separators = { left = "", right = "" },
				disabled_filetypes = { "alpha", "dashboard" },
				always_divide_middle = true,
			},
			sections = {
				lualine_a = { "branch" },
				lualine_b = { filename },
				lualine_c = { diagnostics },
				lualine_x = { copilot, "diff" },
				lualine_y = { location },
				lualine_z = { "progress" },
			},
		})
	end,
}
