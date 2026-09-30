-- Handles ocb://session/<id> links (e.g. "Open in terminal" on fleet.oox.sh):
-- opens a new Ghostty window running `ocb -s <id>` (OpenCode on Box).
on open location theURL
	set prefix to "ocb://session/"
	if theURL does not start with prefix then return
	set sessionID to text ((length of prefix) + 1) thru -1 of theURL
	if sessionID ends with "/" then set sessionID to text 1 thru -2 of sessionID
	if sessionID is "" then return
	-- OpenCode session ids are ses_ followed by letters and digits; reject anything else.
	if sessionID does not start with "ses_" then return
	set allowed to "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_"
	repeat with c in characters of sessionID
		if allowed does not contain (c as text) then return
	end repeat
	do shell script "open -na Ghostty.app --args -e /bin/zsh -lc " & quoted form of ("exec \"$HOME/.local/bin/ocb\" -s " & sessionID)
end open location
