/** Fine-grained policy for capabilities hidden behind the single mcp_call tool. */

export interface ToolPolicy {
  allows(server: string, tool: string): boolean
  denialReason(server: string, tool: string): string
}

/** Match a string against a tiny, auditable glob language: `*` and literals. */
export function globMatches(pattern: string, value: string): boolean {
  let patternIndex = 0
  let valueIndex = 0
  let starIndex = -1
  let retryValueIndex = -1

  while (valueIndex < value.length) {
    if (patternIndex < pattern.length && pattern[patternIndex] === value[valueIndex]) {
      patternIndex += 1
      valueIndex += 1
      continue
    }
    if (patternIndex < pattern.length && pattern[patternIndex] === '*') {
      starIndex = patternIndex
      retryValueIndex = valueIndex
      patternIndex += 1
      continue
    }
    if (starIndex >= 0) {
      patternIndex = starIndex + 1
      retryValueIndex += 1
      valueIndex = retryValueIndex
      continue
    }
    return false
  }
  while (patternIndex < pattern.length && pattern[patternIndex] === '*') patternIndex += 1
  return patternIndex === pattern.length
}

function validatePatterns(label: string, patterns: readonly string[]): void {
  for (const pattern of patterns) {
    if (pattern.length === 0 || pattern.length > 256 || !pattern.includes('/')) {
      throw new Error(`mcp-lens: ${label} pattern ${JSON.stringify(pattern)} must be 1-256 characters and include "/"`)
    }
  }
}

/** Compile allow/deny lists once. Deny always wins; an empty allow list allows nothing. */
export function compileToolPolicy(allow: readonly string[], deny: readonly string[]): ToolPolicy {
  validatePatterns('allowTools', allow)
  validatePatterns('denyTools', deny)
  const permitted = [...allow]
  const blocked = [...deny]
  return Object.freeze({
    allows(server: string, tool: string): boolean {
      const identity = `${server}/${tool}`
      return permitted.some(pattern => globMatches(pattern, identity))
        && !blocked.some(pattern => globMatches(pattern, identity))
    },
    denialReason(server: string, tool: string): string {
      return `mcp-lens: capability ${JSON.stringify(`${server}/${tool}`)} is blocked by allowTools/denyTools policy`
    },
  })
}
