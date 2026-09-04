import { confirm, select } from '@inquirer/prompts'
import {
  getCurrentRepository,
  getRepository,
  listAccessibleRepositories,
  searchRepositories,
  type GithubRepository,
} from './gh.js'
import { stableSearch } from './search-prompt.js'

const EXACT_PREFIX = 'Open exact repository: '
const PUBLIC_SEARCH_PREFIX = 'Search public repositories: '

function repositoryOwner(repository: GithubRepository) {
  return repository.nameWithOwner.slice(
    0,
    repository.nameWithOwner.indexOf('/'),
  )
}

export function filterRepositories(
  repositories: GithubRepository[],
  term: string,
  githubLogin: string,
) {
  const query = term.trim().toLowerCase()
  const login = githubLogin.toLowerCase()
  return repositories
    .map((repository, index) => {
      const fullName = repository.nameWithOwner.toLowerCase()
      const name = fullName.slice(fullName.indexOf('/') + 1)
      let match = 0
      if (query) {
        if (fullName === query) match = 0
        else if (name === query) match = 1
        else if (fullName.startsWith(query)) match = 2
        else if (name.startsWith(query)) match = 3
        else if (fullName.includes(query)) match = 4
        else return undefined
      }
      return {
        repository,
        index,
        match,
        ownership: repositoryOwner(repository).toLowerCase() === login ? 0 : 1,
      }
    })
    .filter((value) => value != null)
    .sort(
      (left, right) =>
        left.match - right.match ||
        left.ownership - right.ownership ||
        left.index - right.index,
    )
    .slice(0, 30)
    .map(({ repository }) => repository)
}

function repositoryChoice(repository: GithubRepository) {
  return {
    name: `${repository.nameWithOwner}${repository.isPrivate ? ' (private)' : ''}`,
    value: repository.nameWithOwner,
    description: repository.url,
  }
}

function isExactRepositoryName(term: string) {
  return /^[^/\s]+\/[^/\s]+$/.test(term.trim())
}

async function chooseFromSearch(githubLogin: string) {
  console.log('Loading repositories available to your GitHub account…')
  const repositories = await listAccessibleRepositories()
  const repositoryByName = new Map(
    repositories.map((repository) => [
      repository.nameWithOwner.toLowerCase(),
      repository,
    ]),
  )

  for (;;) {
    const selected = await stableSearch({
      message: 'Search your GitHub repositories',
      pageSize: 12,
      source: (value) => {
        const term = value?.trim() ?? ''
        const matches = filterRepositories(repositories, term, githubLogin)
        const choices = matches.map(repositoryChoice)
        const exactMatch = repositoryByName.has(term.toLowerCase())
        if (isExactRepositoryName(term) && !exactMatch) {
          choices.push({
            name: `Open ${term} directly`,
            value: `${EXACT_PREFIX}${term}`,
            description:
              'One exact GitHub lookup, including private repositories',
          })
        }
        if (term.length >= 2) {
          choices.push({
            name: `Search all public repositories for “${term}”`,
            value: `${PUBLIC_SEARCH_PREFIX}${term}`,
            description: 'Runs one GitHub Search request',
          })
        }
        return choices
      },
    })

    if (selected.startsWith(EXACT_PREFIX)) {
      const nameWithOwner = selected.slice(EXACT_PREFIX.length)
      try {
        return await getRepository(nameWithOwner)
      } catch {
        console.error(
          `Could not access ${nameWithOwner}. Check the name and access.`,
        )
        continue
      }
    }

    if (selected.startsWith(PUBLIC_SEARCH_PREFIX)) {
      const term = selected.slice(PUBLIC_SEARCH_PREFIX.length)
      try {
        const results = await searchRepositories(term)
        if (results.length === 0) {
          console.error(`No public repositories matched “${term}”.`)
          continue
        }
        const nameWithOwner = await select({
          message: 'Select a public GitHub repository',
          pageSize: 12,
          choices: results.map(repositoryChoice),
        })
        return results.find(
          (repository) => repository.nameWithOwner === nameWithOwner,
        )!
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error))
        continue
      }
    }

    const repository = repositoryByName.get(selected.toLowerCase())
    if (repository != null) return repository
  }
}

export async function chooseRepository({
  githubLogin,
  recentRepository,
}: {
  githubLogin: string
  recentRepository?: string
}): Promise<GithubRepository> {
  const current = await getCurrentRepository()

  if (recentRepository != null) {
    if (
      current?.nameWithOwner.toLowerCase() === recentRepository.toLowerCase()
    ) {
      if (
        await confirm({
          message: `Review ${current.nameWithOwner} again?`,
          default: true,
        })
      ) {
        return current
      }
    } else {
      const selected = await select({
        message: 'Choose a GitHub repository',
        choices: [
          {
            name: `${recentRepository} (last used)`,
            value: recentRepository,
          },
          ...(current == null
            ? []
            : [
                {
                  name: `${current.nameWithOwner} (current directory)`,
                  value: current.nameWithOwner,
                },
              ]),
          { name: 'Search for another repository', value: '' },
        ],
      })
      if (selected) {
        if (selected === current?.nameWithOwner) return current
        try {
          return await getRepository(selected)
        } catch {
          console.error(
            `Could not access remembered repository ${selected}; choose another repository.`,
          )
        }
      }
    }
  } else if (
    current != null &&
    (await confirm({
      message: `Review ${current.nameWithOwner}?`,
      default: true,
    }))
  ) {
    return current
  }

  return chooseFromSearch(githubLogin)
}
