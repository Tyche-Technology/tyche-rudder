import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import path from 'node:path'
import fs from 'node:fs/promises'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { getObjectStore, type ObjectStore } from '@/lib/object-store'

let tmpDir: string
const objectKey = 'issues/1/00000000-0000-4000-8000-000000000001'

function flatPath(key: string): string {
  return path.join(tmpDir, createHash('sha256').update(key).digest('hex'))
}

async function createStoredSymlink(key: string, target: string): Promise<void> {
  await fs.symlink(target, flatPath(key))
}

beforeAll(async () => {
  tmpDir = path.resolve('.rudder-objects', `test-${process.pid}`)
  await fs.rm(tmpDir, { recursive: true, force: true })
  await fs.mkdir(tmpDir, { recursive: true })
  process.env.GCS_BUCKET = 'fs'
})

afterAll(async () => {
  delete process.env.GCS_BUCKET
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('getObjectStore (fs: backend, real disk — not the fake test store)', () => {
  it('rejects the filesystem backend in production even when a test flag is present', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('RUDDER_E2E', 'true')
    try {
      expect(() => getObjectStore()).toThrow(/filesystem backend is disabled in production/)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('ignores an injected test store in production', () => {
    const injected: ObjectStore = {
      async save() {},
      async read() { return Buffer.from('bypass') },
      async delete() {},
    }
    ;(globalThis as { __rudderTestStore?: ObjectStore }).__rudderTestStore = injected
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('GCS_BUCKET', '')
    try {
      expect(() => getObjectStore()).toThrow(/GCS_BUCKET not configured/)
    } finally {
      delete (globalThis as { __rudderTestStore?: ObjectStore }).__rudderTestStore
      vi.unstubAllEnvs()
    }
  })

  it('round-trips real bytes through the filesystem', async () => {
    const store = getObjectStore()
    const data = Buffer.from('hello attachment bytes')
    await store.save(objectKey, data, 'text/plain')
    const back = await store.read(objectKey)
    expect(back.equals(data)).toBe(true)
  })

  it('rejects keys that are not server-generated issue attachment keys', async () => {
    const store = getObjectStore()
    await expect(store.save('issues/1/not-a-uuid', Buffer.from('x'), 'text/plain'))
      .rejects.toThrow(/invalid object key/)
  })

  it('rejects a relative traversal key instead of writing/reading outside the base directory', async () => {
    const store = getObjectStore()
    await expect(store.save('../../evil', Buffer.from('x'), 'text/plain'))
      .rejects.toThrow(/invalid object key/)
    await expect(store.read('../../evil')).rejects.toThrow(/invalid object key/)
    // Confirm it actually didn't land two directories up from tmpDir.
    await expect(fs.readFile(path.resolve(tmpDir, '../../evil'))).rejects.toThrow()
  })

  it('rejects an absolute-path key instead of escaping the base directory', async () => {
    const store = getObjectStore()
    await expect(store.save('/etc/rudder-should-not-write-here', Buffer.from('x'), 'text/plain'))
      .rejects.toThrow(/invalid object key/)
  })

  it('does not follow a pre-existing symlink while saving', async () => {
    const key = 'issues/2/00000000-0000-4000-8000-000000000002'
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rudder-object-store-outside-'))
    const outside = path.join(outsideDir, 'target')
    await fs.writeFile(outside, 'safe')
    try {
      await createStoredSymlink(key, outside)
      const store = getObjectStore()
      await expect(store.save(key, Buffer.from('overwritten'), 'text/plain')).rejects.toThrow()
      expect(await fs.readFile(outside, 'utf8')).toBe('safe')
    } finally {
      await fs.rm(outsideDir, { recursive: true, force: true })
    }
  })

  it('does not follow a pre-existing symlink while reading', async () => {
    const key = 'issues/3/00000000-0000-4000-8000-000000000003'
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rudder-object-store-outside-read-'))
    const outside = path.join(outsideDir, 'target')
    await fs.writeFile(outside, 'outside')
    try {
      await createStoredSymlink(key, outside)
      const store = getObjectStore()
      await expect(store.read(key)).rejects.toThrow()
    } finally {
      await fs.rm(outsideDir, { recursive: true, force: true })
    }
  })
})
