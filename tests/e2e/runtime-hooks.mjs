const slackEndpoint = 'https://slack.com/api/chat.postMessage'
const testSlackEndpoint = 'http://127.0.0.1:3299/chat.postMessage'
const runtimeFetch = globalThis.fetch.bind(globalThis)

globalThis.fetch = (input, init) => {
  const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url
  return runtimeFetch(url === slackEndpoint ? testSlackEndpoint : input, init)
}
