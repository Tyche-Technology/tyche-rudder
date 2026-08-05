import { constants } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { Storage } from '@google-cloud/storage'

export type ObjectStore = {
  save(object: string, data: Buffer, contentType: string): Promise<void>
  read(object: string): Promise<Buffer>
  delete(object: string): Promise<void>
}

let cached: ObjectStore | null = null

const OBJECT_KEY = /^issues\/[1-9]\d*\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function localFsDirectory(): string {
  if (process.env.RUDDER_E2E === 'true') return path.join(os.tmpdir(), 'rudder-e2e-t12', 'objects')
  if (process.env.NODE_ENV === 'production') {
    throw new Error('object-store: filesystem backend is disabled in production')
  }
  if (process.env.NODE_ENV === 'test') return path.join(os.tmpdir(), `rudder-object-store-${process.pid}`)
  return path.join(os.tmpdir(), 'rudder-object-store-dev')
}

function localFsPath(dir: string, object: string): string {
  if (!OBJECT_KEY.test(object)) throw new Error('object-store: invalid object key')
  return path.join(dir, createHash('sha256').update(object).digest('hex'))
}

async function prepareFsDirectory(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 })
  if (!(await fs.lstat(dir)).isDirectory()) throw new Error('object-store: filesystem root is not a directory')
  await fs.chmod(dir, 0o700)
}

// Tests inject a fake here (tests/helpers/db.ts pattern, same as __rudderTestDb).
export function getObjectStore(): ObjectStore {
  const testStore = (globalThis as { __rudderTestStore?: ObjectStore }).__rudderTestStore
  if (testStore) return testStore
  if (!cached) {
    const bucketName = process.env.GCS_BUCKET
    if (!bucketName) throw new Error('GCS_BUCKET not configured')
    if (bucketName === 'fs') {
      const dir = localFsDirectory()
      cached = {
        async save(object, data) {
          await prepareFsDirectory(dir)
          await fs.writeFile(localFsPath(dir, object), data, { flag: 'wx', mode: 0o600 })
        },
        async read(object) {
          await prepareFsDirectory(dir)
          const handle = await fs.open(localFsPath(dir, object), constants.O_RDONLY | constants.O_NOFOLLOW)
          try { return await handle.readFile() } finally { await handle.close() }
        },
        async delete(object) {
          await prepareFsDirectory(dir)
          await fs.rm(localFsPath(dir, object), { force: true })
        },
      }
    } else {
      const bucket = new Storage().bucket(bucketName)
      cached = {
        async save(object, data, contentType) { await bucket.file(object).save(data, { contentType }) },
        async read(object) { const [buf] = await bucket.file(object).download(); return buf },
        async delete(object) { await bucket.file(object).delete({ ignoreNotFound: true }) },
      }
    }
  }
  return cached
}
