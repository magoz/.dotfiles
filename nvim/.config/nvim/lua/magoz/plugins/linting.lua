return {
	"mfussenegger/nvim-lint",
	config = function()
		local lint = require("lint")

		lint.linters_by_ft = {
			javascript = { "eslint" },
			typescript = { "eslint" },
			javascriptreact = { "eslint" },
			typescriptreact = { "eslint" },
			sh = { "shellcheck" },
		}

		lint.linters.eslint.cmd = "env"
		lint.linters.eslint.args = {
			"ESLINT_USE_FLAT_CONFIG=false", -- Remove this when we migrate to flat config
			"eslint",
			"--format",
			"json",
			"--stdin",
			"--stdin-filename",
			function()
				return vim.api.nvim_buf_get_name(0)
			end,
		}

		local lint_augroup = vim.api.nvim_create_augroup("lint", { clear = true })

		vim.api.nvim_create_autocmd({ "BufEnter", "BufWritePost", "InsertLeave" }, {
			group = lint_augroup,
			callback = function()
				lint.try_lint()
			end,
		})

		vim.keymap.set("n", "<leader>al", function()
			lint.try_lint()
		end, { desc = "Lint current file" })

		-- Add a command to check ESLint output directly
		vim.api.nvim_create_user_command("LintInfo", function()
			local current_file = vim.fn.expand("%:p")
			print("Running ESLint on " .. current_file)
			local cwd = vim.fn.getcwd()
			local cmd = string.format(
				"cd %s && ESLINT_USE_FLAT_CONFIG=false pnpx eslint %s",
				vim.fn.shellescape(cwd),
				vim.fn.shellescape(current_file)
			)
			local output = vim.fn.system(cmd)
			print(output)
		end, {})

		-- Add a command to check nvim-lint's ESLint configuration
		vim.api.nvim_create_user_command("LintConfig", function()
			print("ESLint configuration:")
			print("Command: " .. vim.inspect(lint.linters.eslint.cmd))
			print("Arguments: " .. vim.inspect(lint.linters.eslint.args))
		end, {})
	end,
}
