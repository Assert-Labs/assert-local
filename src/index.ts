import { Command } from 'commander'
import { createRequire } from 'node:module'
import { reviewCommand } from './commands/review.js'

const { version } = createRequire(import.meta.url)('../package.json') as {
  version: string
}

const program = new Command()
  .name('assert-local')
  .description('Run Assert locally with your GitHub CLI credentials')
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

program.parseAsync().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
