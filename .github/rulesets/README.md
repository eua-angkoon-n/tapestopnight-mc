# The ruleset for `main`

`main.json` is the branch ruleset this repository wants. It is a **file rather than a
setting**, because GitHub will not let this account apply it:

```
$ gh api repos/eua-angkoon-n/tapestopnight-mc/rulesets
Upgrade to GitHub Pro or make this repository public to enable this feature. (HTTP 403)
```

Rulesets and the older branch protection are both paid features on **private** repositories
owned by a personal account. The repository is private on purpose — ADR-0010 — and the
cheap-looking way out, making it public, is the one option that is actually forbidden: this
repo names the Host by IP, maps the reverse proxy, and gives the path of the `.env` that
holds `RCON_PASSWORD` and `DISCORD_BOT_TOKEN`. Trading that for a free checkbox is a bad
trade at any price.

So the guardrail lives in two halves. Server-side, when the plan allows it. Locally, today.

## Applying it server-side

Once the account is on GitHub Pro:

**By hand** — Settings → Rules → Rulesets → *New ruleset* → *Import a ruleset*, and give it
this file.

**Or by API:**

```bash
gh api --method POST repos/eua-angkoon-n/tapestopnight-mc/rulesets \
  --input .github/rulesets/main.json
```

Read back what is actually in force, rather than trusting this file to still match it:

```bash
gh api repos/eua-angkoon-n/tapestopnight-mc/rulesets \
  --jq '.[] | "\(.id)  \(.name)  \(.enforcement)"'
gh api repos/eua-angkoon-n/tapestopnight-mc/rulesets/RULESET_ID > /tmp/live.json
diff <(jq -S 'del(.id,.node_id,.created_at,.updated_at,.source,.source_type,._links,.current_user_can_bypass)' /tmp/live.json) \
     <(jq -S . .github/rulesets/main.json)
```

## What it does, and why each rule is the shape it is

**No deletion, no force push.** The two that cost nothing and prevent the unrecoverable. Every
other rule here is about catching mistakes; these two are about history that cannot be
reconstructed.

**A pull request is required — with `required_approving_review_count: 0`.** Zero is not an
oversight. There is exactly one collaborator on this repository, and GitHub does not let
anyone approve their own pull request. Requiring one review would not raise the bar, it would
make `main` unmergeable, and the fix would be to delete the ruleset — which is how a
guardrail teaches people to remove guardrails. What the rule still buys with zero reviews:
work lands through a branch, CI runs on it before the merge, and there is a diff with a URL
to point at afterwards.

**`check` must pass.** Only `check` — deliberately not `images`. The `images` job carries
`if: github.event_name == 'push'`, so on a pull request it is skipped, and a required check
that never truly runs is a rule whose behaviour depends on how GitHub happens to score
skipped runs. `check` is the job that holds the real gates anyway: `typecheck`,
`render:check` (ADR-0002's renderer guarantee), `icon:check` (ADR-0013), `bot:check`
(ADR-0014) and `bridge:check` (ADR-0015). It is pinned to `integration_id: 15368`,
GitHub Actions, so nothing else can report a green `check`.

**`strict_required_status_checks_policy: false`** — a branch does not have to be up to date
with `main` before merging. On a one-person repository that setting mostly produces a queue of
self-inflicted rebases.

**No linear history rule.** `main` is built from merge commits (`Merge pull request #15 from
…`), and requiring linear history would reject the merge button this project actually uses.
Change the workflow first if that is ever wanted; do not let a ruleset change it by accident.

**`bypass_actors: []` — nobody bypasses, including the admin.** Adding the repository-admin
role as a bypass actor would hand the bypass to the only person who pushes here, which turns
the whole ruleset into decoration. The escape hatch is to set `enforcement` to `evaluate` or
`disabled` in the settings UI: still available in a real emergency, but a deliberate act with
a timestamp on it, not something you slip past at 23:00.

## The local half, which works today

Two hooks live in `.githooks/`, and git does **not** install hooks from a checkout. One
setting switches both on, once per clone:

```bash
git config core.hooksPath .githooks
git config --get core.hooksPath        # → .githooks
```

**This was found unset.** `.githooks/pre-commit` — the `gitleaks` secret scan that ADR-0010
describes as running "regardless" — had therefore never run in this clone, because git was
still looking in `.git/hooks/`, which holds nothing but GitHub's `.sample` files. The hook was
written, committed, and dormant. That is the quiet way this kind of guard fails: the file is
present, the ADR cites it, and nothing about `git commit` looks any different.

**`pre-push`** is the new one, and the local stand-in for the ruleset: it refuses a direct
push to `main`, and refuses to delete it. It is not equivalent to a ruleset and should not be
described as one — it runs on one laptop, no server enforces it, and `--no-verify` skips it.
It catches the failure it is aimed at, which is habit rather than intent: `git push` while
still standing on `main`.
