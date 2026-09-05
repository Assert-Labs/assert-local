# Assert Local

Assert Local brings [Assert](https://assert.dev)'s AI-powered pull request review
to your browser using your GitHub CLI credentials. Get a personal PR inbox and
AI-assisted diffs without installing the Assert GitHub App on a repository or
copying a personal access token into Assert.

The CLI runs a local proxy, not an offline review engine: Assert's hosted service
provides the UI and handles review processing. [Sign in or create an Assert account](https://app.assert.dev)
with the same GitHub account you use in `gh`.

## Requirements

- Node.js 20.17+, 22.13+, or 23.5+ (matching the prompt library's requirements)
- [GitHub CLI](https://cli.github.com/)
- An Assert account linked to the same GitHub user as `gh`

## Usage

```sh
npx assert-local review
```

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

## Development

```sh
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

`src/commands/review.ts` owns the interactive setup and terminal lifecycle.
`src/assert-api.ts` owns session exchange, refresh, and authenticated API requests;
the proxy and background polling share this client. `src/local-server.ts` serves
the browser and injects runtime configuration, while `src/poll.ts` runs cancellable,
non-overlapping background work. UI assets remain hosted by Assert.

Sessions refresh shortly before expiry or once after a 401. Refresh must preserve
the GitHub identity, Assert identity, and workspace selected at startup. Tokens
stay in process memory and are never forwarded to the web-asset origin or exposed
in the browser's runtime configuration.
