import { Command } from 'commander'
import { createRequire } from 'node:module'
import { clustersCommand } from './commands/clusters.js'
import { reviewCommand } from './commands/review.js'

const { version } = createRequire(import.meta.url)('../package.json') as {
  version: string
}

const program = new Command()
  .name('assert-local')
  .description('Review pull requests and explore their changes with Assert')
  .addHelpText(
    'after',
    "\nMove fast, don't break things\nGet started: assert-local review",
  )
  .version(version)

program
  .command('review')
  .description('Open a local Assert review experience for a GitHub repository')
  .argument('[repository-or-pr]', 'GitHub owner/repo or pull request URL')
  .option('--no-open', 'do not open the browser automatically')
  .action(async (target: string | undefined, options: { open: boolean }) =>
    reviewCommand(options, target),
  )

for (const name of ['clusters', 'cluster']) {
  const command = program
    .command(name)
    .description(
      name === 'clusters'
        ? 'List logical review clusters for a pull request'
        : 'Inspect a cluster in the latest pull request clustering',
    )
    .option(
      '--repo <owner/repo>',
      'GitHub repository (defaults to current repository)',
    )
    .option(
      '--pr <number>',
      'pull request number (defaults to current branch PR)',
    )
    .option('--json', 'print structured output')
    .option(
      '--timeout <duration>',
      'maximum time waiting for clustering',
      '60s',
    )
    .option('--no-wait', 'request status once')
    .option(
      '--wait-until <state>',
      'wait for usable or ready clusters',
      'usable',
    )
  if (name === 'clusters')
    command
      .argument('[pr-url]', 'GitHub pull request URL')
      .action((target, options) => clustersCommand(options, target))
  else
    command
      .argument('<cluster-id>', 'exact cluster ID from clusters output')
      .option('--diff', 'show changes in this cluster and its subclusters')
      .action((id, options) => clustersCommand(options, undefined, id))
}

program.parseAsync().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
