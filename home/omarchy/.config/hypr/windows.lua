-- Apps that open on fixed workspaces, mirroring AeroSpace on macOS (aerospace.toml on-window-detected).
-- Workspaces 5-7 (Photoshop, Illustrator, After Effects) are Mac-only apps.
o.window("^google-chrome$", { workspace = "1" })        -- Chrome web apps (chrome-*) are not matched
o.window("^com\\.mitchellh\\.ghostty$", { workspace = "2" })
o.window("^org\\.telegram\\.desktop$", { workspace = "8" })
o.window("^[sS]potify$", { workspace = "9" })
