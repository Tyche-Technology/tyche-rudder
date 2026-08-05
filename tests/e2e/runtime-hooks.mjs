const slackEndpoint = 'https://slack.com/api/chat.postMessage'
const testSlackEndpoint = 'http://127.0.0.1:3299/chat.postMessage'
const runtimeFetch = globalThis.fetch.bind(globalThis)
const objects = new Map()

globalThis.fetch = (input, init) => {
  const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url
  return runtimeFetch(url === slackEndpoint ? testSlackEndpoint : input, init)
}

globalThis.__rudderTestStore = {
  async save(object, data) {
    objects.set(object, Buffer.from(data))
  },
  async read(object) {
    const data = objects.get(object)
    if (!data) throw new Error('test object not found')
    return Buffer.from(data)
  },
  async delete(object) {
    objects.delete(object)
  },
}
