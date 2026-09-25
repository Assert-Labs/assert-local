# Assert Local

Review pull requests in [Assert](https://assert.dev), explore logical groups of
changes, and share focused review links. No Assert GitHub app installation is
required.

[Sign in or create an Assert account](https://app.assert.dev)

## Requirements

- Node.js 20.17+, 22.13+, or 23.5+
- [GitHub CLI](https://cli.github.com/), signed in to your GitHub account
- An Assert account linked to that same GitHub account

## Usage

```sh
npx assert-local review
```

To skip the repository picker, pass a repository or a GitHub pull request URL:

```sh
npx assert-local review owner/repo
npx assert-local review https://github.com/owner/repo/pull/123
```

Repositories open their inbox; pull request URLs open that review directly.

The command confirms your account, lets you choose a repository, and opens the
review in your browser. It remembers your account confirmation and most recent
repository, and keeps the repository inbox up to date while running.

Use `--no-open` to print the review URL without opening a browser.
Press `o` to reopen the page or Ctrl+C to stop.

## Clusters for agents

Discover logical review areas, inspect their changes, and get links to share
with reviewers. These commands print their results without prompting or opening
a browser.

```sh
npx assert-local clusters
npx assert-local clusters --repo example/project --pr 123
npx assert-local clusters https://github.com/example/project/pull/123
npx assert-local cluster error-handling --diff
npx assert-local cluster error-handling --repo example/project --pr 123 --json
```

Without a target, commands use the current repository and current branch's PR.
A different repository requires a PR number. Cluster IDs are exact
IDs from the latest `clusters` result; they may change after new commits or
regeneration. Each result includes base/head SHAs, the PR review version, and a
version-pinned Assert link. Add `--diff` to show only the selected cluster's
changes, including its subclusters, for that same review version.
Diffs are review excerpts with original line coordinates, not necessarily
standalone patches to apply. Binary and rename metadata are preserved. Very large
comparisons may be unavailable; the command reports an error in that case.

Commands wait up to 60 seconds for usable results. Partial results can be used
while smaller subclusters are still generating.

```sh
npx assert-local clusters --timeout 2m --wait-until ready
npx assert-local clusters --no-wait --json
```

`--timeout` sets how long to wait for clusters and accepts seconds (the default
unit), `ms`, or `m`. Signing in, finding the PR, and loading its diff may take
additional time. `--no-wait` returns the current status without waiting for
generation to complete.

Exit codes: **0** for a successful result (including a pending `--no-wait`
response), **1** for an error, **2** when the wait timeout expires. A timeout
returns the last known status and available results, a retry command, and the
review URL when known. Cluster generation continues after the CLI stops waiting.
If the first request times out, status is explicitly `unknown`.

`--json` emits one JSON value on stdout, including structured errors. List output
contains the full cluster tree; detail output contains the selected `cluster`,
`clusterUrl`, and optional `diff`. No credentials are printed or saved.
