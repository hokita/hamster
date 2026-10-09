import { describe, it, expect } from 'vitest'
import { parseVisualSummary, InvalidVisualSummaryError } from './visualSummary'

const cards = {
  type: 'cards',
  title: 'Key points',
  items: [{ title: 'A', text: 'Supported fact' }],
}
const table = {
  type: 'comparison',
  title: 'Options',
  columns: ['Option', 'Price'],
  rows: [
    ['A', '$10'],
    ['B', '$20'],
  ],
}
const steps = { type: 'steps', title: 'Procedure', items: ['First step'] }
const qa = { type: 'qa', title: 'Questions', items: [{ question: 'Why?', answer: 'Because.' }] }

describe('visual summary validation', () => {
  it('accepts all supported blocks in model-selected order, or just one type', () => {
    const value = { blocks: [qa, steps, cards, table] }
    expect(parseVisualSummary(value)).toEqual(value)
    expect(parseVisualSummary({ blocks: [cards] })).toEqual({ blocks: [cards] })
  })

  it.each([
    null,
    [],
    {},
    { blocks: [] },
    { blocks: Array(7).fill(cards) },
    { blocks: [null] },
    { blocks: [{ ...cards, type: 'html' }] },
    { blocks: [cards], script: 'alert(1)' },
    { blocks: [{ ...cards, jsx: '<App />' }] },
    { blocks: [{ ...cards, title: ' ' }] },
    { blocks: [{ ...cards, title: 12 }] },
    { blocks: [{ ...cards, title: 'x'.repeat(121) }] },
    { blocks: [{ ...cards, items: [] }] },
    { blocks: [{ ...cards, items: Array(7).fill(cards.items[0]) }] },
    { blocks: [{ ...cards, items: [{ title: 'A', text: 'x'.repeat(1201) }] }] },
    { blocks: [{ ...cards, items: [{ title: 'A', text: 'fact', onClick: 'alert(1)' }] }] },
    { blocks: [{ ...table, columns: ['A'] }] },
    { blocks: [{ ...table, columns: Array(6).fill('A') }] },
    { blocks: [{ ...table, rows: [['A', 'B']] }] },
    { blocks: [{ ...table, rows: Array(9).fill(['A', 'B']) }] },
    { blocks: [{ ...table, rows: [['A'], ['B', 'C']] }] },
    {
      blocks: [
        {
          ...table,
          rows: [
            ['A', 'x'.repeat(401)],
            ['B', 'C'],
          ],
        },
      ],
    },
    { blocks: [{ ...steps, items: Array(11).fill('A') }] },
    { blocks: [{ ...steps, items: [''] }] },
    { blocks: [{ ...qa, items: [{ question: 'x'.repeat(201), answer: 'A' }] }] },
    { blocks: [{ ...qa, items: Array(7).fill(qa.items[0]) }] },
    { blocks: [{ ...qa, items: [{ question: 'Why?' }] }] },
  ])('rejects malformed, unknown, oversized or extra fields: %#', (value) => {
    expect(() => parseVisualSummary(value)).toThrow(InvalidVisualSummaryError)
  })

  it('accepts maximum lengths and rectangular tables', () => {
    const value = {
      blocks: [
        {
          type: 'cards',
          title: 'x'.repeat(120),
          items: [{ title: 'x'.repeat(120), text: 'x'.repeat(1200) }],
        },
      ],
    }
    expect(parseVisualSummary(value)).toEqual(value)
  })
})
