import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import axios, { setMuapiKey } from './axios'

interface BridgeResponse {
  ok: boolean
  status: number
  statusText: string
  body: string
}

const okJson = (payload: unknown): BridgeResponse => ({
  ok: true,
  status: 200,
  statusText: 'OK',
  body: JSON.stringify(payload)
})

const request = vi.fn()
const uploadSigned = vi.fn()

beforeEach(() => {
  request.mockReset().mockResolvedValue(okJson({ ok: true }))
  uploadSigned.mockReset().mockResolvedValue({ ok: true, status: 204, statusText: 'No Content', body: '' })
  ;(window as unknown as Record<string, unknown>).hermesDesktop = {
    studio: { request, uploadSigned }
  }
  setMuapiKey('')
})

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).hermesDesktop
})

const requestedUrl = (): string => (request.mock.calls[0][0] as { url: string }).url
const requestedHeaders = (): Record<string, string> =>
  (request.mock.calls[0][0] as { headers: Record<string, string> }).headers

describe('URL rewrite table', () => {
  it('rewrites /api/api/v1/* to the muapi /api/v1 origin', async () => {
    await axios.get('/api/api/v1/predictions/xyz/result')

    expect(requestedUrl()).toBe('https://api.muapi.ai/api/v1/predictions/xyz/result')
  })

  it('rewrites /api/v1/creative-agent/* keeping the path', async () => {
    await axios.get('/api/v1/creative-agent/sessions')

    expect(requestedUrl()).toBe('https://api.muapi.ai/api/v1/creative-agent/sessions')
  })

  it('rewrites /api/v1/get_upload_url to /app/get_file_upload_url with params', async () => {
    await axios.get('/api/v1/get_upload_url', { params: { filename: 'a b.png' } })

    expect(requestedUrl()).toBe('https://api.muapi.ai/app/get_file_upload_url?filename=a+b.png')
  })

  it('rewrites /api/workflow/*', async () => {
    await axios.get('/api/workflow/cloudfront-signed-url')

    expect(requestedUrl()).toBe('https://api.muapi.ai/workflow/cloudfront-signed-url')
  })

  it('rewrites /api/agents/*', async () => {
    await axios.put('/api/agents/by-slug/helper', { theme: 'dark' })

    expect(requestedUrl()).toBe('https://api.muapi.ai/agents/by-slug/helper')
  })

  it('rewrites /api/app/*', async () => {
    await axios.get('/api/app/get_file_upload_url', { params: { filename: 'x.png' } })

    expect(requestedUrl()).toBe('https://api.muapi.ai/app/get_file_upload_url?filename=x.png')
  })

  it('passes absolute URLs through untouched', async () => {
    await axios.get('https://api.muapi.ai/agents/templates')

    expect(requestedUrl()).toBe('https://api.muapi.ai/agents/templates')
  })
})

describe('headers and body', () => {
  it('injects x-api-key once a key is set', async () => {
    setMuapiKey('sk-test')
    await axios.get('/api/agents/mine')

    expect(requestedHeaders()['x-api-key']).toBe('sk-test')
  })

  it('omits x-api-key when no key is set', async () => {
    await axios.get('/api/agents/templates')

    expect(requestedHeaders()['x-api-key']).toBeUndefined()
  })

  it('serialises JSON bodies with a content-type header', async () => {
    await axios.post('/api/agents', { name: 'bot' })

    const call = request.mock.calls[0][0] as { method: string; body: string; headers: Record<string, string> }
    expect(call.method).toBe('POST')
    expect(call.body).toBe(JSON.stringify({ name: 'bot' }))
    expect(call.headers['Content-Type']).toBe('application/json')
  })

  it('supports patch and delete with config.data', async () => {
    await axios.patch('/api/v1/creative-agent/sessions/1', { name: 'renamed' })
    await axios.delete('/api/agents/by-slug/bot', { data: { hard: true } })

    const patchCall = request.mock.calls[0][0] as { method: string }
    const deleteCall = request.mock.calls[1][0] as { method: string; body: string }
    expect(patchCall.method).toBe('PATCH')
    expect(deleteCall.method).toBe('DELETE')
    expect(deleteCall.body).toBe(JSON.stringify({ hard: true }))
  })
})

describe('responses and errors', () => {
  it('parses JSON bodies into response.data', async () => {
    request.mockResolvedValue(okJson({ agents: [1, 2] }))

    const response = await axios.get('/api/agents/templates')

    expect(response.status).toBe(200)
    expect(response.data).toEqual({ agents: [1, 2] })
  })

  it('returns raw text when the body is not JSON', async () => {
    request.mockResolvedValue({ ok: true, status: 200, statusText: 'OK', body: 'plain' })

    const response = await axios.get('/api/agents/templates')

    expect(response.data).toBe('plain')
  })

  it('throws an axios-shaped error exposing response.data.detail', async () => {
    request.mockResolvedValue({
      ok: false,
      status: 422,
      statusText: 'Unprocessable Entity',
      body: JSON.stringify({ detail: 'bad input' })
    })

    let caught: unknown
    try {
      await axios.post('/api/agents', {})
    } catch (error) {
      caught = error
    }

    const axiosError = caught as { response?: { data?: { detail?: string }; status?: number }; message: string }
    expect(axiosError.response?.status).toBe(422)
    expect(axiosError.response?.data?.detail).toBe('bad input')
    expect(caught).toBeInstanceOf(Error)
  })
})

describe('FormData uploads', () => {
  it('routes /api/v1/upload-binary through uploadSigned with the proxy target extracted', async () => {
    setMuapiKey('sk-test')
    const form = new FormData()
    form.append('key', 'uploads/a.png')
    form.append('x-proxy-target-url', 'https://bucket.s3.amazonaws.com/')
    form.append('file', new File(['data'], 'a.png', { type: 'image/png' }))

    await axios.post('/api/v1/upload-binary', form)

    expect(request).not.toHaveBeenCalled()
    const call = uploadSigned.mock.calls[0][0] as {
      url: string
      parts: Array<{ kind: string; name: string; value?: string; filename?: string }>
    }
    expect(call.url).toBe('https://bucket.s3.amazonaws.com/')
    expect(call.parts.some(part => part.name === 'x-proxy-target-url')).toBe(false)
    expect(call.parts[0]).toMatchObject({ kind: 'field', name: 'key', value: 'uploads/a.png' })
    expect(call.parts.at(-1)).toMatchObject({ kind: 'file', name: 'file', filename: 'a.png', type: 'image/png' })
  })

  it('routes absolute presigned POSTs through uploadSigned preserving field order', async () => {
    const form = new FormData()
    form.append('policy', 'abc')
    form.append('signature', 'def')
    form.append('file', new File(['bytes'], 'clip.mp4', { type: 'video/mp4' }))

    await axios.post('https://bucket.s3.us-east-1.amazonaws.com/', form, {
      headers: { 'Content-Type': 'multipart/form-data' }
    })

    const call = uploadSigned.mock.calls[0][0] as {
      url: string
      parts: Array<{ kind: string; name: string; bytes?: Uint8Array }>
    }
    expect(call.url).toBe('https://bucket.s3.us-east-1.amazonaws.com/')
    expect(call.parts.map(part => part.name)).toEqual(['policy', 'signature', 'file'])
    const filePart = call.parts.at(-1) as { bytes: Uint8Array }
    expect(new TextDecoder().decode(filePart.bytes)).toBe('bytes')
  })
})
