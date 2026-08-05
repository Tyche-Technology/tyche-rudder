export const errorType = (error: unknown) => error instanceof Error ? 'Error' : 'NonError'
