import { describe, expect, it, vi } from 'vitest'
import { formatWordmark } from '../wordmark.js'

describe('wordmark color', () => {
  it('uses the terminal yellow and restores the default foreground', () => {
    const hasColors = vi.fn().mockReturnValue(true)
    const environment = { TERM: 'xterm-256color' }
    const result = formatWordmark({ isTTY: true, hasColors }, environment)
    expect(hasColors).toHaveBeenCalledWith(16, environment)
    expect(result).toBe(
      '\u001b[33m▄▀█ █▀ █▀ █▀▀ █▀█ ▀█▀\n█▀█ ▄█ ▄█ ██▄ █▀▄  █\u001b[39m',
    )
  })

  it('does not require TTY methods when output is redirected', () => {
    const output = { isTTY: false, hasColors: vi.fn() }
    expect(formatWordmark(output, {})).not.toContain('\u001b[')
    expect(output.hasColors).not.toHaveBeenCalled()
  })

  it('leaves unsupported terminals uncolored', () => {
    expect(
      formatWordmark({ isTTY: true, hasColors: () => false }, {}),
    ).not.toContain('\u001b[')
  })

  it.each([{ NO_COLOR: '1' }, { NO_COLOR: '' }, { FORCE_COLOR: '0' }])(
    'respects color opt-outs: %j',
    (environment) => {
      expect(
        formatWordmark({ isTTY: true, hasColors: () => true }, environment),
      ).not.toContain('\u001b[')
    },
  )

  it.each(['', '1', '2', '3', 'true'])(
    'allows FORCE_COLOR=%s to override redirection and NO_COLOR',
    (forceColor) => {
      expect(
        formatWordmark(
          { isTTY: false, hasColors: () => false },
          {
            FORCE_COLOR: forceColor,
            NO_COLOR: '1',
          },
        ),
      ).toContain('\u001b[33m')
    },
  )
})
