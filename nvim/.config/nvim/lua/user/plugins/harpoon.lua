-- ---------------------------------
-- ----------- REMAPS --------------
-- ---------------------------------
local keymap = vim.keymap.set
local opts = { silent = true }

keymap('n', '<leader>ha', '<cmd>lua require"harpoon.mark".add_file()<CR>', opts)
keymap('n', '<leader>hq', '<cmd>lua require"harpoon.ui".toggle_quick_menu()<CR>', opts)
keymap('n', '<leader>hn', '<cmd>lua require"harpoon.ui".nav_next()<CR>', opts)

-- vim('n', '<a-p>', '<cmd>lua require"illuminate".next_reference{reverse=true,wrap=true}<cr>', {noremap=true})
-- nnoremap <silent><leader>a :lua require('harpoon.mark').add_file()<cr>
-- nnoremap <silent><leader>q :lua require('harpoon.ui').toggle_quick_menu()<cr>
-- nnoremap <silent><leader>n :lua require('harpoon.ui').nav_next()<cr>
-- nnoremap <silent><leader>1 :lua require('harpoon.ui').nav_file(1)<cr>
-- nnoremap <silent><leader>2 :lua require('harpoon.ui').nav_file(2)<cr>
-- nnoremap <silent><leader>3 :lua require('harpoon.ui').nav_file(3)<cr>
-- nnoremap <silent><leader>4 :lua require('harpoon.ui').nav_file(4)<cr>
