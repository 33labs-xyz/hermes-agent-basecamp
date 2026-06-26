// Vitest global setup: provide a working `localStorage` for the jsdom suite.
//
// Node 26 ships its own experimental global `localStorage` that is gated behind
// the `--localstorage-file` flag. Under vitest + jsdom that disabled global
// shadows jsdom's Storage, so `window.localStorage` resolves to `undefined` and
// every test that reads or clears localStorage throws in setup. The app itself
// is unaffected (real Electron/Chromium has localStorage, and the store wraps it
// in try/catch), so this shim exists purely to keep the test harness honest.
//
// We only install the shim when the environment lacks a working Storage, so a
// real localStorage (should a future runtime provide one) is left untouched.

class MemoryStorage {
  private store = new Map<string, string>()

  get length(): number {
    return this.store.size
  }

  clear(): void {
    this.store.clear()
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null
  }

  removeItem(key: string): void {
    this.store.delete(key)
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value))
  }
}

function hasWorkingStorage(candidate: unknown): boolean {
  try {
    if (!candidate) return false
    const storage = candidate as Storage
    const probe = '__ls_probe__'
    storage.setItem(probe, '1')
    storage.removeItem(probe)
    return true
  } catch {
    return false
  }
}

type StorageHost = { localStorage?: unknown }

const hosts: StorageHost[] = [globalThis as StorageHost]
if (typeof window !== 'undefined' && (window as unknown) !== globalThis) {
  hosts.push(window as unknown as StorageHost)
}

if (!hosts.some(host => hasWorkingStorage(host.localStorage))) {
  const shim = new MemoryStorage()
  for (const host of hosts) {
    Object.defineProperty(host, 'localStorage', {
      configurable: true,
      value: shim
    })
  }
}
