import {
  createPrompt,
  isDownKey,
  isEnterKey,
  isUpKey,
  makeTheme,
  useKeypress,
  useMemo,
  usePagination,
  usePrefix,
  useState,
} from '@inquirer/core'
import { styleText } from 'node:util'

export interface SearchChoice {
  name: string
  value: string
  description?: string
}

interface SearchConfig {
  message: string
  pageSize?: number
  source: (term: string | undefined) => readonly SearchChoice[]
}

const searchTheme = {
  icon: { cursor: '❯' },
  style: {
    searchTerm: (value: string) => styleText('cyan', value),
    description: (value: string) => styleText('cyan', value),
    keysHelpTip: () =>
      `${styleText('bold', '↑↓')} ${styleText('dim', 'navigate')} • ${styleText('bold', '⏎')} ${styleText('dim', 'select')}`,
  },
}

// @inquirer/search clears Readline's input buffer during arrow navigation,
// which makes the next typed character replace the visible search term.
const searchPrompt = createPrompt<string, SearchConfig>((config, done) => {
  const theme = makeTheme(searchTheme)
  const [status, setStatus] = useState<'idle' | 'done'>('idle')
  const [term, setTerm] = useState('')
  const choices = useMemo(
    () => config.source(term || undefined),
    [config.source, term],
  )
  const [active, setActive] = useState(0)
  const selected = choices[active]
  const prefix = usePrefix({ status, theme })

  useKeypress((key, readline) => {
    if (isEnterKey(key)) {
      if (selected != null) {
        setStatus('done')
        done(selected.value)
      }
      return
    }

    if (isUpKey(key) || isDownKey(key)) {
      if (choices.length === 0) return
      const offset = isUpKey(key) ? -1 : 1
      setActive(Math.max(0, Math.min(choices.length - 1, active + offset)))
      return
    }

    setTerm(readline.line)
    setActive(0)
  })

  const message = theme.style.message(config.message, status)
  if (status === 'done' && selected != null) {
    return [prefix, message, theme.style.answer(selected.name)]
      .filter(Boolean)
      .join(' ')
  }

  const page = usePagination({
    items: choices,
    active,
    pageSize: config.pageSize ?? 7,
    loop: false,
    renderItem({ item, isActive }) {
      const cursor = isActive ? searchTheme.icon.cursor : ' '
      const color = isActive ? theme.style.highlight : (value: string) => value
      return color(`${cursor} ${item.name}`)
    },
  })
  const header = [prefix, message, theme.style.searchTerm(term)]
    .filter(Boolean)
    .join(' ')
    .trimEnd()
  const body = [
    choices.length === 0 ? theme.style.error('No results found') : page,
    selected?.description == null
      ? undefined
      : theme.style.description(selected.description),
    theme.style.keysHelpTip(),
  ]
    .filter(Boolean)
    .join('\n')

  return [header, body]
})

export function stableSearch(config: SearchConfig): Promise<string> {
  return searchPrompt(config)
}
