// Maps an ApiError's `issues` (Task 5's parse-failure envelope) to a
// path -> message lookup, so a form can render the specific field message
// next to the input it names instead of only the generic form-level line.
import { ApiError } from './api'

export function fieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError) || !error.issues) return {}
  // Two issues sharing a `path` would keep only the last — none of today's
  // schemas can produce that (zod short-circuits per-field), but a future
  // schema with an overlapping refine on the same path could.
  return Object.fromEntries(error.issues.map((issue) => [issue.path, issue.message]))
}
