" -------------------------------
"           KEY REMAPS
" -------------------------------
noremap <leader>i :PlugInstall<cr>

" remap escape to jj
inoremap kk <Esc>
inoremap jj <Esc>
inoremap jk <Esc>

" Navigate up and down naturally (no weird line jump)
nmap j gj
nmap k gk

" MOVE LINES
" https://dockyard.com/blog/2013/09/26/vim-moving-lines-aint-hard
" Move lines in Normal mode
nnoremap <C-j> :m .+1<CR>==
nnoremap <C-k> :m .-2<CR>==

" Move lines in Insert mode
inoremap <C-j> <ESC>:m .+1<CR>==gi
inoremap <C-k> <ESC>:m .-2<CR>==gi

" Move lines in Visual mode
vnoremap <C-j> :m '>+1<CR>gv=gv
vnoremap <C-k> :m '<-2<CR>gv=gv

" DUPLICATE LINES
" https://www.quora.com/How-can-I-copy-the-previous-line-in-Vim-What-is-the-command-for-that
" Vim cannot map multiple modifiers at the same time
" https://stackoverflow.com/questions/1506764/how-to-map-ctrla-and-ctrlshifta-differently
" For this reason we are using <C-h> and <C-l> instead of the ideal <C-S-j> and <C-S-k>
" Duplicate lines in Normal mode
nnoremap <C-h> :t.<CR>==
nnoremap <C-l> :t-1<CR>==

" Duplicate lines in Insert mode
inoremap <C-h> <ESC> :t.<CR>==gi
inoremap <C-l> <ESC> :t-1<CR>==gi

" Duplicate lines in Visual mode
vnoremap <C-h> :t '>.<CR>==
vnoremap <C-l> :t '<-1<CR>==

" Make double-<Esc> clear search highlights
" https://stackoverflow.com/a/19877212
nnoremap <silent> <Esc><Esc> <Esc>:nohlsearch<CR><Esc>
