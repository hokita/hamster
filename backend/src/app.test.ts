import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import request from 'supertest'
import { createApp } from './app'

describe('GET /health', () => {
  it('returns ok', async () => {
    const res = await request(createApp()).get('/health')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
  })
})

describe('GET /api/bookmarks', () => {
  it('requires authentication', async () => {
    const res = await request(createApp()).get('/api/bookmarks')
    expect(res.status).toBe(401)
  })
})

describe('CORS', () => {
  const originalFrontendUrl = process.env.FRONTEND_URL

  afterEach(() => {
    if (originalFrontendUrl === undefined) delete process.env.FRONTEND_URL
    else process.env.FRONTEND_URL = originalFrontendUrl
  })

  it('allows all origins when FRONTEND_URL is unset', async () => {
    delete process.env.FRONTEND_URL
    const res = await request(createApp()).get('/health')
    expect(res.headers['access-control-allow-origin']).toBe('*')
  })

  it('reflects FRONTEND_URL as the allowed origin when set', async () => {
    process.env.FRONTEND_URL = 'http://localhost:5173'
    const res = await request(createApp()).get('/health')
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173')
  })
})

describe('POST /mcp', () => {
  const originalToken = process.env.HAMSTER_MCP_TOKEN
  const token = 'a'.repeat(64)
  const initialize = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '0' },
    },
  }

  beforeEach(() => {
    process.env.HAMSTER_MCP_TOKEN = token
  })

  afterEach(() => {
    if (originalToken === undefined) delete process.env.HAMSTER_MCP_TOKEN
    else process.env.HAMSTER_MCP_TOKEN = originalToken
  })

  const post = (auth?: string) => {
    const req = request(createApp())
      .post('/mcp')
      .set('Accept', 'application/json, text/event-stream')
    return (auth ? req.set('Authorization', auth) : req).send(initialize)
  }

  it('rejects a missing header', async () => {
    expect((await post()).status).toBe(401)
  })

  it('rejects a wrong token', async () => {
    expect((await post('Bearer wrong')).status).toBe(401)
  })

  it('rejects a truncated token', async () => {
    expect((await post(`Bearer ${token.slice(0, 43)}`)).status).toBe(401)
  })

  it('rejects everything when the configured token is too short', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    process.env.HAMSTER_MCP_TOKEN = 'x'.repeat(42)
    expect((await post(`Bearer ${'x'.repeat(42)}`)).status).toBe(401)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('HAMSTER_MCP_TOKEN'))
    warn.mockRestore()
  })

  it('rejects everything when no token is configured', async () => {
    delete process.env.HAMSTER_MCP_TOKEN
    expect((await post(`Bearer ${token}`)).status).toBe(401)
  })

  it('does not let the MCP token into the REST API', async () => {
    const res = await request(createApp())
      .get('/api/bookmarks')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(401)
  })

  it('accepts initialize with the right token', async () => {
    expect((await post(`Bearer ${token}`)).status).toBe(200)
  })
})
