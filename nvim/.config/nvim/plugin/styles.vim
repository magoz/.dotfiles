" ------------------------------
"         STYLE SETTINGS
" ------------------------------

" Use italics for comments
highlight Comment cterm=italic

" Use pencil theme for markdown files
" autocmd BufEnter * colorscheme default
" autocmd BufEnter *.md colorscheme pencil

" ------------------------------
"            THEMES
" ------------------------------

" +++++++ Eldar Theme ++++++++++
if has('syntax')
  " Override Eldar GUI colors
    let g:eldar_red_bright    = "#ff0000"
    let g:eldar_yellow        = "#ffff00"
    let g:eldar_green         = "#00ff00"
    let g:eldar_cyan          = "#00ffff"
    let g:eldar_blue          = "#0000ff"
    let g:eldar_magenta       = "#ff00ff"
    
    syntax enable             " Turn on syntax highlighting
    silent! colorscheme eldar " Custom color scheme
endif

" ++++++++ pencil Theme ++++++++
let g:pencil_terminal_italics = 1
" let g:pencil_spell_undercurl = 1
" colorscheme pencil
" set background=light

" +++++++++ airline themes ++++++
let g:airline_theme='simple'
" Buffer Separators
" let g:airline#extensions#tabline#enabled = 1
" let g:airline#extensions#tabline#left_sep = ' '
" let g:airline#extensions#tabline#left_alt_sep = '|'


" -------------------------------
"           MODES 
" -------------------------------

" Set Writing environment for .md files
augroup VimWriteMode
    au!
    autocmd FileType markdown colorscheme pencil
    autocmd FileType markdown set background=light
    autocmd FileType markdown setlocal spell spelllang=en_us
    autocmd FileType markdown set linebreak
    autocmd FileType markdown Goyo 70 
augroup END
