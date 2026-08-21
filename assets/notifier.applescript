-- Compiled by bin/install into ~/.agentmail/<name>.app. Reads ~/.agentmail/notify.txt
-- (line 1 = title, line 2 = body, UTF-8) and posts a notification attributed to this app.
on run
	set p to (POSIX path of (path to home folder)) & ".agentmail/notify.txt"
	try
		set msg to read POSIX file p as «class utf8»
	on error
		return
	end try
	set ls to paragraphs of msg
	set t to item 1 of ls
	set b to ""
	if (count of ls) > 1 then set b to item 2 of ls
	display notification b with title t
	delay 1
end run
