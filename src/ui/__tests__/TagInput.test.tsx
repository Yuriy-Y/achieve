import '@testing-library/jest-dom'
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TagInput } from '../TagInput'
import type { TagLibraryEntry } from '../../domain/tags'

const library: TagLibraryEntry[] = [
  { key: 'gym', label: 'Gym', count: 5 },
  { key: 'hills', label: 'Hills', count: 2 },
  { key: 'home', label: 'Home', count: 2 },
]

function Harness({ initial = [] as string[] }): React.ReactElement {
  const [tags, setTags] = useState<string[]>(initial)
  const [text, setText] = useState('')
  return <TagInput tags={tags} onChange={setTags} library={library} text={text} onTextChange={setText} />
}

describe('TagInput (Req 14.5-14.12)', () => {
  it('proposes the most used tags on focus and filters by prefix', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('combobox'))
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Gym', 'Hills', 'Home'])
    await user.type(screen.getByRole('combobox'), 'h')
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Hills', 'Home'])
  })

  it('accepts a suggestion with the keyboard and adopts the library spelling', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.type(screen.getByRole('combobox'), 'gy')
    await user.clear(screen.getByRole('combobox'))
    await user.type(screen.getByRole('combobox'), 'GYM{Enter}')
    expect(screen.getByText('Gym')).toBeInTheDocument()
    expect(screen.queryByText('GYM')).not.toBeInTheDocument()
  })

  it('excludes attached tags, rejects duplicates and disables at three tags', async () => {
    const user = userEvent.setup()
    render(<Harness initial={['Gym']} />)
    await user.click(screen.getByRole('combobox'))
    expect(screen.getAllByRole('option').map((o) => o.textContent)).not.toContain('Gym')
    await user.type(screen.getByRole('combobox'), 'gym{Enter}')
    expect(screen.getByRole('alert')).toHaveTextContent('already attached')
    await user.clear(screen.getByRole('combobox'))
    await user.type(screen.getByRole('combobox'), 'a{Enter}b{Enter}')
    expect(screen.getByRole('combobox')).toBeDisabled()
  })

  it('removes the last chip with Backspace and navigates suggestions with arrows', async () => {
    const user = userEvent.setup()
    render(<Harness initial={['Hills']} />)
    await user.click(screen.getByRole('combobox'))
    await user.keyboard('{ArrowDown}{Enter}')
    const chips = screen.getByRole('list', { name: 'Attached tags' })
    expect(chips).toHaveTextContent('Gym')
    await user.keyboard('{Backspace}')
    expect(chips).not.toHaveTextContent('Gym')
    expect(chips).toHaveTextContent('Hills')
  })
})
