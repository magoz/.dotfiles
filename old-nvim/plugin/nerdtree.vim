" ++++++++++++++ NerdTree ++++++++++++++++
" Show Hidden Files
let NERDTreeShowHidden=1
" Quit NerdTree on Open
let NERDTreeQuitOnOpen = 1
" Quit NerdTree if NerdTree is the last remaining window
autocmd bufenter * if (winnr("$") == 1 && exists("b:NERDTree") && b:NERDTree.isTabTree()) | q | endif
" Remove unnecessary UI
let NERDTreeMinimalUI = 1
let NERDTreeDirArrows = 1

" Open/Close Nerdtree
nnoremap <Leader>t :NERDTreeToggle<Enter>
