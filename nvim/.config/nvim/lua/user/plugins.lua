-- Automatically insatll Lazy
local lazypath = vim.fn.stdpath("data") .. "/lazy/lazy.nvim"
if not vim.loop.fs_stat(lazypath) then
	vim.fn.system({
		"git",
		"clone",
		"--filter=blob:none",
		"https://github.com/folke/lazy.nvim.git",
		"--branch=stable", -- latest stable release
		lazypath,
	})
end
vim.opt.rtp:prepend(lazypath)

-- Make sure to set `mapleader` before lazy so your mappings are correct
vim.g.mapleader = " "

require("lazy").setup({
	"nvim-lua/plenary.nvim", -- Useful lua functions used by lots of plugins
	"kyazdani42/nvim-web-devicons", -- ui dependency of many other plugins

	"windwp/nvim-autopairs", -- Autopairs, integrates with both cmp and treesitter
	"numToStr/Comment.nvim",
	"JoosepAlviste/nvim-ts-context-commentstring",

	"kyazdani42/nvim-tree.lua",
	"moll/vim-bbye", -- Delete buffers without closing nvim
	"nvim-lualine/lualine.nvim",
	"akinsho/toggleterm.nvim",
	"ahmedkhalf/project.nvim",
	"lewis6991/impatient.nvim",
	"lukas-reineke/indent-blankline.nvim",
	"folke/which-key.nvim", -- show shortcuts
	"goolord/alpha-nvim", -- display a screen when nvim opens
	"RRethy/vim-illuminate", -- highlight the word or group of words under the cursor
	"NvChad/nvim-colorizer.lua", -- dislay the color next to hex value
	"kylechui/nvim-surround", -- add, change, and delete surrounding tags

	-- Writing mode
	"Pocco81/true-zen.nvim",

	-- Colorschemes
	{
		"folke/tokyonight.nvim",
		lazy = false, -- make sure we load this during startup if it is your main colorscheme
		priority = 1000, -- make sure to load this before all the other start plugins
		config = function()
			-- load the colorscheme here
			vim.cmd([[colorscheme tokyonight]])
		end,
	},

	-- cmp plugins
	"hrsh7th/nvim-cmp", -- The completion plugin
	"hrsh7th/cmp-buffer", -- buffer completions
	"hrsh7th/cmp-path", -- path completions
	"saadparwaiz1/cmp_luasnip", -- snippet completions
	"hrsh7th/cmp-nvim-lsp",
	"hrsh7th/cmp-nvim-lua",

	-- snippets
	"L3MON4D3/LuaSnip", --snippet engine
	"rafamadriz/friendly-snippets", -- a bunch of snippets to use

	-- LSP
	"neovim/nvim-lspconfig", -- enable LSP
	"williamboman/mason.nvim",
	"williamboman/mason-lspconfig.nvim",
	--- LSP servers
	"jose-elias-alvarez/typescript.nvim", -- Import all missing imports, refactor on move, etc.
	"jose-elias-alvarez/null-ls.nvim", -- for formatters and linters

	"b0o/schemastore.nvim", -- import json schemas from SchemaStore catalog
	"folke/trouble.nvim", -- show diagnostics
	"folke/neodev.nvim", -- previously named lua-dev

	-- Harpoon
	"ThePrimeagen/harpoon",

	-- Telescope
	"nvim-telescope/telescope.nvim",
	-- { "nvim-telescope/telescope-fzf-native.nvim", build = "make" },

	-- Treesitter
	"nvim-treesitter/nvim-treesitter",

	-- Git
	"tpope/vim-fugitive",
	"lewis6991/gitsigns.nvim",

	-- DAP
	"mfussenegger/nvim-dap",
	"rcarriga/nvim-dap-ui",
	"ravenxrz/DAPInstall.nvim",

	-- GITHUB COPILOT
	"github/copilot.vim", -- Node.js v18 not supported yet

	-- copilot via cmp
	-- Right now is very early in development but there is way of integrating copilot with cmp
	-- The install is a bit clunky, and it didn't work well for me.
	-- TODO: review this in the future when it's more mature
	-- use({
	-- 	"zbirenbaum/copilot.lua",
	-- 	event = { "VimEnter" },
	-- 	config = function()
	-- 		vim.defer_fn(function()
	-- 			require("copilot").setup()
	-- 		end, 100)
	-- 	end,
	-- })
	-- use({ "zbirenbaum/copilot-cmp", module = "copilot_cmp" })
})

-- Based on:
-- https://github.com/LunarVim/nvim-basic-ide/blob/master/lua/user/plugins.lua
