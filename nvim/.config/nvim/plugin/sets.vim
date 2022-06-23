" Relative Numbers
set number relativenumber

" Scroll Offset
set scrolloff=8

" Mouse support
" set mouse=a

" Search Highlight as you type
set incsearch

" Remove Seach highlights after hitting enter
nnoremap <silent> <cr> :noh<CR><CR>

"" Search - case insensitive except when uppercase characters
set ignorecase
set smartcase

"Search - highlight current search
set hlsearch

" Indentation
set smarttab
set smartindent
set autoindent
set expandtab
set shiftwidth=2
set tabstop=2

" Treat words separated by dash as independant words
set iskeyword+=-

" Prevent adding new comment on next line when hitting enter
" https://vim.fandom.com/wiki/Disable_automatic_comment_insertion
autocmd FileType * setlocal formatoptions-=c formatoptions-=r formatoptions-=o

" History
set noswapfile
set nobackup
" set undodir=~/.vim/undodir
" set undofile

" Buffers
set hidden

" Errors
set noerrorbells




" Change cursor shape between insert and normal mode in tmux and iTerm
" https://gist.github.com/andyfowler/1195581
if exists('$TMUX')
  let &t_SI = "\<Esc>Ptmux;\<Esc>\<Esc>]50;CursorShape=1\x7\<Esc>\\"
  let &t_EI = "\<Esc>Ptmux;\<Esc>\<Esc>]50;CursorShape=0\x7\<Esc>\\"
else
    let &t_SI = "\<Esc>]50;CursorShape=1\x7"
    let &t_EI = "\<Esc>]50;CursorShape=0\x7"
endif

" This makes vscode very slow
" Turn indentation off when pasting code
" https://coderwall.com/p/if9mda/automatically-set-paste-mode-in-vim-when-pasting-in-insert-mode
" let &t_SI .= "\<Esc>[?2004h"
" let &t_EI .= "\<Esc>[?2004l"

" inoremap <special> <expr> <Esc>[200~ XTermPasteBegin()
" function! XTermPasteBegin()
  " set pastetoggle=<Esc>[201~
  " set paste
  " return ""
" endfunction