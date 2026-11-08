// Simple glob matching (for patterns like /backend/**)
export function matchGlob(path: string, pattern: string): boolean {
  // Normalize paths
  const normalizedPath = path.replace(/\\/g, '/')
  const normalizedPattern = pattern.replace(/\\/g, '/')

  // Convert glob to regex
  const regexPattern = normalizedPattern
    .replace(/\*\*/g, '{{DOUBLESTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/{{DOUBLESTAR}}/g, '.*')
    .replace(/\//g, '\\/')

  const regex = new RegExp(`^${regexPattern}$`)
  return regex.test(normalizedPath)
}
