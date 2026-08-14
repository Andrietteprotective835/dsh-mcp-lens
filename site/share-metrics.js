export const CALCULATOR_URL = "https://labmimors.github.io/dsh-mcp-lens/"
export const SHARE_VERSION = 1
export const MAX_SHARE_HASH_LENGTH = 128
export const MAX_SHARE_SCHEMA_BYTES = 64 * 1024 * 1024
export const MAX_SHARE_TOOL_COUNT = MAX_SHARE_SCHEMA_BYTES

export const LENS_SURFACE = Object.freeze({
  tools: 2,
  bytes: 1114,
})

export function reductionPercent(currentBytes, lensBytes) {
  if (currentBytes <= 0 || currentBytes <= lensBytes) return 0
  return ((currentBytes - lensBytes) / currentBytes) * 100
}

export function validateShareMetrics(value) {
  const toolCount = value?.toolCount
  const bytes = value?.bytes

  if (!Number.isSafeInteger(toolCount) || toolCount < 0 || toolCount > MAX_SHARE_TOOL_COUNT) {
    throw new Error("Share toolCount must be a bounded non-negative safe integer.")
  }
  if (!Number.isSafeInteger(bytes) || bytes < 2 || bytes > MAX_SHARE_SCHEMA_BYTES) {
    throw new Error("Share bytes must be a bounded positive safe integer.")
  }

  const minimumCanonicalBytes = toolCount === 0 ? 2 : (toolCount * 2) + 1
  if (bytes < minimumCanonicalBytes) {
    throw new Error("Share metrics are not a plausible canonical JSON array measurement.")
  }

  return Object.freeze({ toolCount, bytes })
}

export function shareChecksum(value) {
  const { toolCount, bytes } = validateShareMetrics(value)
  const text = `${SHARE_VERSION}:${toolCount}:${bytes}`
  let checksum = 2166136261

  for (let index = 0; index < text.length; index += 1) {
    checksum ^= text.charCodeAt(index)
    checksum = Math.imul(checksum, 16777619)
  }

  return checksum >>> 0
}

export function buildShareHash(value) {
  const metrics = validateShareMetrics(value)
  const checksum = shareChecksum(metrics)
  return `#v=${SHARE_VERSION}&tools=${metrics.toolCount}&bytes=${metrics.bytes}&check=${checksum}`
}

export function parseShareHash(hash) {
  if (typeof hash !== "string" || hash.length === 0 || hash.length > MAX_SHARE_HASH_LENGTH) return null

  const match = /^#?v=(\d+)&tools=(\d+)&bytes=(\d+)&check=(\d+)$/.exec(hash)
  if (!match) return null

  const [, versionText, toolCountText, bytesText, checksumText] = match
  if (![versionText, toolCountText, bytesText, checksumText].every(isCanonicalUnsignedInteger)) return null
  if (Number(versionText) !== SHARE_VERSION) return null

  try {
    const metrics = validateShareMetrics({
      toolCount: Number(toolCountText),
      bytes: Number(bytesText),
    })
    if (Number(checksumText) !== shareChecksum(metrics)) return null
    return metrics
  } catch {
    return null
  }
}

export function buildShareUrl(value) {
  return `${CALCULATOR_URL}${buildShareHash(value)}`
}

export function buildShareMarkdown(value) {
  const metrics = validateShareMetrics(value)
  const reduction = reductionPercent(metrics.bytes, LENS_SURFACE.bytes).toFixed(3)
  const label = [
    "Self-reported local measurement:",
    `${formatInteger(metrics.toolCount)} model-facing tools /`,
    `${formatInteger(metrics.bytes)} canonical schema bytes;`,
    `${reduction}% schema-byte reduction versus MCP Lens's fixed two-tool component benchmark.`,
  ].join(" ")

  return `[${label}](${buildShareUrl(metrics)}) Schema bytes only—not tokens, billing, latency, or task quality.`
}

function isCanonicalUnsignedInteger(value) {
  return /^(?:0|[1-9]\d*)$/.test(value)
}

function formatInteger(value) {
  return new Intl.NumberFormat("en-US").format(value)
}
