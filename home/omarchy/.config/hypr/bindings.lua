-- Keep only your personal keybinding overrides here. Add new bindings or
-- unbind defaults before replacing them.

-- See current bindings and descriptions:
--   omarchy menu keybindings --print

-- To disable every Omarchy default binding, set this in
-- ~/.config/hypr/hyprland.lua before require("default.hypr.omarchy"), then add
-- only the bindings you want below:
--   omarchy_default_bindings = false

-- To disable all preinstalled app/webapp bindings, set:
--   omarchy_preinstalled_bindings = false

-- Add a new binding.
-- o.bind("SUPER + SHIFT + R", "SSH", "alacritty -e ssh your-server")

-- Change an existing binding by unbinding it first, then binding the key again.
-- This example changes SUPER+SPACE from the launcher to the Omarchy root menu.
-- hl.unbind("SUPER + SPACE")
-- o.bind("SUPER + SPACE", "Omarchy menu", "omarchy-menu toggle root")

-- Disable a default binding without replacing it.
-- hl.unbind("SUPER + SHIFT + B")

-- Logitech MX Keys examples:
-- o.bind("SUPER + SHIFT + S", nil, "omarchy-capture-screenshot")
-- o.bind("SUPER + H", nil, "voxtype record toggle")
-- o.bind("SUPER + PERIOD", nil, "omarchy-shell shell toggle omarchy.emojis")

-- Brightness keys also drive LG UltraFine displays (USB HID, no DDC/CI); see brightness-display.
for _, key in ipairs({
  { "XF86MonBrightnessUp", "Brightness up", "+5%" },
  { "XF86MonBrightnessDown", "Brightness down", "5%-" },
  { "SHIFT + XF86MonBrightnessUp", "Brightness maximum", "100%" },
  { "SHIFT + XF86MonBrightnessDown", "Brightness minimum", "1%" },
  { "ALT + XF86MonBrightnessUp", "Brightness up precise", "+1%" },
  { "ALT + XF86MonBrightnessDown", "Brightness down precise", "1%-" },
}) do
  hl.unbind(key[1])
  o.bind(key[1], key[2], "brightness-display " .. key[3], { locked = true, repeating = true })
end

-- macOS-style F14 (down) / F15 (up), as on my ZMK keyboard's controls layer (github.com/magoz/sweep).
-- Bound by keycode: xkb maps F14/F15 to XF86Launch5/6 (evdev KEY_F14=184, KEY_F15=185, +8).
for _, key in ipairs({
  { "code:193", "Brightness up", "+5%" },
  { "code:192", "Brightness down", "5%-" },
  { "SHIFT + code:193", "Brightness maximum", "100%" },
  { "SHIFT + code:192", "Brightness minimum", "1%" },
  { "ALT + code:193", "Brightness up precise", "+1%" },
  { "ALT + code:192", "Brightness down precise", "1%-" },
}) do
  o.bind(key[1], key[2], "brightness-display " .. key[3], { locked = true, repeating = true })
end
