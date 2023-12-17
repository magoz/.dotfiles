-- Node 18 is not supported yet, so we are pointing to node 16 installed via brew, which is not the default
vim.g.copilot_node_command = "/usr/local/Cellar/node@16/16.16.0/bin/node"

-- Tab is used by cmp so we get the following error:
-- Copilot: <Tab> map has been disabled or is claimed by another plugin
-- This commands bypases the error, and we get no conflicts.
vim.g.copilot_assume_mapped = true
