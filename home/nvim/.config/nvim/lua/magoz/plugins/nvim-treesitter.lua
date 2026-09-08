return {
	{
		"nvim-treesitter/nvim-treesitter",
		branch = "main",
		lazy = false,
		build = ":TSUpdate",
		dependencies = {
			{ "windwp/nvim-ts-autotag", opts = {} },
		},
		config = function()
			local treesitter = require("nvim-treesitter")
			-- Prefer the new parsers and queries over legacy plugin-local installs.
			treesitter.setup({ install_dir = vim.fn.stdpath("data") .. "/site" })
			vim.treesitter.language.register("json", "jsonc")

			local indentexpr = "v:lua.require'nvim-treesitter'.indentexpr()"
			local function attach(buf)
				if not vim.api.nvim_buf_is_loaded(buf) then
					return
				end

				local ft = vim.bo[buf].filetype
				local previous = vim.b[buf].magoz_treesitter_filetype
				if previous and (previous ~= ft or vim.bo[buf].buftype ~= "") then
					vim.treesitter.stop(buf)
					-- A filetype plugin may already have removed its buffer mappings.
					pcall(vim.keymap.del, "n", "<C-space>", { buffer = buf })
					pcall(vim.keymap.del, "x", "<C-space>", { buffer = buf })
					pcall(vim.keymap.del, "x", "<BS>", { buffer = buf })
					if vim.bo[buf].indentexpr == indentexpr then
						vim.bo[buf].indentexpr = ""
					end
					vim.b[buf].magoz_treesitter_filetype = nil
				end
				if vim.bo[buf].buftype ~= "" then
					return
				end

				local lang = vim.treesitter.language.get_lang(ft)
				-- Unsupported filetypes and parsers still being installed use Vim syntax.
				if not lang or not vim.treesitter.language.add(lang) then
					return
				end

				vim.treesitter.start(buf, lang)
				if vim.treesitter.query.get(lang, "indents") then
					vim.bo[buf].indentexpr = indentexpr
				end
				vim.keymap.set({ "n", "x" }, "<C-space>", function()
					vim.treesitter.select("parent", vim.v.count1)
				end, { buffer = buf, desc = "Expand syntax selection" })
				vim.keymap.set("x", "<BS>", function()
					vim.treesitter.select("child", vim.v.count1)
				end, { buffer = buf, desc = "Shrink syntax selection" })
				vim.b[buf].magoz_treesitter_filetype = ft
			end

			vim.api.nvim_create_autocmd({ "FileType", "BufWinEnter" }, {
				group = vim.api.nvim_create_augroup("MagozTreesitter", { clear = true }),
				callback = function(event)
					attach(event.buf)
				end,
			})

			treesitter.install({
				"vimdoc",
				"vim",
				"lua",
				"javascript",
				"typescript",
				"tsx",
				"jsdoc",
				"prisma",
				"css",
				"scss",
				"html",
				"sql",
				"gitignore",
				"json",
				"json5",
				"markdown",
				"markdown_inline",
				"dockerfile",
				"regex",
				"bash",
				"make",
				"yaml",
				"toml",
				"glsl",
				"rust",
				"query",
			}):await(vim.schedule_wrap(function(err)
				if err then
					vim.notify("Treesitter installation failed: " .. tostring(err), vim.log.levels.ERROR)
					return
				end
				-- Bundled parsers may have cached missing queries during installation.
				vim.treesitter.query.get:clear()
				for _, buf in ipairs(vim.api.nvim_list_bufs()) do
					if vim.api.nvim_buf_is_loaded(buf) and vim.b[buf].magoz_treesitter_filetype then
						vim.treesitter.stop(buf)
					end
					attach(buf)
				end
			end))
		end,
	},
}
