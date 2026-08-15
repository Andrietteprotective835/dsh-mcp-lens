import {
  LENS_SURFACE as SHARED_LENS_SURFACE,
  buildShareHash,
  buildShareMarkdown,
  buildShareUrl,
  parseShareHash,
  reductionPercent as sharedReductionPercent,
} from "./share-metrics.js"

export const BENCHMARK_SOURCE_FILES = Object.freeze([
  "benchmark/run.ts",
  "benchmark/README.md",
])

export const LENS_SURFACE = Object.freeze({
  ...SHARED_LENS_SURFACE,
  source:
    "MCP Lens checked-in component benchmark at 1,000 advertised remote tools; implementation and method: benchmark/run.ts + benchmark/README.md",
  sourceFiles: BENCHMARK_SOURCE_FILES,
})

export const SAMPLE_TOOLS = Object.freeze(Array.from({ length: 1000 }, (_, index) => ({
  name: `tool_${String(index + 1).padStart(4, "0")}`,
  description: `Synthetic remote tool ${index + 1} for local calculator preview`,
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "User request" },
      limit: { type: "number", minimum: 1, maximum: 20 },
    },
    required: ["query"],
    additionalProperties: false,
  },
})))

let elements
let context
let currentResult = createResult("No payload yet.")

if (typeof document !== "undefined") initializePage()

function initializePage() {
  elements = {
    input: document.getElementById("schema-input"),
    status: document.getElementById("status"),
    toolCount: document.getElementById("tool-count"),
    schemaBytes: document.getElementById("schema-bytes"),
    lensSurface: document.getElementById("lens-surface"),
    reduction: document.getElementById("reduction"),
    currentSummary: document.getElementById("current-summary"),
    claimBoundary: document.getElementById("claim-boundary"),
    analyzeButton: document.getElementById("analyze-button"),
    sampleButton: document.getElementById("sample-button"),
    clearButton: document.getElementById("clear-button"),
    copyShareLinkButton: document.getElementById("copy-share-link-button"),
    copyMarkdownButton: document.getElementById("copy-markdown-button"),
    copyCommandButton: document.getElementById("copy-command-button"),
    downloadCardButton: document.getElementById("download-card-button"),
    canvas: document.getElementById("share-card"),
  }

  context = elements.canvas.getContext("2d")
  elements.input.value = ""
  elements.lensSurface.textContent = `${LENS_SURFACE.tools} tools / ${formatBytes(LENS_SURFACE.bytes)}`

  elements.analyzeButton.addEventListener("click", () => analyzeInput(elements.input.value))
  elements.sampleButton.addEventListener("click", () => {
    elements.input.value = JSON.stringify(SAMPLE_TOOLS, null, 2)
    analyzeInput(elements.input.value)
  })
  elements.clearButton.addEventListener("click", () => {
    elements.input.value = ""
    clearShareHash()
    currentResult = createResult("Cleared.")
    renderResult()
  })
  elements.copyShareLinkButton.addEventListener("click", async () => {
    if (!currentResult.shareUrl) return
    await navigator.clipboard.writeText(currentResult.shareUrl)
    setStatus("Copied a schema-free share link. The result is labeled self-reported.")
  })
  elements.copyMarkdownButton.addEventListener("click", async () => {
    if (!currentResult.shareMarkdown) return
    await navigator.clipboard.writeText(currentResult.shareMarkdown)
    setStatus("Copied schema-free Markdown labeled as a self-reported local measurement.")
  })
  elements.copyCommandButton.addEventListener("click", async () => {
    await navigator.clipboard.writeText(buildReproCommand())
    setStatus("Copied the local reproduction command.")
  })
  elements.downloadCardButton.addEventListener("click", () => downloadCard())

  const sharedMeasurement = parseShareHash(window.location.hash)
  if (sharedMeasurement) {
    currentResult = createMeasuredResult(
      sharedMeasurement,
      "Loaded a self-reported local measurement from the URL. The link contains no tool schemas.",
    )
    renderResult()
  } else {
    if (window.location.hash) clearShareHash()
    analyzeInput("")
  }
}

function analyzeInput(raw) {
  if (!raw.trim()) {
    clearShareHash()
    currentResult = createResult("Paste JSON to compute your current schema surface locally.")
    renderResult()
    return
  }

  try {
    const parsed = JSON.parse(raw)
    const measurement = measurePayload(parsed)
    currentResult = createMeasuredResult(
      measurement,
      `${measurement.toolCount} tools parsed locally. Exact UTF-8 bytes measured in your browser.`,
    )
    window.history.replaceState(null, "", buildShareHash(measurement))
  } catch (error) {
    clearShareHash()
    currentResult = createResult(`Could not parse the payload: ${error.message}`)
    currentResult.claimBoundary = "Paste valid JSON first."
  }

  renderResult()
}

export function extractTools(value) {
  if (Array.isArray(value)) return value
  if (value && typeof value === "object") {
    if (Array.isArray(value.tools)) return value.tools
    if (Array.isArray(value.schemas)) return value.schemas
    if (value.request && value.request.header && Array.isArray(value.request.header.tools)) {
      return value.request.header.tools
    }
    if (value.header && Array.isArray(value.header.tools)) return value.header.tools
  }

  throw new Error("Expected an array, {tools:[...]}, {schemas:[...]}, {header:{tools:[...]}}, or {request:{header:{tools:[...]}}}.")
}

export function measurePayload(value) {
  const tools = extractTools(value)
  const bytes = utf8Bytes(JSON.stringify(tools))

  return {
    toolCount: tools.length,
    bytes,
    reductionPercent: reductionPercent(bytes, LENS_SURFACE.bytes),
  }
}

function createResult(status) {
  return {
    toolCount: 0,
    bytes: 0,
    reductionPercent: 0,
    currentSummary: "0 tools / 0 B",
    shareUrl: "",
    shareMarkdown: "",
    claimBoundary: "Schema bytes only",
    status,
  }
}

function createMeasuredResult(measurement, status) {
  return {
    toolCount: measurement.toolCount,
    bytes: measurement.bytes,
    reductionPercent: reductionPercent(measurement.bytes, LENS_SURFACE.bytes),
    currentSummary: `${formatInteger(measurement.toolCount)} tools / ${formatBytes(measurement.bytes)}`,
    shareUrl: buildShareUrl(measurement),
    shareMarkdown: buildShareMarkdown(measurement),
    claimBoundary: "Self-reported local measurement. Schema bytes only; not tokens, billing, latency, or task quality.",
    status,
  }
}

function renderResult() {
  elements.toolCount.textContent = formatInteger(currentResult.toolCount)
  elements.schemaBytes.textContent = formatBytes(currentResult.bytes)
  elements.reduction.textContent = formatPercent(currentResult.reductionPercent)
  elements.currentSummary.textContent = currentResult.currentSummary
  elements.claimBoundary.textContent = currentResult.claimBoundary
  setStatus(currentResult.status)
  renderCard()
}

function setStatus(message) {
  elements.status.textContent = message
}

function renderCard() {
  const ctx = context
  const { width, height } = elements.canvas

  ctx.clearRect(0, 0, width, height)

  const gradient = ctx.createLinearGradient(0, 0, width, height)
  gradient.addColorStop(0, "#fffaf0")
  gradient.addColorStop(0.55, "#f6efe2")
  gradient.addColorStop(1, "#f0e5d5")
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, width, height)

  drawBlob(ctx, 120, 100, 320, "rgba(12,124,89,0.16)")
  drawBlob(ctx, width - 140, height - 120, 340, "rgba(217,87,43,0.14)")
  drawBlob(ctx, width - 220, 130, 240, "rgba(18,59,93,0.12)")

  ctx.fillStyle = "#0c7c59"
  ctx.font = "700 30px IBM Plex Sans, sans-serif"
  ctx.fillText("MCP Lens · self-reported local measurement", 80, 84)

  ctx.fillStyle = "#1a1712"
  ctx.font = "700 78px Iowan Old Style, Palatino Linotype, serif"
  wrapText(ctx, "How much schema are you showing the model?", 80, 170, 760, 84)

  ctx.fillStyle = "#5d5548"
  ctx.font = "400 30px IBM Plex Sans, sans-serif"
  wrapText(
    ctx,
    "Local browser measurement from your pasted payload. Exact UTF-8 canonical JSON bytes, with no upload or API call.",
    80,
    336,
    720,
    44,
  )

  const cardX = 900
  const cardY = 100
  const cardW = 620
  const cardH = 700
  roundRect(ctx, cardX, cardY, cardW, cardH, 34, "rgba(255,253,247,0.92)", "rgba(26,23,18,0.12)")

  metricBlock(ctx, cardX + 44, cardY + 60, "Your current surface", currentResult.currentSummary, "#1a1712")
  metricBlock(ctx, cardX + 44, cardY + 220, "MCP Lens benchmark surface", `${LENS_SURFACE.tools} tools / ${formatBytes(LENS_SURFACE.bytes)}`, "#0c7c59")
  metricBlock(ctx, cardX + 44, cardY + 380, "Schema-byte reduction", formatPercent(currentResult.reductionPercent), "#d9572b")

  ctx.fillStyle = "#5d5548"
  ctx.font = "400 24px IBM Plex Sans, sans-serif"
  wrapText(ctx, currentResult.claimBoundary, cardX + 44, cardY + 548, 520, 34)

  ctx.fillStyle = "#1a1712"
  ctx.font = "700 24px IBM Plex Sans, sans-serif"
  ctx.fillText("github.com/labmimors/dsh-mcp-lens", 80, 812)

  ctx.fillStyle = "#5d5548"
  ctx.font = "400 21px IBM Plex Sans, sans-serif"
  ctx.fillText("Source: benchmark/run.ts + benchmark/README.md in the linked repository", 80, 852)
}

function metricBlock(ctx, x, y, label, value, accent) {
  ctx.fillStyle = "#5d5548"
  ctx.font = "700 24px IBM Plex Sans, sans-serif"
  ctx.fillText(label, x, y)
  ctx.fillStyle = accent
  ctx.font = "700 54px Iowan Old Style, Palatino Linotype, serif"
  wrapText(ctx, value, x, y + 60, 500, 58)
}

function roundRect(ctx, x, y, width, height, radius, fill, stroke) {
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + width, y, x + width, y + height, radius)
  ctx.arcTo(x + width, y + height, x, y + height, radius)
  ctx.arcTo(x, y + height, x, y, radius)
  ctx.arcTo(x, y, x + width, y, radius)
  ctx.closePath()
  ctx.fillStyle = fill
  ctx.fill()
  ctx.strokeStyle = stroke
  ctx.lineWidth = 2
  ctx.stroke()
}

function drawBlob(ctx, x, y, size, color) {
  ctx.beginPath()
  ctx.fillStyle = color
  ctx.ellipse(x, y, size, size * 0.62, Math.PI / 6, 0, Math.PI * 2)
  ctx.fill()
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = String(text).split(/\s+/)
  let line = ""
  let cursorY = y

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (ctx.measureText(candidate).width <= maxWidth) {
      line = candidate
      continue
    }

    ctx.fillText(line, x, cursorY)
    line = word
    cursorY += lineHeight
  }

  if (line) ctx.fillText(line, x, cursorY)
}

export function utf8Bytes(value) {
  return new TextEncoder().encode(value).length
}

function formatInteger(value) {
  return new Intl.NumberFormat("en-US").format(value)
}

function formatBytes(bytes) {
  return `${formatInteger(bytes)} B`
}

export function reductionPercent(currentBytes, lensBytes) {
  return sharedReductionPercent(currentBytes, lensBytes)
}

function formatPercent(value) {
  return `${value.toFixed(3)}%`
}

function buildReproCommand() {
  return [
    "node -e '",
    "const fs=require(\"node:fs\");",
    "const value=JSON.parse(fs.readFileSync(\"schemas.json\",\"utf8\"));",
    "const tools=Array.isArray(value)?value:(value.tools||value.schemas||value.request?.header?.tools||value.header?.tools);",
    "if(!Array.isArray(tools)) throw new Error(\"expected tool array\");",
    "const json=JSON.stringify(tools);",
    "console.log({ tools: tools.length, utf8Bytes: Buffer.byteLength(json,\"utf8\") });",
    "'",
  ].join("")
}

function downloadCard() {
  const link = document.createElement("a")
  link.href = elements.canvas.toDataURL("image/png")
  link.download = "mcp-lens-local-calculation.png"
  link.click()
  setStatus("Downloaded the shareable card.")
}

function clearShareHash() {
  if (typeof window === "undefined" || !window.location.hash) return
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`)
}
