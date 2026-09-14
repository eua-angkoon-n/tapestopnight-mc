# `main` is protected by a checked-in ruleset and a local hook, because GitHub will not protect it

**The ruleset cannot be applied.** Rulesets and the older branch protection are paid features
on **private** repositories owned by a personal account. Both endpoints answer the same way:

```
$ gh api repos/eua-angkoon-n/tapestopnight-mc/rulesets
Upgrade to GitHub Pro or make this repository public to enable this feature. (HTTP 403)
$ gh api repos/eua-angkoon-n/tapestopnight-mc/branches/main/protection
Upgrade to GitHub Pro or make this repository public to enable this feature. (HTTP 403)
```

**Going public to get it free is rejected.** It is the obvious move and it is the wrong one.
ADR-0010 made this repository private on a specific argument: it describes the deployment
topology, the reverse-proxy layout, the admin route structure and every mod version *of a box
that also runs the `ledger` system*, and none of that is individually secret while together it
is a map. Since then the repository has also gained the Host's IP address in `CLAUDE.md` and
the path of the `.env` holding `RCON_PASSWORD`, `POSTGRES_PASSWORD`, `AUTH_SECRET` and
`DISCORD_BOT_TOKEN`. Publishing all of that to buy a branch rule is a trade in the wrong
direction. The alternative that is actually available is GitHub Pro; that is a billing
decision, not an engineering one, so this ADR does not make it.

**So the intended configuration is stored as `.github/rulesets/main.json`** — the exact JSON
the *Import a ruleset* button and the REST API both accept. It is inert today. It is one
command on the day the plan allows it, and in the meantime it is a reviewable, diffable
statement of what the branch is supposed to enforce, rather than an intention living in
somebody's memory.

**And `.githooks/pre-push` refuses a direct push to `main` today.** It is deliberately
described as a stand-in and not as protection: it runs on one laptop, no server enforces it,
and `git push --no-verify` walks past it. It stops the mistake that actually happens on a
one-person repository, which is pushing while still standing on `main`.

## Two choices inside the ruleset that look wrong

**`required_approving_review_count` is `0`.** There is exactly one collaborator here, and
GitHub does not let anyone approve their own pull request. Requiring a review would not raise
the bar — it would make `main` unmergeable, and the only way out would be deleting the
ruleset. A guardrail whose first act is to teach you to remove guardrails is worse than no
guardrail. At zero it still buys the things that matter: work lands on a branch, `check` runs
on it before the merge, and there is a diff with a URL afterwards.

**`bypass_actors` is empty, so the repository admin does not get a bypass.** Granting it would
hand the bypass to the only person who pushes here, which makes the ruleset decoration. The
escape hatch is setting `enforcement` to `evaluate` or `disabled` in the settings UI — still
there in a real emergency, but a deliberate act with a timestamp, rather than something that
slips past at 23:00.

Only `check` is required, never `images`: `images` carries `if: github.event_name == 'push'`
and is skipped on a pull request, and a required check that never really runs is a rule whose
behaviour depends on how GitHub scores skipped runs. No linear-history rule either — `main` is
built from merge commits, and a ruleset should not quietly change the merge workflow.

## What this turned up

`core.hooksPath` was **not set in any scope**. Git was reading `.git/hooks/`, which holds only
the stock `.sample` files, so `.githooks/pre-commit` — the `gitleaks` scan ADR-0010 calls
non-negotiable, justified there by this project's prior art of hardcoded database credentials
and plaintext 2FA backup codes — had never run in this clone. The hook was written, committed,
correct, fail-closed, and switched off. It is on now.

That is the failure mode worth carrying out of this ADR. A control that is *documented* and a
control that is *running* look identical in a code review, and the gap between them is
invisible until somebody checks. The same is true of the ruleset this ADR is about: nothing in
the repository would have told you `main` was unprotected.
