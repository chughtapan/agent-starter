# User stories

These stories define the v0.5 candidate behavior. Each story uses an observable
“when I …, Social Harness …” form so it can become a walkthrough or acceptance
test.

## Join and recover

- When I paste the onboarding prompt into Claude, Codex, or OpenClaw, my agent
  performs setup and tells me only what it needs from me.
- When my agent needs an inbox, it creates the inbox, stores the credential
  privately, and asks me only for the verification code sent to my email.
- When setup is interrupted, repeating the prompt resumes at the last verified
  checkpoint without duplicating mail, hooks, skills, or routines.
- When my machine already has host customization, setup preserves it.
- When no supported host is installed, setup explains the missing release gate
  and does not install unrelated adapters.
- When the facilitator has not acknowledged the introduction, setup says it is
  waiting and does not claim completion.
- When acknowledgement arrives, the original host presents the result and
  explicitly marks commissioning complete.

## Start or resume ordinary work

- When I start or resume an existing agent session, I see changed collaboration
  updates before they are lost in the rest of the conversation.
- When nothing changed recently, the board stays quiet.
- When the last board is stale, it appears again even if no state changed.
- When there is no open collaboration, I see `UPDATES / ALL CLEAR` only when a
  board presentation is due or requested.
- When I use a narrow or ASCII-only terminal, state and person remain legible.
- When I ask an ordinary coding-agent status question, Social Harness does not
  answer on behalf of collaborators.

## Ask another agent

- When I name Alice and ask her agent for a failure trace, my current agent
  identifies the roster recipient and sends the request under my configured
  authority.
- When the request is sent, the agent tells me whether I may close the host and
  that the Mac must stay awake for local checks.
- When a request is waiting, the board names the collaborator, the concrete
  item, and its age without inventing a delivery promise.
- When I have not explicitly crossed the collaboration boundary, the agent keeps
  the work local.

## Receive and inspect a result

- When a result arrives, it appears as a dedicated message with the outcome
  first and its actual source named.
- When a result arrives during ordinary work, my active host presents it at its
  next supported safe boundary without asking me to manage a session.
- When a result has been presented, it remains `READY` until I explicitly mark
  it done.
- When I ask for more detail, the conversation expands the result; the board
  remains a compact index.
- When presentation fails, the item remains ready and can be shown in a later
  session.
- When a collaborator replies after I completed an item, the new reply reopens
  it.

## Complete work

- When exactly one item is open and I say “done,” that item is marked done and
  read.
- When several items are open and I say “done,” my agent shows concise choices
  and asks which one.
- When I say “done with everything,” all open items are marked done.
- When I merely scroll past, summarize, or present a result, nothing is marked
  done.

## Leave and return

- When I close the current host, the machine-local poller continues while the
  Mac is awake.
- When the Mac sleeps, checks pause without claiming otherwise.
- When the Mac wakes, the next routine or session resume checks again.
- When I return in a different supported host, I see the same collaboration
  state without choosing a prior session.

## Diagnose and configure

- When I ask to check collaboration setup, my agent reports config, mail,
  background routine, and adapter health separately from updates.
- When I change poll or stale timing, the Effect Schema validates the public
  config before the runtime uses it.
- When I disable one adapter, diagnosis shows it as disabled and installation
  leaves it alone.
- When AgentMail is unavailable, the board uses the last valid cache and names
  the limitation instead of fabricating fresh state.

## Receive software updates

- When a stable release is available, the existing local poller verifies and
  installs it without adding another background routine.
- When an update changes owned skills or hooks, my other host settings survive
  and any required native trust review remains explicit.
- When an update fails verification or startup, the previous working version
  remains available and the failed version is not repeatedly reinstalled.
- When I disable automatic updates, my agent can still inspect available
  releases and update on my instruction.

## Migrate

- When I migrate a dedicated clean legacy clone, identity, roster, status, and
  norms move to the user-level layout before legacy wiring is removed.
- When the clone contains unrelated or uncommitted data, migration stops before
  mutation and lists the blockers.
- When existing host hooks belong to another tool, migration preserves them.
- When the inspected clone is removed, no old hook, skill, MCP entry, poller,
  runtime state, label, or personal clone remains.
- When the source is the Social Harness product repository, migration refuses to
  delete it.
