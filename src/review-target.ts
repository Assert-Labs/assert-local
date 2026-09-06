export function parseReviewTarget(target: string): {
  repository: string
  pullNumber?: number
} {
  const match =
    /^(?:https:\/\/github\.com\/)?([a-z\d][a-z\d-]*)\/([\w.-]+)(?:\/pull\/([1-9]\d*)(?:\/(?:files|commits|checks))?)?\/?(?:[?#].*)?$/i.exec(
      target,
    )
  if (match != null) {
    const [, owner, repo, pull] = match
    const pullNumber = pull == null ? undefined : Number(pull)
    if (
      repo !== '.' &&
      repo !== '..' &&
      (pullNumber == null || Number.isSafeInteger(pullNumber))
    ) {
      return { repository: `${owner}/${repo}`, pullNumber }
    }
  }
  throw new Error(
    'Choose a repository as owner/repo or a GitHub pull request URL, such as https://github.com/owner/repo/pull/123.',
  )
}
