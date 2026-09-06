import { describe, expect, it } from 'vitest'
import { parseReviewTarget } from '../review-target.js'

describe('review target', () => {
  it('resolves repository names and copied GitHub URLs', () => {
    expect(parseReviewTarget('owner/repo')).toEqual({
      repository: 'owner/repo',
    })
    expect(parseReviewTarget('https://github.com/owner/repo/')).toEqual({
      repository: 'owner/repo',
    })
    expect(parseReviewTarget('https://github.com/owner/repo/pull/123')).toEqual(
      {
        repository: 'owner/repo',
        pullNumber: 123,
      },
    )
    expect(
      parseReviewTarget(
        'https://github.com/owner/repo/pull/123/files?foo=bar#diff-abc',
      ),
    ).toEqual({ repository: 'owner/repo', pullNumber: 123 })
  })

  it('rejects non-GitHub URLs, malformed paths, and invalid PR numbers', () => {
    for (const target of [
      'repo',
      'https://example.com/owner/repo/pull/123',
      'https://github.com@evil.example/owner/repo/pull/123',
      'https://github.com/owner/repo/issues/123',
      'https://github.com/owner/repo/pull/0',
      'https://github.com/owner/repo/pull/9007199254740992',
      'https://github.com/owner/repo/pull/123abc',
      'owner/..',
      '--help/repo',
    ]) {
      expect(() => parseReviewTarget(target), target).toThrow(
        'Choose a repository',
      )
    }
  })
})
