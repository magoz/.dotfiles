-- Based on:
-- https://github.com/LunarVim/nvim-basic-ide/blob/master/lua/user/plugins.lua

-- Automatically install packer
local install_path = vim.fn.stdpath("data") .. "/site/pack/packer/start/packer.nvim"
if vim.fn.empty(vim.fn.glob(install_path)) > 0 then
	PACKER_BOOTSTRAP = vim.fn.system({
		"git",
		"clone",
		"--depth",
		"1",
		"https://github.com/wbthomason/packer.nvim",
		install_path,
	})
	print("Installing packer close and reopen Neovim...")
	vim.cmd([[packadd packer.nvim]])
end

-- Autocommand that reloads neovim whenever you save the plugins.lua file
vim.cmd([[
  augroup packer_user_config
    autocmd!
    autocmd BufWritePost plugins.lua source <afile> | PackerSync
  augroup end
]])

-- Use a protected call so we don't error out on first use
local status_ok, packer = pcall(require, "packer")
if not status_ok then
	return
end

-- Have packer use a popup window
packer.init({
	display = {
		open_fn = function()
			return require("packer.util").float({ border = "rounded" })
		end,
	},
	git = {
		clone_timeout = 300, -- Timeout, in seconds, for git clones
	},
})

return packer.startup({
	function(use)
		use({ "wbthomason/packer.nvim" }) -- Have packer manage itself

		use({ "nvim-lua/plenary.nvim" }) -- Useful lua functions used by lots of plugins
		use({ "kyazdani42/nvim-web-devicons" }) -- ui dependency of many other plugins

		use({ "windwp/nvim-autopairs" }) -- Autopairs, integrates with both cmp and treesitter
		use({ "numToStr/Comment.nvim" })
		use({ "JoosepAlviste/nvim-ts-context-commentstring" })

		use({ "kyazdani42/nvim-tree.lua" })
		use({ "moll/vim-bbye" }) -- Delete buffers without closing nvim
		use({ "nvim-lualine/lualine.nvim" })
		use({ "akinsho/toggleterm.nvim" })
		use({ "ahmedkhalf/project.nvim" })
		use({ "lewis6991/impatient.nvim" })
		use({ "lukas-reineke/indent-blankline.nvim" })
		use({ "folke/which-key.nvim" }) -- show shortcuts
		use({ "goolord/alpha-nvim" }) -- display a screen when nvim opens
		use({ "RRethy/vim-illuminate" }) -- highlight the word or group of words under the cursor
		use({ "NvChad/nvim-colorizer.lua" }) -- dislay the color next to hex value
		use({ "kylechui/nvim-surround" }) -- add, change, and delete surrounding tags

		-- Writing mode
		use({ "Pocco81/true-zen.nvim" })

		-- Colorschemes
		use({ "folke/tokyonight.nvim" })
		use({ "lunarvim/darkplus.nvim" })

		-- cmp plugins
		use({ "hrsh7th/nvim-cmp" }) -- The completion plugin
		use({ "hrsh7th/cmp-buffer" }) -- buffer completions
		use({ "hrsh7th/cmp-path" }) -- path completions
		use({ "saadparwaiz1/cmp_luasnip" }) -- snippet completions
		use({ "hrsh7th/cmp-nvim-lsp" })
		use({ "hrsh7th/cmp-nvim-lua" })

		-- snippets
		use({ "L3MON4D3/LuaSnip" }) --snippet engine
		use({ "rafamadriz/friendly-snippets" }) -- a bunch of snippets to use

		-- LSP
		use({ "neovim/nvim-lspconfig" }) -- enable LSP
		use({ "williamboman/mason.nvim" })
		use({ "williamboman/mason-lspconfig.nvim" })
		--- LSP servers
		use({ "jose-elias-alvarez/typescript.nvim" }) -- Import all missing imports, refactor on move, etc.
		use({ "jose-elias-alvarez/null-ls.nvim" }) -- for formatters and linters

		use({ "b0o/schemastore.nvim" }) -- import json schemas from SchemaStore catalog
		use({ "folke/trouble.nvim" }) -- show diagnostics
		use({ "folke/neodev.nvim" }) -- previously named lua-dev

		-- Harpoon
		use({ "ThePrimeagen/harpoon" })

		-- Telescope
		use({ "nvim-telescope/telescope.nvim" })
		use({ "nvim-telescope/telescope-fzf-native.nvim", run = "make" })

		-- Treesitter
		use({ "nvim-treesitter/nvim-treesitter" })

		-- Git
		use({ "tpope/vim-fugitive" })
		use({ "lewis6991/gitsigns.nvim" })

		-- DAP
		use({ "mfussenegger/nvim-dap" })
		use({ "rcarriga/nvim-dap-ui" })
		use({ "ravenxrz/DAPInstall.nvim" })

		-- GITHUB COPILOT
		use({ "github/copilot.vim" }) -- Node.js v18 not supported yet

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

		-- Automatically set up your configuration after cloning packer.nvim
		if PACKER_BOOTSTRAP then
			require("packer").sync()
		end
	end,
	config = {
		display = {
			open_fn = function()
				-- return require('packer.util').float({ border = 'single' })
				return require("packer.util").float({ border = "rounded" })
			end,
		},
	},
})
