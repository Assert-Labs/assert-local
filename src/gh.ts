import { execa } from 'execa'

export interface GithubUser {
  id: number
  login: string
  name?: string
}

export interface GithubRepository {
  nameWithOwner: string
  url: string
  isPrivate: boolean
}

function parseJson<T>(output: string, description: string): T {
  try {
    return JSON.parse(output) as T
  } catch {
    throw new Error(`gh returned invalid JSON while reading ${description}`)
  }
}

export async function isGhInstalled() {
  try {
    await execa('gh', ['--version'])
    return true
  } catch (error) {
    if (
      typeof error === 'object' &&
      error != null &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return false
    }
    throw error
  }
}

export async function isGhAuthenticated() {
  const result = await execa(
    'gh',
    ['auth', 'status', '--active', '--hostname', 'github.com'],
    { reject: false },
  )
  return result.exitCode === 0
}

export async function loginGh() {
  await execa('gh', ['auth', 'login', '--hostname', 'github.com'], {
    stdio: 'inherit',
  })
}

export async function switchGhAccount() {
  await execa('gh', ['auth', 'switch', '--hostname', 'github.com'], {
    stdio: 'inherit',
  })
}

export async function getGhToken(signal?: AbortSignal) {
  const { stdout } = await execa(
    'gh',
    ['auth', 'token', '--hostname', 'github.com'],
    { cancelSignal: signal, timeout: 10_000 },
  )
  const token = stdout.trim()
  if (!token) throw new Error('gh did not return an authentication token')
  return token
}

export async function getGithubUser() {
  const { stdout } = await execa('gh', ['api', 'user'])
  const value = parseJson<Record<string, unknown>>(stdout, 'the current user')
  if (typeof value.id !== 'number' || typeof value.login !== 'string') {
    throw new Error('gh returned an incomplete GitHub user')
  }
  return {
    id: value.id,
    login: value.login,
    name: typeof value.name === 'string' ? value.name : undefined,
  } satisfies GithubUser
}

function parseRepository(value: Record<string, unknown>): GithubRepository {
  if (
    typeof value.nameWithOwner !== 'string' ||
    typeof value.url !== 'string'
  ) {
    throw new Error('gh returned an incomplete GitHub repository')
  }
  return {
    nameWithOwner: value.nameWithOwner,
    url: value.url,
    isPrivate:
      value.isPrivate === true ||
      (typeof value.visibility === 'string' &&
        value.visibility.toLowerCase() === 'private'),
  }
}

export async function getCurrentRepository() {
  const result = await execa(
    'gh',
    ['repo', 'view', '--json', 'nameWithOwner,url,isPrivate'],
    { reject: false },
  )
  if (result.exitCode !== 0) return undefined
  return parseRepository(
    parseJson<Record<string, unknown>>(result.stdout, 'the current repository'),
  )
}

export async function listAccessibleRepositories() {
  const { stdout } = await execa('gh', [
    'api',
    '--paginate',
    '--slurp',
    '--cache',
    '5m',
    '-X',
    'GET',
    '/user/repos',
    '-f',
    'affiliation=owner,collaborator,organization_member',
    '-f',
    'per_page=100',
    '-f',
    'sort=pushed',
  ])
  const pages = parseJson<Record<string, unknown>[][]>(
    stdout,
    'accessible repositories',
  )
  return pages.flat().map((value) =>
    parseRepository({
      nameWithOwner: value.full_name,
      url: value.html_url,
      isPrivate: value.private,
    }),
  )
}

export async function searchRepositories(query: string) {
  if (!query.trim()) return []
  const result = await execa(
    'gh',
    [
      'search',
      'repos',
      `${query.trim()} in:name archived:false`,
      '--limit',
      '20',
      '--json',
      'fullName,url,visibility',
    ],
    { reject: false },
  )
  if (result.exitCode !== 0) {
    if (/rate limit/i.test(result.stderr)) {
      throw new Error(
        'GitHub public repository search is temporarily rate-limited. You can still select an accessible repository or open an exact owner/name.',
      )
    }
    throw new Error(
      result.stderr.trim() || 'GitHub public repository search failed.',
    )
  }
  const values = parseJson<Record<string, unknown>[]>(
    result.stdout,
    'repositories',
  )
  return values.map((value) =>
    parseRepository({
      nameWithOwner: value.fullName,
      url: value.url,
      visibility: value.visibility,
    }),
  )
}

export async function getRepository(nameWithOwner: string) {
  const { stdout } = await execa('gh', [
    'repo',
    'view',
    nameWithOwner,
    '--json',
    'nameWithOwner,url,isPrivate',
  ])
  return parseRepository(
    parseJson<Record<string, unknown>>(stdout, nameWithOwner),
  )
}
