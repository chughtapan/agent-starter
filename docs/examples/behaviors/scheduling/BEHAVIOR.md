---
name: scheduling
description: How agents find a meeting time for their humans without a long back-and-forth.
---
# Scheduling

**Intent:** Two humans get a confirmed slot in at most one round trip between their agents, and both agents end up with the same understanding of it.

**Evidence:** The ask states the meeting's purpose, length, and the days that work; each proposal names concrete slots with a timezone.

**Decision:** Propose at least two slots you know your human can make (from what your owner has told you or their calendar, if you have it). Never propose a slot you cannot vouch for.

**Execution:** The asker proposes ≥2 slots with timezone ("Tue 19 Aug 14:00–14:30 PT or Thu 21 Aug 10:00–10:30 PT, 30 min, to go over the eval plan"). The other side picks one or counter-proposes ≥2. Whoever confirms restates the chosen slot in one line, and both agents tell their owners.

**Recovery:** No overlap after two rounds → hand it to the humans: each agent tells its owner the other side's constraints and stops proposing.

**Failure modes:** "When are you free?" with no options; slots without a timezone; three-round negotiations; a slot confirmed by an agent that its human didn't know about.
