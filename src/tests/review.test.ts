import { expect, it, vi } from 'vitest'
import { ChildProcess } from 'node:child_process'
import open from 'open'
import { reviewCommand } from '../commands/review.js'
import { startLocalServer } from '../local-server.js'
import { chooseRepository } from '../repositories.js'
import { getRepository } from '../gh.js'

vi.mock('open', () => ({ default: vi.fn() }))
vi.mock('../gh.js', () => ({
  isGhInstalled: async () => true,
  isGhAuthenticated: async () => true,
  getGithubUser: async () => ({ id: 1, login: 'octocat' }),
  getGhToken: async () => 'test-token',
  getRepository: vi.fn(async () => ({ nameWithOwner: 'Owner/Repo' })),
}))
vi.mock('../assert-api.js', () => ({
  exchangeGithubToken: async () => ({
    githubUser: { id: '1' },
    user: { id: 'user', name: 'Test User', email: 'test@example.com' },
  }),
}))
vi.mock('../preferences.js', () => ({
  isIdentityAuthorized: async () => true,
  rememberRepository: async () => {},
}))
vi.mock('../repositories.js', () => ({ chooseRepository: vi.fn() }))
vi.mock('../local-server.js', () => ({ startLocalServer: vi.fn() }))

it.each(['reject', 'process-error', 'nonzero-exit'])(
  'keeps a direct review running after browser launch fails (%s) and still handles shutdown',
  async (failure) => {
    const close = vi.fn(async () => {})
    const launchUrl = 'http://127.0.0.1:12345/__assert-local/launch/test'
    vi.mocked(startLocalServer).mockResolvedValue({
      origin: 'http://127.0.0.1:12345',
      launchUrl,
      close,
    })
    const originalHandlers = process.listeners('SIGTERM')
    const browser = new ChildProcess()
    if (failure === 'reject') {
      vi.mocked(open).mockRejectedValue(new Error('Browser unavailable'))
    } else {
      vi.mocked(open).mockResolvedValue(browser)
    }
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const running = reviewCommand(
      { open: true },
      'https://github.com/owner/repo/pull/123',
    )
    try {
      if (failure !== 'reject') {
        await vi.waitFor(() => expect(browser.listenerCount('error')).toBe(1))
        if (failure === 'process-error') {
          browser.emit('error', new Error('Browser unavailable'))
        } else {
          browser.emit('exit', 1)
        }
      }
      await vi.waitFor(() =>
        expect(error).toHaveBeenCalledWith(
          expect.stringContaining(
            `server is still running; open ${launchUrl} manually`,
          ),
        ),
      )
      expect(getRepository).toHaveBeenCalledWith('owner/repo')
      expect(chooseRepository).not.toHaveBeenCalled()
      expect(startLocalServer).toHaveBeenCalledWith(
        expect.objectContaining({
          repository: { owner: 'Owner', repo: 'Repo' },
          pullNumber: 123,
        }),
      )
      expect(close).not.toHaveBeenCalled()
    } finally {
      for (const handler of process.listeners('SIGTERM')) {
        if (!originalHandlers.includes(handler)) handler('SIGTERM')
      }
      await running
      log.mockRestore()
      error.mockRestore()
    }
    expect(close).toHaveBeenCalledOnce()
    expect(process.listeners('SIGTERM')).toEqual(originalHandlers)
  },
)
