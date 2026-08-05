import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import path from 'node:path'
import fs from 'node:fs/promises'
import os from 'node:os'
import { getObjectStore } from '@/lib/object-store'

let tmpDir: string

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rudder-object-store-'))
  process.env.GCS_BUCKET = `fs:${tmpDir}`
})

afterAll(async () => {
  delete process.env.GCS_BUCKET
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('getObjectStore (fs: backend, real disk — not the fake test store)', () => {
  it('round-trips real bytes through the filesystem', async () => {
    const store = getObjectStore()
    const data = Buffer.from('hello attachment bytes')
    await store.save('issues/1/legit', data, 'text/plain')
    const back = await store.read('issues/1/legit')
    expect(back.equals(data)).toBe(true)
  })

  it('rejects a relative traversal key instead of writing/reading outside the base directory', async () => {
    const store = getObjectStore()
    await expect(store.save('../../evil', Buffer.from('x'), 'text/plain'))
      .rejects.toThrow(/escapes base directory/)
    await expect(store.read('../../evil')).rejects.toThrow(/escapes base directory/)
    // Confirm it actually didn't land two directories up from tmpDir.
    await expect(fs.readFile(path.resolve(tmpDir, '../../evil'))).rejects.toThrow()
  })

  it('rejects an absolute-path key instead of escaping the base directory', async () => {
    const store = getObjectStore()
    await expect(store.save('/etc/rudder-should-not-write-here', Buffer.from('x'), 'text/plain'))
      .rejects.toThrow(/escapes base directory/)
  })
})
