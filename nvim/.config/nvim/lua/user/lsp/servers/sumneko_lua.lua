return {
	settings = {
		Lua = {
			diagnostics = {
				globals = { "vim" },
			},
			workspace = {
				library = {
					[vim.fn.expand("$VIMRUNTIME/lua")] = true,
					[vim.fn.stdpath("config") .. "/lua"] = true,
				},
			},
			telemetry = {
				enable = false,
			},
		},
	},
}
-- local settings = {
-- 	Lua = {
-- 		diagnostics = {
-- 			globals = {
-- 				"vim",
-- 				"use",
-- 				"describe",
-- 				"it",
-- 				"assert",
-- 				"before_each",
-- 				"after_each",
-- 			},
-- 		},
-- 		completion = {
-- 			showWord = "Disable",
-- 			callSnippet = "Disable",
-- 			keywordSnippet = "Disable",
-- 		},
-- 		workspace = {
-- 			checkThirdParty = false,
-- 			library = {
-- 				[vim.fn.stdpath("config") .. "/lua"] = true,
-- 				[vim.fn.expand("$VIMRUNTIME/lua")] = true,
-- 			},
-- 		},
-- 		telemetry = {
-- 			enable = false,
-- 		},
-- 	},
-- }
--
-- local M = {}
--
-- M.setup = function(on_attach, capabilities)
-- 	local luadev = require("lua-dev").setup({
-- 		lspconfig = {
-- 			on_attach = on_attach,
-- 			settings = settings,
-- 			flags = {
-- 				debounce_text_changes = 150,
-- 			},
-- 			capabilities = capabilities,
-- 		},
-- 	})
-- 	require("lspconfig").sumneko_lua.setup(luadev)
-- end