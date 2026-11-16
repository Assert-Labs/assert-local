import { expect, it } from 'vitest'
import { listenForCallback } from '../sign-in.js'

it('ignores callbacks without the expected state, then resolves the code', async () => {
  const callback = await listenForCallback({ state: 'expected' })
  const url = new URL(callback.redirectUri)

  url.search = '?state=forged&code=attacker'
  expect((await fetch(url)).status).toBe(400)

  url.search = '?state=expected&code=real-code'
  expect((await fetch(url)).status).toBe(200)
  expect(await callback.code).toBe('real-code')
})

it('rejects when the browser cancels sign-in', async () => {
  const callback = await listenForCallback({ state: 'expected' })
  const url = new URL(callback.redirectUri)
  url.search = '?state=expected'
  await fetch(url)
  await expect(callback.code).rejects.toThrow('cancelled')
})
