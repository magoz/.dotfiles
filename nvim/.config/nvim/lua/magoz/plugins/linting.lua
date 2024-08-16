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

		local lint_augroup = vim.api.nvim_create_augroup("lint", { clear = true })

		vim.api.nvim_create_autocmd({ "BufEnter", "BufWritePost", "InsertLeave" }, {
			group = lint_augroup,
			callback = function()
				-- -- For monorepos
				-- -- https://github.com/mfussenegger/nvim-lint/issues/482#issuecomment-1999185606
				-- local get_clients = vim.lsp.get_clients or vim.lsp.get_active_clients
				-- local client = get_clients({ bufnr = 0 })[1] or {}
				-- lint.try_lint(nil, { cwd = client.root_dir })
				lint.try_lint()
			end,
		})

		vim.keymap.set("n", "<leader>al", function()
			lint.try_lint()
		end, { desc = "Lint current file" })
	end,
}
