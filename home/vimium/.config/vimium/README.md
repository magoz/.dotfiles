# Vimium

[`vimium.css`](vimium.css) is the canonical custom CSS for Vimium's UI.

Vimium does not read configuration from the filesystem. To apply the file:

1. Open Vimium's options page.
2. Expand **Advanced Options**.
3. Paste the file into **CSS for Vimium UI**.
4. Save the changes.

On macOS, copy it with:

```sh
pbcopy < ~/.config/vimium/vimium.css
```

Vimium stores this value as `userDefinedLinkHintCss` in `chrome.storage.sync`, so Chrome sync is the supported way to propagate it to other signed-in browser profiles and machines. Vimium does not expose a CLI or managed-storage policy for this setting. Editing Chrome's internal extension LevelDB directly would require Chrome to be stopped and is intentionally avoided because that storage format is not a stable interface.
