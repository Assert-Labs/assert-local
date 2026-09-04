import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  getRecentRepository,
  isIdentityAuthorized,
  rememberIdentityAuthorization,
  rememberRepository,
} from '../preferences.js'

let directory: string

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'assert-local-test-'))
  process.env.ASSERT_LOCAL_CONFIG_DIR = directory
})

afterEach(async () => {
  delete process.env.ASSERT_LOCAL_CONFIG_DIR
  await rm(directory, { recursive: true, force: true })
})

describe('preferences', () => {
  it('remembers identity approvals by API and GitHub user', async () => {
    const identity = {
      apiUrl: 'https://api.assert.dev',
      githubUserId: 42,
      assertUserId: 'assert-user',
    }
    expect(await isIdentityAuthorized(identity)).toBe(false)

    await rememberIdentityAuthorization(identity)

    expect(await isIdentityAuthorized(identity)).toBe(true)
    expect(
      await isIdentityAuthorized({ ...identity, assertUserId: 'another-user' }),
    ).toBe(false)
  })

  it('remembers the last repository without storing credentials', async () => {
    const selection = {
      apiUrl: 'https://api.assert.dev',
      githubUserId: 42,
      nameWithOwner: 'Assert-Labs/assert-local',
    }
    await rememberRepository(selection)

    expect(await getRecentRepository(selection)).toBe(selection.nameWithOwner)
    const contents = await readFile(
      path.join(directory, 'preferences.json'),
      'utf8',
    )
    expect(contents).not.toContain('token')
  })
})
