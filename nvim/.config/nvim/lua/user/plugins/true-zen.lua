local status_ok, true_zen = pcall(require, "true-zen")
if not status_ok then
	return
end

local wk_status_ok, wk = pcall(require, "which-key")
if not wk_status_ok then
	return
end

local lualine_status_ok, lualine = pcall(require, "lualine")
if not lualine_status_ok then
	return
end

true_zen.setup({
	modes = { -- configurations per mode
		ataraxis = {
			minimum_writing_area = { -- minimum size of main window
				width = 80,
				height = 44,
			},
			padding = { -- padding windows
				left = 100,
				right = 100,
				top = 70,
				bottom = 70,
			},

			-- For some reason, Lualine is visible on ataraxis activation.
			-- https://github.com/Pocco81/true-zen.nvim/issues/110
			-- We are using this workaround until the issue gets fixed.
			callbacks = {
				open_pre = function()
					lualine.hide({})
				end,
				close_pre = function()
					lualine.hide({ unhide = true })
				end,
			},
		},
	},
})

-- ---------------------------------
-- ----------- REMAPS --------------
-- ---------------------------------
wk.register({
	z = { "<cmd>:TZAtaraxis<CR>", "Toggle Zen mode (Ataraxis)" },
}, { prefix = "<leader>" })
