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
				lualine_a = { "mode" },
				lualine_b = { "branch", "filename" },
				lualine_c = { diagnostics },
				lualine_x = { copilot, "diff" },
				lualine_y = { location },
				lualine_z = { "progress" },
			},
		})
	end,
}
