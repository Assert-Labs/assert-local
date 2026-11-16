import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { preferencesDirectory } from './preferences.js'

interface StoredSessions {
  version: 1
  /** Assert session tokens by API origin */
  tokens: Record<string, string>
}

function sessionsPath(directory = preferencesDirectory()) {
  return path.join(directory, 'session.json')
}

async function readSessions(): Promise<StoredSessions> {
  try {
    const value = JSON.parse(
      await readFile(sessionsPath(), 'utf8'),
    ) as Partial<StoredSessions>
    if (value.version !== 1 || value.tokens == null) {
      return { version: 1, tokens: {} }
    }
    return {
      version: 1,
      tokens: Object.fromEntries(
        Object.entries(value.tokens).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      ),
    }
  } catch {
    return { version: 1, tokens: {} }
  }
}

async function writeSessions(sessions: StoredSessions) {
  const directory = preferencesDirectory()
  await mkdir(directory, { recursive: true, mode: 0o700 })
  if (Object.keys(sessions.tokens).length === 0) {
    await rm(sessionsPath(directory), { force: true })
    return
  }
  const temporary = path.join(directory, `session.${process.pid}.tmp`)
  await writeFile(temporary, `${JSON.stringify(sessions, null, 2)}\n`, {
    mode: 0o600,
  })
  await rename(temporary, sessionsPath(directory))
}

export async function getStoredSessionToken(apiUrl: string) {
  return (await readSessions()).tokens[apiUrl]
}

export async function storeSessionToken(apiUrl: string, token: string) {
  const sessions = await readSessions()
  sessions.tokens[apiUrl] = token
  await writeSessions(sessions)
}

export async function forgetSessionToken(apiUrl: string) {
  const sessions = await readSessions()
  if (sessions.tokens[apiUrl] == null) return
  delete sessions.tokens[apiUrl]
  await writeSessions(sessions)
}
