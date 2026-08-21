#!/usr/bin/env bash
export AGENT_INSTALL_NO_CRON=1
# Exercises bin/agent-brief (3 hook events, dedupe, throttle, silence), bin/install (idempotent, no key in config),
# and bin/agent-upgrade against local fixtures. No network.
set -u; cd "$(dirname "$0")/.."
tmp=$(mktemp -d); srv=""
trap 'rm -rf "$tmp"; [ -n "$srv" ] && kill $srv 2>/dev/null' EXIT
mkdir -p "$tmp/am"; echo am_test > "$tmp/am/key"; echo test-agent@agentmail.to > "$tmp/am/inbox"
port=$(( 20000 + RANDOM % 20000 ))
( cd test/fixtures && python3 -c '
import http.server,socketserver,sys
class H(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200); self.send_header("Content-Type","application/json"); self.end_headers()
        self.wfile.write(open("threads.json","rb").read())
    def log_message(self,*a): pass
socketserver.TCPServer.allow_reuse_address=True
socketserver.TCPServer(("127.0.0.1",int(sys.argv[1])),H).serve_forever()' "$port" ) & srv=$!
sleep 0.5
api="http://127.0.0.1:$port"
ev() { printf '{"hook_event_name":"%s","session_id":"s1","cwd":"/tmp"}' "$1"; }
export AGENTMAIL_HOME="$tmp/am" AGENTMAIL_API="$api" AGENT_BRIEF_MIN_INTERVAL=300 AGENT_BRIEF_UPGRADE_INTERVAL=999999 AGENT_BRIEF_NO_NOTIFY=1 AGENT_BRIEF_NO_UPGRADE=1
# never let the brief upgrade the repo under test (it once did — and overwrote uncommitted work)
date +%s > "$tmp/am/.upgrade-stamp"

# 1. SessionStart: JSON with additionalContext naming the needs-human thread, not the processed one, with an offer
out=$(ev SessionStart | bin/agent-brief)
echo "$out" | python3 -c '
import json,sys; d=json.load(sys.stdin); h=d["hookSpecificOutput"]; c=h["additionalContext"]
assert h["hookEventName"]=="SessionStart", h
assert "dataset access" in c, c
assert "weekly notes" not in c, c
assert "work through" in c, c
assert "[INTRO] test-agent" in c and "facilitator-agent@agentmail.to" in c, ("reply to our own thread must count as new", c)
assert "question for maya" not in c, ("thread we sent last must not be new", c)
' || { echo "FAIL: SessionStart brief: $out"; exit 1; }
# 2. throttle: immediately again → nothing
out2=$(ev UserPromptSubmit | bin/agent-brief); [ -z "$out2" ] || { echo "FAIL: not throttled: $out2"; exit 1; }
# 3. after the interval, same threads → new-mail lines are deduped, but the needs-human thread nags again
echo 0 > "$tmp/am/.brief-stamp"
out3=$(ev UserPromptSubmit | bin/agent-brief)
echo "$out3" | python3 -c '
import json,sys; c=json.load(sys.stdin)["hookSpecificOutput"]["additionalContext"]
assert "dataset access" in c, ("needs-human must re-appear every brief", c)
assert "[INTRO] test-agent" not in c, ("new-mail line must be deduped", c)
' || { echo "FAIL: needs-human nag / dedupe: $out3"; exit 1; }
# 4. cron handled-count is reported once, then reset
echo 0 > "$tmp/am/.brief-stamp"; python3 -c "import json;json.dump({'ts':1,'handled':2,'fail_ts':0},open('$tmp/am/cron-state.json','w'))"
out4=$(ev PostToolUse | bin/agent-brief)
echo "$out4" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["hookSpecificOutput"]["hookEventName"]=="PostToolUse"; assert "background pass handled 2" in d["hookSpecificOutput"]["additionalContext"]' || { echo "FAIL: handled line: $out4"; exit 1; }
python3 -c "import json;assert json.load(open('$tmp/am/cron-state.json'))['handled']==0" || { echo "FAIL: handled not reset"; exit 1; }
# 5. no key: silent exit 0
mv "$tmp/am/key" "$tmp/am/key.bak"; out5=$(ev SessionStart | bin/agent-brief); rc=$?
[ $rc -eq 0 ] && [ -z "$out5" ] || { echo "FAIL: no-key should be silent exit 0"; exit 1; }; mv "$tmp/am/key.bak" "$tmp/am/key"
# 6. API down: silent exit 0
rm -f "$tmp/am/brief-state.json" "$tmp/am/.brief-stamp"; out6=$(ev SessionStart | AGENTMAIL_API="http://127.0.0.1:1" bin/agent-brief); rc=$?
[ $rc -eq 0 ] && [ -z "$out6" ] || { echo "FAIL: api-down should be silent exit 0"; exit 1; }
# 7. no stdin at all (manual run): still works, plain text
rm -f "$tmp/am/brief-state.json" "$tmp/am/.brief-stamp" "$tmp/am/cron-state.json"; out7=$(bin/agent-brief </dev/null); echo "$out7" | grep -q 'dataset access' || { echo "FAIL: manual run: $out7"; exit 1; }

# 8. install: hooks for 3 events, idempotent, user-scope MCP via a fake `claude`, inbox file from AGENTS.md
mkdir -p "$tmp/bin" "$tmp/repo"; cp -R bin .claude PROTOCOL.md "$tmp/repo/"; printf '# test-agent\n\n## Who I am\n\n- My inbox is **test-agent@agentmail.to**. It is the only address I send from.\n' > "$tmp/repo/AGENTS.md"; ln -s AGENTS.md "$tmp/repo/CLAUDE.md"
cat > "$tmp/bin/claude" <<'FAKE'
#!/usr/bin/env bash
# fake claude CLI: records `mcp add`, answers `mcp get`
log="${FAKE_CLAUDE_LOG:?}"
if [ "$1" = mcp ] && [ "$2" = get ]; then grep -q "add.*$3" "$log" 2>/dev/null && { echo "$3: stdio"; exit 0; } || { echo "No MCP server found with name: $3" >&2; exit 1; }; fi
echo "$*" >> "$log"; exit 0
FAKE
chmod +x "$tmp/bin/claude"; export FAKE_CLAUDE_LOG="$tmp/claude.log"; : > "$FAKE_CLAUDE_LOG"
s="$tmp/settings.json"; echo '{"model":"opus","hooks":{}}' > "$s"
r1=$(cd "$tmp/repo" && PATH="$tmp/bin:$PATH" CLAUDE_SETTINGS="$s" bin/install | tail -1)
r2=$(cd "$tmp/repo" && PATH="$tmp/bin:$PATH" CLAUDE_SETTINGS="$s" bin/install | tail -1)
[ "$r1" = "installed" ] && [ "$r2" = "installed" ] || { echo "FAIL: install: '$r1' / '$r2'"; exit 1; }
python3 - "$s" "$tmp/repo" <<'PY' || { echo "FAIL: settings shape"; exit 1; }
import json,sys; d=json.load(open(sys.argv[1])); repo=sys.argv[2]
assert d["model"]=="opus"
for ev in ("SessionStart","UserPromptSubmit","PostToolUse"):
    cmds=[h["command"] for e in d["hooks"][ev] for h in e["hooks"] if h["command"].endswith("bin/agent-brief")]
    assert len(cmds)==1, (ev,cmds)
    assert cmds[0].startswith(repo), cmds[0]
PY
grep -q "mcp add.*--scope user.*agentmail" "$FAKE_CLAUDE_LOG" || { echo "FAIL: mcp add not called: $(cat $FAKE_CLAUDE_LOG)"; exit 1; }
[ "$(grep -c 'mcp add' "$FAKE_CLAUDE_LOG")" = 1 ] || { echo "FAIL: mcp add not idempotent"; exit 1; }
grep -q "am_" "$s" && { echo "FAIL: key leaked into settings"; exit 1; }
[ "$(cat "$tmp/am/inbox")" = "test-agent@agentmail.to" ] || { echo "FAIL: inbox file"; exit 1; }
[ "$(cd "$tmp/repo" && CLAUDE_SETTINGS="$s" PATH="$tmp/bin:$PATH" bin/install --check)" = installed ] || { echo "FAIL: --check"; exit 1; }
(cd "$tmp/repo" && CLAUDE_SETTINGS="$s" PATH="$tmp/bin:$PATH" bin/install --uninstall >/dev/null)
python3 -c "import json; d=json.load(open('$s')); assert not any('agent-brief' in h['command'] for ev in d['hooks'].values() for e in ev for h in e['hooks']), d" || { echo "FAIL: uninstall left hooks"; exit 1; }

# 9. upgrade: from a local "upstream" tarball with a higher VERSION; AGENTS.md and roster.md untouched, kit files replaced, commit made
up="$tmp/upstream"; mkdir -p "$up"; cp -R bin .claude PROTOCOL.md README.md LICENSE .mcp.json test docs "$up/" 2>/dev/null; cp AGENTS.md "$up/AGENTS.md"
echo "9.9.9" > "$up/VERSION"; echo "# upstream protocol" > "$up/PROTOCOL.md"; printf "\n# upstream marker line to shift file offsets\n# and another\n" >> "$up/bin/agent-upgrade"
( cd "$tmp" && tar czf up.tgz -C "$tmp" upstream )
cd "$tmp/repo" && git init -q -b main && git -c user.name=t -c user.email=t@t commit -q --allow-empty -m init
echo "0.1.0" > VERSION; echo "my roster" > roster.md; echo "old" > bin/obsolete-tool; mkdir -p docs/oldsection && echo "x" > docs/oldsection/stale.md; git add -A && git -c user.name=t -c user.email=t@t commit -q -m base
printf 'template=file://%s\n' "$tmp/up.tgz" > .agent-kit
out9=$(AGENT_KIT_NO_PUSH=1 bin/agent-upgrade 2>&1); cd - >/dev/null
echo "$out9" | grep -qi "syntax error" && { echo "FAIL: agent-upgrade broke while overwriting itself: $out9"; exit 1; }
echo "$out9" | grep -q "upgrading agent kit 0.1.0 → 9.9.9" || { echo "FAIL: upgrade message: $out9"; exit 1; }
[ "$(cat "$tmp/repo/VERSION")" = "9.9.9" ] || { echo "FAIL: VERSION not updated"; exit 1; }
[ "$(cat "$tmp/repo/PROTOCOL.md")" = "# upstream protocol" ] || { echo "FAIL: PROTOCOL not replaced"; exit 1; }
[ "$(cat "$tmp/repo/roster.md")" = "my roster" ] || { echo "FAIL: roster clobbered"; exit 1; }
[ ! -e "$tmp/repo/bin/obsolete-tool" ] || { echo "FAIL: stale kit file not removed"; exit 1; }
[ ! -e "$tmp/repo/docs/oldsection" ] || { echo "FAIL: empty stale dir not removed"; exit 1; }
grep -q '{{AGENT_EMAIL}}' "$tmp/repo/AGENTS.md" && grep -q 'test-agent@' "$tmp/repo/AGENTS.md" || true
grep -q 'test-agent@agentmail.to' "$tmp/repo/AGENTS.md" || { echo "FAIL: AGENTS.md clobbered"; exit 1; }
[ -L "$tmp/repo/CLAUDE.md" ] || { echo "FAIL: CLAUDE.md symlink clobbered"; exit 1; }
(cd "$tmp/repo" && git log --oneline | grep -q "upgrade agent kit to 9.9.9") || { echo "FAIL: no upgrade commit"; exit 1; }
out9b=$(cd "$tmp/repo" && AGENT_KIT_NO_PUSH=1 bin/agent-upgrade); [ "$out9b" = "agent kit 9.9.9 is current" ] || { echo "FAIL: second upgrade: $out9b"; exit 1; }
# 10. validate-behaviors: one valid, one broken
vb="$tmp/vb"; mkdir -p "$vb/.agents/behaviors/review-request" "$vb/.agents/behaviors/bad-one"
printf -- '---\nname: review-request\ndescription: How to ask for a review.\n---\n# Review requests\n\n**Intent:** …\n' > "$vb/.agents/behaviors/review-request/BEHAVIOR.md"
printf -- '---\nname: other-name\ndescription: mismatch\n---\nbody\n' > "$vb/.agents/behaviors/bad-one/BEHAVIOR.md"
out10=$(bin/validate-behaviors "$vb" 2>&1); rc=$?
[ $rc -eq 1 ] && echo "$out10" | grep -q "ok   review-request" && echo "$out10" | grep -q "FAIL bad-one" || { echo "FAIL: validate-behaviors: $out10"; exit 1; }
rm -rf "$vb/.agents/behaviors/bad-one"; bin/validate-behaviors "$vb" >/dev/null || { echo "FAIL: validate-behaviors should pass"; exit 1; }

echo ok
