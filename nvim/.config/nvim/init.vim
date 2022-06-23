" ------------------------------
"           LEADER
" ------------------------------
let mapleader = " "

" ------------------------------
"           PLUGINS
" ------------------------------

call plug#begin('~/.config/nvim/plugged')


" +++++++++++ THEMES +++++++++++

" Eldar
Plug 'agude/vim-eldar'

" Pencil
Plug 'reedes/vim-colors-pencil'


" +++++++++++ GENERAL +++++++++++

" ++++++ NAVIGATION +++++++
Plug 'nvim-treesitter/nvim-treesitter', {'do': ':TSUpdate'}

" ++++++ TELESCOPE +++++++
Plug 'nvim-lua/popup.nvim'
Plug 'nvim-lua/plenary.nvim'
Plug 'BurntSushi/ripgrep'
Plug 'nvim-telescope/telescope-fzy-native.nvim'
Plug 'nvim-telescope/telescope.nvim'

" Harpoon
Plug 'ThePrimeagen/harpoon'

" comment out code
Plug 'b3nj5m1n/kommentary'

" LSP
Plug 'neovim/nvim-lspconfig'

" ack / ag search
Plug 'mileszs/ack.vim'

" airline
Plug 'vim-airline/vim-airline'
Plug 'vim-airline/vim-airline-themes'

" sidebar files
" Plug 'scrooloose/nerdtree'
" Plug 'Xuyuanp/nerdtree-git-plugin'

" auto-pairs
Plug 'jiangmiao/auto-pairs'

" sorround
Plug 'tpope/vim-surround'

" ++++++ WRITING / MARKDOWN +++++++

" distraction Free
Plug 'junegunn/goyo.vim' 

" markdown
Plug 'iamcco/markdown-preview.nvim', { 'do': 'cd app & npm install'  }

" Wordy
Plug 'reedes/vim-wordy'


" ++++++ NEOVIM IN CHROME +++++++
" Plug 'glacambre/firenvim', { 'do': { _ -> firenvim#install(0) } }

call plug#end()
