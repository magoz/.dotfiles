return {
	"nvim-telescope/telescope.nvim",
	dependencies = {
		"nvim-lua/plenary.nvim",
		{ "nvim-telescope/telescope-fzf-native.nvim", build = "make" },
		"nvim-telescope/telescope-ui-select.nvim",
		"debugloop/telescope-undo.nvim",
	},
	config = function()
		local telescope = require("telescope")
		local actions = require("telescope.actions")
		local builtin = require("telescope.builtin")

		-- local select_one_or_multi = function(prompt_bufnr)
		-- 	local picker = require("telescope.actions.state").get_current_picker(prompt_bufnr)
		-- 	local multi = picker:get_multi_selection()
		-- 	if not vim.tbl_isempty(multi) then
		-- 		require("telescope.actions").close(prompt_bufnr)
		-- 		for _, j in pairs(multi) do
		-- 			if j.path ~= nil then
		-- 				vim.cmd(string.format("%s %s", "edit", j.path))
		-- 			end
		-- 		end
		-- 	else
		-- 		require("telescope.actions").select_default(prompt_bufnr)
		-- 	end
		-- end

		telescope.setup({
			defaults = {
				prompt_prefix = " ",
				selection_caret = " ",
				path_display = { truncate = 4 },

				mappings = {
					i = {
						["<Down>"] = actions.cycle_history_next,
						["<Up>"] = actions.cycle_history_prev,
						["<C-j>"] = actions.move_selection_next,
						["<C-k>"] = actions.move_selection_previous,
					},

					n = {
						["q"] = actions.close,
					},
				},
			},

			pickers = {
				find_files = {
					find_command = {
						"fd",
						"--hidden",
						"--no-ignore",
						"--exclude=.DS_Store",
						"--exclude=.git",
						"--exclude=node_modules",
						"--exclude=.next",
						"--type=file",
						"--type=symlink",
						"--follow", -- follow symlinks
					},
				},
			},

			extensions = {
				["ui-select"] = {
					require("telescope.themes").get_dropdown({}),
				},
				undo = {
					use_delta = true,
					saved_only = false,
				},
			},
		})

		-- Extensions
		telescope.load_extension("fzf")
		telescope.load_extension("ui-select")
		telescope.load_extension("undo")

		require("which-key").add({ "<leader>f", group = "Telescope" })

		vim.keymap.set("n", "<leader>ff", "<cmd>Telescope find_files<cr>", { desc = "Find Files" })
		vim.keymap.set("n", "<leader>fF", function()
			builtin.find_files({
				find_command = {
					"fd",
					"--hidden",
					"--no-ignore",
					"--exclude=.git",
					"--type=file",
					"--type=symlink",
					"--follow", -- follow symlinks
				},
			})
		end, { desc = "Find Files (hidden included)" })

		vim.keymap.set("n", "<leader>fc", "<cmd>Telescope live_grep<cr>", { desc = "Find file Contents" })
		vim.keymap.set("n", "<leader>fC", function()
			require("telescope.builtin").live_grep({
				additional_args = function(args)
					return vim.list_extend(args, { "--hidden", "--no-ignore" })
				end,
			})
		end, { desc = "Find file Contents (including hidden)" })

		vim.keymap.set("n", "<leader>fu", "<cmd>Telescope undo<cr>", { desc = "Find Undo" })
		vim.keymap.set("n", "<leader>fs", "<cmd>Telescope grep_string<cr>", { desc = "Find String under cursor" })
		vim.keymap.set("n", "<leader>fg", "<cmd>Telescope git_files<cr>", { desc = "Find Git files" })
		vim.keymap.set("n", "<leader>fb", "<cmd>Telescope buffers<cr>", { desc = "Find Buffers" })
		vim.keymap.set("n", "<leader>fq", "<cmd>Telescope quickfix<cr>", { desc = "Find Quick fix list" })
		vim.keymap.set("n", "<leader>fp", "<cmd>Telescope projects<cr>", { desc = "Find Projects" })
		vim.keymap.set("n", "<leader>fr", "<cmd>Telescope oldfiles<cr>", { desc = "Find wecent files" })

		vim.keymap.set("n", "<leader>as", function()
			require("telescope.builtin").spell_suggest(require("telescope.themes").get_cursor({}))
		end, { desc = "Spelling Suggestions" })
	end,
}
