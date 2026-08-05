import fs from 'node:fs/promises'
import path from 'node:path'
import { Storage } from '@google-cloud/storage'

export type ObjectStore = {
  save(object: string, data: Buffer, contentType: string): Promise<void>
  read(object: string): Promise<Buffer>
  delete(object: string): Promise<void>
}

let cached: ObjectStore | null = null

// The only caller today (the upload route) always passes a server-generated
// `issues/<id>/<uuid>` key, so this guard is currently unreachable — but the
// property it protects (no object key may resolve outside the store's base
// directory) belongs here, not in a caller that happens to be careful. A
// future caller that forwards any less-trusted string must not be able to
// turn this into a path-traversal write/read.
function safeFsPath(dir: string, object: string): string {
  const base = path.resolve(dir)
  const resolved = path.resolve(base, object)
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new Error(`object-store: key escapes base directory: ${object}`)
  }
  return resolved
}

// Tests inject a fake here (tests/helpers/db.ts pattern, same as __rudderTestDb).
export function getObjectStore(): ObjectStore {
  const testStore = (globalThis as { __rudderTestStore?: ObjectStore }).__rudderTestStore
  if (testStore) return testStore
  if (!cached) {
    const bucketName = process.env.GCS_BUCKET
    if (!bucketName) throw new Error('GCS_BUCKET not configured')
    // "fs:<dir>" stores objects on the local filesystem — E2E and GCP-less
    // local dev use this; production uses a real bucket name.
    if (bucketName.startsWith('fs:')) {
      const dir = bucketName.slice(3)
      cached = {
        async save(object, data) {
          const file = safeFsPath(dir, object)
          await fs.mkdir(path.dirname(file), { recursive: true })
          await fs.writeFile(file, data)
        },
        async read(object) { return fs.readFile(safeFsPath(dir, object)) },
        async delete(object) { await fs.rm(safeFsPath(dir, object), { force: true }) },
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
