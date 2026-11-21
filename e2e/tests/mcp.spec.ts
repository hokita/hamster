import { test, expect, type APIRequestContext } from '@playwright/test'
import { clearFirestore } from '../fixtures/firestore'

const MCP_URL = 'http://localhost:8090/mcp'
const TOKEN = 'e2e-fake-mcp-token-for-the-emulator-only-0000000000000000'

type RpcResponse = {
  result?: {
    content?: { type: string; text: string }[]
    isError?: boolean
    tools?: { name: string }[]
  }
}

function parseRpc(body: string): RpcResponse {
  const data = body
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .join('')
  return JSON.parse(data || body)
}

async function rpc(request: APIRequestContext, method: string, params?: unknown) {
  const res = await request.post(MCP_URL, {
    headers: {
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TOKEN}`,
    },
    data: { jsonrpc: '2.0', id: 1, method, params },
  })
  expect(res.status()).toBe(200)
  return parseRpc(await res.text())
}

async function callTool(request: APIRequestContext, name: string, args: unknown) {
  const { result } = await rpc(request, 'tools/call', { name, arguments: args })
  const first = result?.content?.[0]?.text ?? ''
  return { isError: result?.isError === true, text: first }
}

test.describe('mcp', () => {
  test.beforeEach(async () => {
    await clearFirestore()
  })

  test('rejects a call without the token', async ({ request }) => {
    const res = await request.post(MCP_URL, {
      headers: {
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
      },
      data: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    })
    expect(res.status()).toBe(401)
  })

  test('rejects the token on the REST API', async ({ request }) => {
    const res = await request.get('http://localhost:8090/api/bookmarks', {
      headers: { Authorization: `Bearer ${TOKEN}` },
    })
    expect(res.status()).toBe(401)
  })

  test('lists the five tools', async ({ request }) => {
    const { result } = await rpc(request, 'tools/list')
    const names = (result?.tools ?? []).map((tool) => tool.name).sort()
    expect(names).toEqual([
      'find_bookmarks',
      'open_bookmark',
      'save_link',
      'set_read',
      'summarize_bookmark',
    ])
  })

  test('saves, finds, opens and marks read', async ({ request }) => {
    const saved = await callTool(request, 'save_link', { url: 'https://example.com' })
    expect(saved.isError).toBe(false)
    const first = JSON.parse(saved.text)
    expect(first.created).toBe(true)
    expect(first.summaryStatus).toBe('failed')
    expect(first.summaryMessage).toBe("Summaries aren't set up on this server.")
    const id = first.bookmark.id as string

    const again = JSON.parse(
      (await callTool(request, 'save_link', { url: 'https://example.com' })).text
    )
    expect(again.created).toBe(false)
    expect(again.bookmark.id).toBe(id)

    const found = JSON.parse((await callTool(request, 'find_bookmarks', { query: 'example' })).text)
    expect(found.bookmarks).toHaveLength(1)

    const marked = await callTool(request, 'set_read', { id, isRead: true })
    expect(JSON.parse(marked.text)).toEqual({ id, isRead: true })

    const unread = JSON.parse((await callTool(request, 'find_bookmarks', { unread: true })).text)
    expect(unread.bookmarks).toHaveLength(0)

    const opened = JSON.parse((await callTool(request, 'open_bookmark', { id })).text)
    expect(opened.isRead).toBe(true)
  })

  test('summarize_bookmark reports a missing id', async ({ request }) => {
    const result = await callTool(request, 'summarize_bookmark', { id: 'missing-id' })
    expect(result.isError).toBe(true)
    expect(result.text).toBe('No bookmark with id missing-id')
  })
})
