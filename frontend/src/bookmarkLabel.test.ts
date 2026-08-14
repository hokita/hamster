import { describe, it, expect } from 'vitest'
import { describeBookmark } from './bookmarkLabel'

describe('describeBookmark', () => {
  it('names a bookmark by title and hostname', () => {
    expect(describeBookmark({ title: 'Example Site', url: 'https://example.com' })).toBe(
      'Example Site on example.com'
    )
  })

  it('drops a bare "/" path so a site root reads as its hostname alone', () => {
    expect(describeBookmark({ title: 'Example Site', url: 'https://example.com/' })).toBe(
      'Example Site on example.com'
    )
  })

  it('separates two same-titled bookmarks on the same site by their paths', () => {
    const first = describeBookmark({ title: 'Weekly notes', url: 'https://blog.example/2024/01' })
    const second = describeBookmark({ title: 'Weekly notes', url: 'https://blog.example/2024/02' })

    expect(first).toBe('Weekly notes on blog.example/2024/01')
    expect(second).toBe('Weekly notes on blog.example/2024/02')
    expect(first).not.toBe(second)
  })

  it('keeps a query and fragment, which can be all that separates two entries', () => {
    expect(describeBookmark({ title: 'Search', url: 'https://example.com/s?q=widgets#top' })).toBe(
      'Search on example.com/s?q=widgets#top'
    )
  })

  it('keeps a non-default port, since it is part of which site this is', () => {
    expect(describeBookmark({ title: 'Local app', url: 'http://example.com:8080/admin' })).toBe(
      'Local app on example.com:8080/admin'
    )
  })

  it('leaves the scheme out — a screen reader would read it in full and it separates nothing', () => {
    expect(
      describeBookmark({ title: 'Example Site', url: 'https://example.com/page' })
    ).not.toMatch(/https/)
  })

  it('falls back to the raw string when the URL cannot be parsed', () => {
    expect(describeBookmark({ title: 'Example Site', url: 'https://exa mple.com' })).toBe(
      'Example Site on https://exa mple.com'
    )
  })
})
