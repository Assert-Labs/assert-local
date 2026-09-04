import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

interface Preferences {
  version: 1
  authorizedUsers: Record<string, string>
  recentRepositories: Record<string, string>
}

const emptyPreferences = (): Preferences => ({
  version: 1,
  authorizedUsers: {},
  recentRepositories: {},
})

function preferencesDirectory(environment: NodeJS.ProcessEnv = process.env) {
  return (
    environment.ASSERT_LOCAL_CONFIG_DIR ?? path.join(homedir(), '.assert-local')
  )
}

function preferenceKey(apiUrl: string, githubUserId: number) {
  return `${apiUrl}#${githubUserId}`
}

function stringRecord(value: unknown): Record<string, string> {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => {
      return typeof entry[1] === 'string'
    }),
  )
}

async function readPreferences(directory = preferencesDirectory()) {
  try {
    const value = JSON.parse(
      await readFile(path.join(directory, 'preferences.json'), 'utf8'),
    ) as Partial<Preferences>
    if (value.version !== 1) return emptyPreferences()
    return {
      version: 1,
      authorizedUsers: stringRecord(value.authorizedUsers),
      recentRepositories: stringRecord(value.recentRepositories),
    } satisfies Preferences
  } catch {
    return emptyPreferences()
  }
}

async function writePreferences(preferences: Preferences) {
  const directory = preferencesDirectory()
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const destination = path.join(directory, 'preferences.json')
  const temporary = path.join(directory, `preferences.${process.pid}.tmp`)
  await writeFile(temporary, `${JSON.stringify(preferences, null, 2)}\n`, {
    mode: 0o600,
  })
  await rename(temporary, destination)
}

export async function isIdentityAuthorized({
  apiUrl,
  githubUserId,
  assertUserId,
}: {
  apiUrl: string
  githubUserId: number
  assertUserId: string
}) {
  const preferences = await readPreferences()
  return (
    preferences.authorizedUsers[preferenceKey(apiUrl, githubUserId)] ===
    assertUserId
  )
}

export async function rememberIdentityAuthorization({
  apiUrl,
  githubUserId,
  assertUserId,
}: {
  apiUrl: string
  githubUserId: number
  assertUserId: string
}) {
  const preferences = await readPreferences()
  preferences.authorizedUsers[preferenceKey(apiUrl, githubUserId)] =
    assertUserId
  await writePreferences(preferences)
}

export async function getRecentRepository({
  apiUrl,
  githubUserId,
}: {
  apiUrl: string
  githubUserId: number
}) {
  const preferences = await readPreferences()
  return preferences.recentRepositories[preferenceKey(apiUrl, githubUserId)]
}

export async function rememberRepository({
  apiUrl,
  githubUserId,
  nameWithOwner,
}: {
  apiUrl: string
  githubUserId: number
  nameWithOwner: string
}) {
  const preferences = await readPreferences()
  preferences.recentRepositories[preferenceKey(apiUrl, githubUserId)] =
    nameWithOwner
  await writePreferences(preferences)
}
