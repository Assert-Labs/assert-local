import { describe, expect, it } from 'vitest'
import type { GithubRepository } from '../gh.js'
import { filterRepositories } from '../repositories.js'

const repository = (
  nameWithOwner: string,
  isPrivate = false,
): GithubRepository => ({
  nameWithOwner,
  isPrivate,
  url: `https://github.com/${nameWithOwner}`,
})

describe('repository filtering', () => {
  const repositories = [
    repository('somebody/public-repo'),
    repository('person2/public-repo'),
    repository('person2/private-repo', true),
    repository('person3/private-repo', true),
  ]

  it('prioritizes owned repositories when browsing', () => {
    expect(
      filterRepositories(repositories, '', 'person2').map(
        (value) => value.nameWithOwner,
      ),
    ).toEqual([
      'person2/public-repo',
      'person2/private-repo',
      'somebody/public-repo',
      'person3/private-repo',
    ])
  })

  it('finds and prioritizes exact private repository names', () => {
    expect(
      filterRepositories(repositories, 'person2/private-repo', 'person2').map(
        (value) => value.nameWithOwner,
      ),
    ).toEqual(['person2/private-repo'])
  })
})
