// Axios shim for the vendored studio sub-packages (workflow-builder, agents,
// design-agent). Their source called axios against the Next.js app's local
// proxy routes; here every call is rewritten to the real MuAPI origin and sent
// through the Electron main-process bridge (window.hermesDesktop.studio), the
// same transport vendor/muapi.js uses, so nothing hits the network from the
// renderer. Only the axios surface those packages use is implemented:
// get/post/put/patch/delete, config.params, config.data, JSON + FormData
// bodies, and errors shaped so `error.response.data.detail` works.

interface BridgeResponse {
  ok: boolean
  status: number
  statusText: string
  body: string
}

interface UploadPart {
  kind: 'field' | 'file'
  name: string
  value?: string
  filename?: string
  type?: string
  bytes?: Uint8Array
}

interface StudioBridge {
  request: (req: {
    url: string
    method: string
    headers: Record<string, string>
    body?: string
  }) => Promise<BridgeResponse>
  uploadSigned: (req: { url: string; parts: UploadPart[] }) => Promise<BridgeResponse>
}

export interface AxiosRequestConfig {
  headers?: Record<string, string>
  params?: Record<string, unknown>
  data?: unknown
  // Progress callbacks are accepted but not emitted: the IPC bridge is a
  // single round-trip, so there is no incremental progress to report.
  onUploadProgress?: (event: { loaded: number; total: number }) => void
}

export interface AxiosResponse<T = unknown> {
  data: T
  status: number
  statusText: string
  headers: Record<string, string>
}

export class AxiosError extends Error {
  response?: { data: unknown; status: number; statusText: string }
}

const MUAPI_ORIGIN = 'https://api.muapi.ai'
const PROXY_TARGET_FIELD = 'x-proxy-target-url'

let muapiKey = ''

/** Hosts call this with the stored studio key so vendored calls authenticate. */
export function setMuapiKey(key: string): void {
  muapiKey = key
}

function bridge(): StudioBridge {
  const studio = (
    window as unknown as { hermesDesktop?: { studio?: Partial<StudioBridge> } }
  ).hermesDesktop?.studio

  if (!studio?.request || !studio.uploadSigned) {
    throw new AxiosError('Studio bridge unavailable: hermesDesktop.studio is not exposed')
  }

  return studio as StudioBridge
}

// Rewrite table mirroring the source Next.js app's proxy routes, in match
// order. `/api/api/v1` is the doubled prefix the sub-packages use for the
// generic MuAPI passthrough route.
function rewriteUrl(url: string): string {
  if (/^https?:\/\//.test(url)) {return url}

  if (url.startsWith('/api/api/v1/')) {return `${MUAPI_ORIGIN}${url.slice('/api'.length)}`}

  if (url.startsWith('/api/v1/creative-agent')) {return `${MUAPI_ORIGIN}${url}`}

  if (url === '/api/v1/get_upload_url') {return `${MUAPI_ORIGIN}/app/get_file_upload_url`}

  if (url.startsWith('/api/workflow/')) {return `${MUAPI_ORIGIN}${url.slice('/api'.length)}`}

  if (url.startsWith('/api/agents')) {return `${MUAPI_ORIGIN}${url.slice('/api'.length)}`}

  if (url.startsWith('/api/app/')) {return `${MUAPI_ORIGIN}${url.slice('/api'.length)}`}

  throw new AxiosError(`Unmapped studio URL: ${url}`)
}

function appendParams(url: string, params?: Record<string, unknown>): string {
  if (!params || Object.keys(params).length === 0) {return url}

  const search = new URLSearchParams()

  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {search.append(name, String(value))}
  }

  const query = search.toString()

  if (!query) {return url}

  return url.includes('?') ? `${url}&${query}` : `${url}?${query}`
}

function parseBody(body: string): unknown {
  if (!body) {return body}

  try {
    return JSON.parse(body)
  } catch {
    return body
  }
}

function toResponse<T>(raw: BridgeResponse): AxiosResponse<T> {
  const data = parseBody(raw.body)

  if (!raw.ok) {
    const error = new AxiosError(`Request failed with status code ${raw.status}`)
    error.response = { data, status: raw.status, statusText: raw.statusText }
    throw error
  }

  return { data: data as T, status: raw.status, statusText: raw.statusText, headers: {} }
}

async function formDataToParts(form: FormData): Promise<UploadPart[]> {
  const parts: UploadPart[] = []

  for (const [name, value] of form.entries()) {
    if (typeof value === 'string') {
      parts.push({ kind: 'field', name, value })
    } else {
      const buffer = await value.arrayBuffer()
      parts.push({
        kind: 'file',
        name,
        filename: value.name || 'file',
        type: value.type || 'application/octet-stream',
        bytes: new Uint8Array(buffer)
      })
    }
  }

  return parts
}

async function sendFormData(url: string, form: FormData): Promise<AxiosResponse> {
  const parts = await formDataToParts(form)
  const isUploadBinaryProxy = url === '/api/v1/upload-binary' || url === '/api/upload-binary'
  let targetUrl = url

  if (isUploadBinaryProxy) {
    const target = parts.find(part => part.name === PROXY_TARGET_FIELD)

    if (!target?.value) {
      throw new AxiosError('upload-binary call is missing its x-proxy-target-url field')
    }

    targetUrl = target.value
  } else if (!/^https?:\/\//.test(url)) {
    throw new AxiosError(`FormData uploads must target a presigned URL, got: ${url}`)
  }

  const uploadParts = parts.filter(part => part.name !== PROXY_TARGET_FIELD)
  const raw = await bridge().uploadSigned({ url: targetUrl, parts: uploadParts })

  return toResponse(raw)
}

async function send<T>(
  method: string,
  url: string,
  data?: unknown,
  config: AxiosRequestConfig = {}
): Promise<AxiosResponse<T>> {
  if (data instanceof FormData) {
    return (await sendFormData(url, data)) as AxiosResponse<T>
  }

  const headers: Record<string, string> = { ...config.headers }

  if (muapiKey) {headers['x-api-key'] = muapiKey}

  let body: string | undefined
  const payload = data ?? config.data

  if (payload !== undefined) {
    body = JSON.stringify(payload)
    headers['Content-Type'] = headers['Content-Type'] ?? 'application/json'
  }

  const targetUrl = appendParams(rewriteUrl(url), config.params)
  const raw = await bridge().request({ url: targetUrl, method, headers, body })

  return toResponse<T>(raw)
}

const axios = {
  delete: <T = unknown>(url: string, config?: AxiosRequestConfig) =>
    send<T>('DELETE', url, undefined, config),
  get: <T = unknown>(url: string, config?: AxiosRequestConfig) =>
    send<T>('GET', url, undefined, config),
  patch: <T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig) =>
    send<T>('PATCH', url, data, config),
  post: <T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig) =>
    send<T>('POST', url, data, config),
  put: <T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig) =>
    send<T>('PUT', url, data, config)
}

export default axios
