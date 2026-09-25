# Assert Local

Assert Local allows you to use the full functionality of [Assert](assert.dev)'s
world-class review experience using your local credentials. It does not require
installing the Assert GitHub app.

[Sign in or create an Assert account](https://app.assert.dev)

## Requirements

- Node.js 20.17+, 22.13+, or 23.5+ (matching the prompt library's requirements)
- [GitHub CLI](https://cli.github.com/)
- An Assert account linked to the same GitHub user as `gh`

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

The command confirms the active GitHub and Assert identities, resolves the
current repository or lets you search for another one, and opens a loopback
web server. The server proxies Assert's production web assets and API without
exposing the GitHub or Assert token to browser JavaScript.

While the server is running, it refreshes the repository-scoped inbox every
two minutes and asks Assert to prepare necessary review assets.

Use `--no-open` to print the local URL without opening a browser.
While the server is running, press `o` in its terminal to reopen the page.

Assert Local remembers confirmed GitHub/Assert identity matches and the most
recent repository in `~/.assert-local/preferences.json`. It never stores GitHub
or Assert credentials there. Repository search filters repositories already
available to your GitHub account locally; exact lookups and broader public
searches each make a single explicit GitHub request.

## Clusters for agents

Discover logical review areas and inspect their changes without starting a local
web server. These commands use the active `gh` credentials and require an Assert
account linked to that GitHub account. They never prompt or open a browser.

```sh
npx assert-local clusters
npx assert-local clusters --repo example/project --pr 123
npx assert-local clusters https://github.com/example/project/pull/123
npx assert-local cluster error-handling --diff
npx assert-local cluster error-handling --repo example/project --pr 123 --json
```

Without a target, the current repository and current branch's PR are resolved
through `gh`. A different repository requires a PR number. Cluster IDs are exact
IDs from the latest `clusters` result; they may change after new commits or
regeneration. Each result includes base/head SHAs, the PR review version, and a
version-pinned Assert link. Add `--diff` to fetch that exact comparison through
`gh` and show only the selected cluster's changes, including its descendants.
Diffs are review excerpts with original line coordinates, not necessarily
standalone patches to apply. Binary and rename metadata are preserved. GitHub
may reject very large comparisons; the CLI reports that failure instead of
fetching a newer PR diff.

Commands wait up to 60 seconds for usable results. Partial results can be used
while smaller subclusters are still generating.

```sh
npx assert-local clusters --timeout 2m --wait-until ready
npx assert-local clusters --no-wait --json
```

`--timeout` accepts seconds (also the default unit), `ms`, or `m` and bounds the
clustering polling phase. Authentication/PR lookup and optional diff fetching
have their own request timeouts. `--no-wait` requests status once.

Exit codes: **0** for a successful result (including a pending `--no-wait`
response), **1** for an error, **2** when the wait timeout expires. A timeout
returns the last known status and available results, a retry command, and the
review URL when known. Server generation continues after the CLI stops waiting.
If the first request times out, status is explicitly `unknown`.

`--json` emits one JSON value on stdout, including structured errors. List output
contains the full cluster tree; detail output contains the selected `cluster`,
`clusterUrl`, and optional `diff`. No credentials are printed or saved.
