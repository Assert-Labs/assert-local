import { Command } from 'commander'
import { reviewCommand } from './commands/review.js'

const program = new Command()
  .name('assert-local')
  .description('Run Assert locally with your GitHub CLI credentials')
  .addHelpText(
    'after',
    '\nAI-powered pull request review. Learn more at https://assert.dev\nGet started: assert-local review',
  )
  .version('0.0.0')

program
  .command('review')
  .description('Open a local Assert review experience for a GitHub repository')
  .option('--no-open', 'do not open the browser automatically')
  .action(async (options: { open: boolean }) => reviewCommand(options))

program.parseAsync().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
