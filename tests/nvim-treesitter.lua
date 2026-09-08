-- Run from the repository root after installing the configured plugins/parsers:
-- nvim --headless -u NONE -l tests/nvim-treesitter.lua
local function run()
	local data = vim.fn.stdpath("data")
	vim.opt.runtimepath:prepend(data .. "/lazy/nvim-treesitter")
	vim.opt.runtimepath:prepend(data .. "/lazy/nvim-ts-autotag")
	vim.cmd("runtime! plugin/filetypes.lua")
	vim.cmd("filetype plugin indent on")

	local spec = dofile("home/nvim/.config/nvim/lua/magoz/plugins/nvim-treesitter.lua")[1]
	assert(spec.branch == "main" and spec.lazy == false)
	assert(spec.build == ":TSUpdate")
	require("nvim-ts-autotag").setup(spec.dependencies[1].opts)

	-- Keep this regression test offline; capture the real config's install callback.
	local ts = require("nvim-treesitter")
	local install, complete, languages = ts.install
	ts.install = function(requested)
		languages = requested
		return {
			await = function(_, callback)
				complete = callback
			end,
		}
	end
	local get_range, get_node_text = vim.treesitter.get_range, vim.treesitter.get_node_text
	spec.config()
	ts.install = install
	assert(vim.treesitter.get_range == get_range and vim.treesitter.get_node_text == get_node_text)
	assert(not vim.list_contains(languages, "jsonc"))
	local installed = ts.get_installed("parsers")
	for _, lang in ipairs(languages) do
		assert(vim.list_contains(installed, lang), "Missing parser: " .. lang)
		vim.treesitter.language.add(lang)
		for _, query in ipairs({ "highlights", "indents", "injections" }) do
			vim.treesitter.query.get(lang, query)
		end
	end
	print("ok: all configured parsers and queries load without the legacy shim")

	local function buffer(ft, lines, buftype)
		local buf = vim.api.nvim_create_buf(true, false)
		vim.api.nvim_set_current_buf(buf)
		vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)
		vim.bo[buf].buftype = buftype or ""
		vim.bo[buf].filetype = ft
		return buf
	end
	local function keys(input)
		vim.api.nvim_feedkeys(vim.api.nvim_replace_termcodes(input, true, false, true), "xt", false)
	end
	local function selected()
		return vim.fn.getregion(vim.fn.getpos("v"), vim.fn.getpos("."), { type = vim.fn.mode() })
	end

	for ft, lines in pairs({
		lua = { "local value = 1 + 2" },
		typescript = { "const value: number = 42;" },
		typescriptreact = { "const element = <div>Hello</div>;" },
		html = { "<div>Hello</div>" },
		markdown = { "# Heading", "", "**bold**" },
		jsonc = { "{", "// A comment", '"enabled": true', "}" },
	}) do
		local buf = buffer(ft, lines)
		local parser = vim.treesitter.get_parser(buf)
		assert(not parser:parse()[1]:root():has_error(), ft .. " parse error")
		assert(vim.treesitter.highlighter.active[buf], ft .. " highlighting inactive")
		assert(vim.fn.maparg("<C-space>", "n", false, true).buffer == 1)
	end
	assert(vim.treesitter.language.get_lang("jsonc") == "json")
	print("ok: Lua, TypeScript, TSX, HTML, Markdown, and JSONC highlighting")

	buffer("lua", { "if true then", 'print("ok")', "end" })
	vim.bo.expandtab, vim.bo.shiftwidth = true, 2
	assert(vim.bo.indentexpr == "v:lua.require'nvim-treesitter'.indentexpr()")
	vim.cmd("normal! gg=G")
	assert(vim.api.nvim_buf_get_lines(0, 1, 2, false)[1] == '  print("ok")')
	print("ok: Treesitter indentation")

	buffer("lua", { "local value = 1 + 2" })
	vim.api.nvim_win_set_cursor(0, { 1, 7 })
	keys("<C-space>")
	local first = selected()
	assert(vim.deep_equal(first, { "value" }), vim.inspect(first))
	keys("<C-space>")
	assert(not vim.deep_equal(first, selected()), "Selection did not expand")
	keys("<BS>")
	assert(vim.deep_equal(first, selected()), "Selection did not shrink")
	keys("<Esc>")
	print("ok: native expand/shrink selection mappings")

	local unknown = buffer("magoz_unknown_filetype", { "plain text" })
	assert(not vim.treesitter.highlighter.active[unknown])
	assert(vim.fn.maparg("<C-space>", "n") == "")
	buffer("lua", { "local value = 1" }, "nofile")
	assert(vim.fn.maparg("<C-space>", "n") == "")
	print("ok: unsupported filetypes and special buffers stay untouched")

	for _, ft in ipairs({ "typescript", "html", "jsonc", "sh" }) do
		local buf = buffer(ft, { "" })
		assert(vim.treesitter.highlighter.active[buf])
		vim.bo[buf].filetype = "text"
		assert(not vim.treesitter.highlighter.active[buf], ft .. " highlighting survived filetype change")
		assert(vim.fn.maparg("<C-space>", "n") == "")
		assert(vim.fn.maparg("<C-space>", "x") == "")
		assert(vim.fn.maparg("<BS>", "x") == "")
		assert(vim.bo[buf].indentexpr ~= "v:lua.require'nvim-treesitter'.indentexpr()")
		vim.bo[buf].filetype = ft
		assert(vim.treesitter.highlighter.active[buf], ft .. " did not reattach")
	end
	print("ok: filetype changes remove old highlighting, indentation, and mappings")

	-- Simulate opening a supported file before its parser finishes installing.
	local add = vim.treesitter.language.add
	vim.treesitter.language.add = function(lang, ...)
		if lang == "typescript" then
			return nil, "parser not installed yet"
		end
		return add(lang, ...)
	end
	local pending = buffer("typescript", { "const value: number = 1;" })
	assert(not vim.treesitter.highlighter.active[pending])
	vim.treesitter.language.add = add
	complete(nil, true)
	assert(vim.wait(1000, function()
		return vim.treesitter.highlighter.active[pending] ~= nil
	end), "Pending buffer was not attached after installation")
	print("ok: buffers opened before parser installation are attached on completion")

	-- A bundled parser can start highlighting before plugin queries are installed.
	local get_files = vim.treesitter.query.get_files
	vim.treesitter.query.get_files = function(lang, query, ...)
		if lang == "lua" and (query == "indents" or query == "highlights") then
			return {}
		end
		return get_files(lang, query, ...)
	end
	vim.treesitter.query.get:clear("lua", "indents")
	vim.treesitter.query.get:clear("lua", "highlights")
	local bundled = buffer("lua", { "local value = 1" })
	local old_highlighter = vim.treesitter.highlighter.active[bundled]
	assert(old_highlighter)
	assert(not vim.treesitter.query.get("lua", "indents"))
	assert(not vim.treesitter.query.get("lua", "highlights"))
	vim.treesitter.query.get_files = get_files
	complete(nil, true)
	assert(vim.wait(1000, function()
		return vim.bo[bundled].indentexpr == "v:lua.require'nvim-treesitter'.indentexpr()"
	end), "Cached missing indentation query survived installation")
	assert(vim.treesitter.query.get("lua", "highlights"))
	assert(vim.treesitter.highlighter.active[bundled] ~= old_highlighter)
	print("ok: installing queries refreshes cached misses and existing highlighting")

	for _, ft in ipairs({ "html", "typescriptreact" }) do
		buffer(ft, { "" })
		keys("i<div>")
		assert(vim.api.nvim_get_current_line() == "<div></div>", vim.api.nvim_get_current_line())
		keys("0lcwspan<Esc>")
		assert(vim.api.nvim_get_current_line() == "<span></span>", vim.api.nvim_get_current_line())
	end
	print("ok: standalone autotag closes and renames HTML/TSX tags")
end

local ok, err = xpcall(run, debug.traceback)
if not ok then
	io.stderr:write(tostring(err) .. "\n")
	vim.cmd("cquit 1")
end
vim.cmd("qa!")
