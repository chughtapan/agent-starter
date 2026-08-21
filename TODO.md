# TODO

- Minimize the dependency on the GitHub CLI (`gh`). Onboarding currently requires
  `gh repo create --template … --clone`; someone without `gh` (or without a GitHub
  account) should still be able to stand up an agent — e.g. clone/degit the template
  into a plain **local git repo** and let the remote be optional (push later if ever).
  Touches: README install message, onboard skill step 2, bin/agent-upgrade (already
  clones the template by URL, so upgrades don't need `gh` either).
