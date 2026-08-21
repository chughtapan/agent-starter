#!/usr/bin/env bash
# test/lint.sh — repo-wide checks. Add one function per check; call it at the bottom.
set -u
cd "$(dirname "$0")/.."
fail=0
check() { if eval "$2"; then echo "ok   $1"; else echo "FAIL $1"; fail=1; fi; }
# In an agent repo (AGENTS.md filled in) only the kit checks apply; template-text checks are for the template itself.
if grep -q '{{AGENT_NAME}}' AGENTS.md 2>/dev/null; then TEMPLATE=1; else TEMPLATE=0; echo "agent repo — kit checks only"; fi
tcheck() { [ "$TEMPLATE" = 1 ] && check "$@" || true; }

tcheck "README leads with the tell-your-Claude message" \
  "grep -q '^## Install — tell your Claude' README.md && grep -q 'gh repo create <myname>-agent --template chughtapan/agent-starter' README.md"
tcheck "README never sends mail as a human" \
  "! grep -qiE 'gmail connector|from your (own )?email' README.md"

tcheck "PROTOCOL defines exactly INTRO and NORM" "grep -q '\\[INTRO\\]' PROTOCOL.md && grep -q '\\[NORM\\]' PROTOCOL.md && ! grep -qE '\\[(REQ|INFO|BYE|ESC)\\]' PROTOCOL.md AGENTS.md .claude/skills/*/SKILL.md README.md docs/facilitator.md docs/byo-facilitator-contract.md"
check "example norms validate" "bin/validate-behaviors docs/examples/behaviors >/dev/null"
tcheck "PROTOCOL is wire-only (labels/policy live in the skills)" "! grep -qE 'needs-human|processed|CC your owner on every|Auto-Submitted' PROTOCOL.md"
check "inbox skill defines all labels" "(for l in processed replied needs-human intro-sent; do grep -q \"\$l\" .claude/skills/inbox/SKILL.md || exit 1; done)"
check "late joiners: send me the norms" "grep -q 'send me the norms' PROTOCOL.md .claude/skills/facilitate/SKILL.md .claude/skills/inbox/SKILL.md docs/byo-facilitator-contract.md && grep -q 'roster.md' .claude/skills/inbox/SKILL.md"
check "facilitator keeps roster + norms as Agent Behavior specs, author-only updates" "grep -q '.agents/behaviors' .claude/skills/facilitate/SKILL.md && grep -q 'BEHAVIOR.md' PROTOCOL.md && grep -q 'new member' .claude/skills/facilitate/SKILL.md && grep -qi 'only <author> can change' .claude/skills/facilitate/SKILL.md && ! grep -q 'norms.md' PROTOCOL.md .claude/skills/facilitate/SKILL.md"
check "agent-upgrade leaves .agents/ alone" "grep -q \"'./.agents/\\*'\" bin/agent-upgrade"
tcheck "PROTOCOL has no invented machinery" "! grep -qE 'agent-meta|X-Agent-Hop|message_count|12 messages' PROTOCOL.md AGENTS.md .claude/skills/*/SKILL.md"
tcheck "kit is portable (no team-specific names in core files)" "! grep -qi 'spike' PROTOCOL.md AGENTS.md README.md .claude/skills/*/SKILL.md"
tcheck "nothing runs in the cloud" "! grep -qiE 'cloud routine|/schedule|claude.ai/code/routines' README.md .claude/skills/*/SKILL.md AGENTS.md"

tcheck "AGENTS.md skeleton has every placeholder" \
  "(for p in AGENT_NAME AGENT_EMAIL OWNER_NAME OWNER_EMAIL PURPOSE AUTONOMY SINCE ROLE FACILITATOR_NAME FACILITATOR_EMAIL; do grep -q \"{{\$p}}\" AGENTS.md || exit 1; done)"
tcheck "AGENTS.md points at PROTOCOL and the skills" "grep -q 'PROTOCOL.md' AGENTS.md && grep -q 'skills/inbox' AGENTS.md"
check "BYO facilitator contract: duties + changes nothing else" "grep -q '\\[INTRO\\]' docs/byo-facilitator-contract.md && grep -q '\\[NORM\\]' docs/byo-facilitator-contract.md && grep -qi 'no other outbound' docs/byo-facilitator-contract.md && grep -qi 'changes nothing else' docs/byo-facilitator-contract.md"

check "bin/agent-brief + install + agent-upgrade" "bash test/agent-brief.test.sh >/dev/null 2>&1"
check "bin scripts are executable" "[ -x bin/agent-brief ] && [ -x bin/install ] && [ -x bin/agent-upgrade ] && [ -x bin/agentmail-mcp ] && [ -x bin/validate-behaviors ] && [ -x bin/agentmail ]"
check "VERSION and .agent-kit present" "grep -qE '^[0-9]+\\.[0-9]+\\.[0-9]+$' VERSION && grep -q '^template=' .agent-kit"
check "facilitator doc exists and skill keeps roster in repo" "grep -q 'roster.md' docs/facilitator.md && grep -q 'roster.md' .claude/skills/facilitate/SKILL.md"

for sk in onboard inbox digest facilitate; do
  check "skill $sk has frontmatter" "head -1 .claude/skills/$sk/SKILL.md | grep -q '^---' && grep -q \"^name: $sk\" .claude/skills/$sk/SKILL.md && grep -q '^description: Use when' .claude/skills/$sk/SKILL.md"
  check "skill $sk has no placeholders" "! grep -qE 'TBD|TODO' .claude/skills/$sk/SKILL.md"
  check "skill $sk names no headers argument" "! grep -qE 'headers=' .claude/skills/$sk/SKILL.md"
done
check "inbox skill: labels, needs-human, roster" "grep -q 'needs-human' .claude/skills/inbox/SKILL.md && grep -q 'NEEDS YOU' .claude/skills/inbox/SKILL.md && grep -q 'roster' .claude/skills/inbox/SKILL.md"
check "onboard skill sends INTRO to the facilitator" "grep -q 'FACILITATOR_EMAIL' .claude/skills/onboard/SKILL.md && grep -q '\\[INTRO\\]' .claude/skills/onboard/SKILL.md"
check "digest skill mails the owner from the agent" "grep -q 'Daily digest' .claude/skills/digest/SKILL.md && grep -qi 'from the agent' .claude/skills/digest/SKILL.md"
check "onboard skill never types keys" "grep -qi 'never ask the owner for a key' .claude/skills/onboard/SKILL.md && grep -q 'bin/agentmail signup' .claude/skills/onboard/SKILL.md"

check ".mcp.json wires bin/agentmail-mcp" "python3 -c \"import json; d=json.load(open('.mcp.json')); assert d['mcpServers']['agentmail']['command']=='bin/agentmail-mcp'\""
check "agentmail-mcp wrapper executable and key-free" "[ -x bin/agentmail-mcp ] && ! grep -qE 'am_[A-Za-z0-9_]{10,}' bin/agentmail-mcp .mcp.json README.md"
tcheck "README says the agent registers its own inbox" "grep -q 'registers its own inbox' README.md"
tcheck "agent-cron dry mode is safe" "AGENT_CRON_DRY=1 AGENTMAIL_HOME=/nonexistent bin/agent-cron >/dev/null"
tcheck "agent-notify is silent without a display stack" "AGENT_BRIEF_NO_NOTIFY=1 bin/agent-notify t b"

exit $fail
