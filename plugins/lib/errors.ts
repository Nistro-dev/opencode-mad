/** Extract a human-readable message from an unknown thrown value. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  return "Unknown error"
}

/** Extract stderr (when available) or the message from an unknown thrown value. */
export function errorOutput(error: unknown): string {
  const stderr = (error as { stderr?: unknown } | null)?.stderr
  if (stderr !== undefined && stderr !== null) {
    const output = String(stderr).trim()
    if (output !== "") return output
  }
  return errorMessage(error)
}
