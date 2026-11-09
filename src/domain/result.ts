/**
 * Result type used across the domain core for operations that can fail without
 * throwing. Domain functions return `Result` values; errors are never thrown
 * into React render (see the design's Error Handling section).
 */
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E }

/** Build a success result. */
export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value }
}

/** Build a failure result. */
export function err<E>(error: E): Result<never, E> {
  return { ok: false, error }
}

/** Type guard narrowing a Result to its success branch. */
export function isOk<T, E>(result: Result<T, E>): result is { ok: true; value: T } {
  return result.ok
}

/** Type guard narrowing a Result to its failure branch. */
export function isErr<T, E>(result: Result<T, E>): result is { ok: false; error: E } {
  return !result.ok
}
