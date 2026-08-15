import { access, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const siteRoot = join(repositoryRoot, 'site')
const appPath = join(siteRoot, 'app.js')
const sharePath = join(siteRoot, 'share-metrics.js')

interface SiteModule {
  BENCHMARK_SOURCE_FILES: readonly string[]
  LENS_SURFACE: Readonly<{ tools: number, bytes: number }>
  SAMPLE_TOOLS: readonly unknown[]
  measurePayload(value: unknown): {
    toolCount: number
    bytes: number
    reductionPercent: number
  }
  reductionPercent(currentBytes: number, lensBytes: number): number
  utf8Bytes(value: string): number
}

interface ShareModule {
  MAX_SHARE_HASH_LENGTH: number
  MAX_SHARE_SCHEMA_BYTES: number
  MAX_SHARE_TOOL_COUNT: number
  buildShareHash(value: { toolCount: number, bytes: number, [key: string]: unknown }): string
  buildShareMarkdown(value: { toolCount: number, bytes: number, [key: string]: unknown }): string
  buildShareUrl(value: { toolCount: number, bytes: number, [key: string]: unknown }): string
  parseShareHash(hash: string): Readonly<{ toolCount: number, bytes: number }> | null
}

async function loadSiteModule(): Promise<SiteModule> {
  return await import(pathToFileURL(appPath).href) as SiteModule
}

async function loadShareModule(): Promise<ShareModule> {
  return await import(pathToFileURL(sharePath).href) as ShareModule
}

function localMarkdownTargets(markdown: string): string[] {
  return [...markdown.matchAll(/!?(?:\[[^\]]*\])\(([^)]+)\)/g)]
    .map(match => match[1])
    .filter((target): target is string => Boolean(target))
    .filter(target => !/^(?:https?:|mailto:|#)/.test(target))
    .map(target => decodeURIComponent(target.split('#', 1)[0] ?? ''))
}

const frozenPilotDate = '2026-08-14'
const repositoryImageUrl = 'https://repository-images.githubusercontent.com/1334222997/ee14cb30-45a1-42fb-bb6b-e606ec8b3078'
const lensReleaseCandidate = '0.1.0-rc.8'
const schemaActionRelease = '0.1.0-rc.7'
const harnessPilotVersion = '0.1.0-rc.6'
const immutableCandidateRevision = 'f21169f921e7ed032a4db5062685afb6f948c2d1'

describe('catalog calculator publishing contract', () => {
  it('ships every referenced static asset and required DOM target', async () => {
    const assets = ['index.html', 'app.js', 'share-metrics.js', 'styles.css', 'favicon.svg']
    await Promise.all(assets.map(asset => access(join(siteRoot, asset))))

    const html = await readFile(join(siteRoot, 'index.html'), 'utf8')
    const requiredIds = [
      'schema-input',
      'status',
      'tool-count',
      'schema-bytes',
      'lens-surface',
      'reduction',
      'current-summary',
      'claim-boundary',
      'analyze-button',
      'sample-button',
      'clear-button',
      'copy-share-link-button',
      'copy-markdown-button',
      'copy-command-button',
      'download-card-button',
      'share-card',
    ]

    for (const id of requiredIds) {
      expect(html).toMatch(new RegExp(`id=["']${id}["']`))
    }

    expect(html).toMatch(/<script\s+type=["']module["']\s+src=["']\.\/app\.js["']><\/script>/)
    expect(html).toContain('only bounded numeric fields')
    expect(html).not.toContain('includes the exact inputs')
    expect(html).toMatch(/<textarea[^>]+id=["']schema-input["'][^>]*><\/textarea>/s)
  })

  it('publishes stable homepage metadata for search and social crawlers', async () => {
    const html = await readFile(join(siteRoot, 'index.html'), 'utf8')

    expect(html).toContain('rel="canonical" href="https://labmimors.github.io/dsh-mcp-lens/"')
    expect(html).toContain('rel="alternate" hreflang="en" href="https://labmimors.github.io/dsh-mcp-lens/"')
    expect(html).toContain('rel="alternate" hreflang="x-default" href="https://labmimors.github.io/dsh-mcp-lens/"')
    expect(html).toContain('<meta property="og:type" content="website" />')
    expect(html).toContain('<meta property="og:site_name" content="MCP Lens" />')
    expect(html).toContain('<meta property="og:locale" content="en_US" />')
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />')
    expect(html).toContain('<meta name="twitter:title" content="MCP Lens Catalog Calculator" />')
    expect(html).toContain(`<meta property="og:image" content="${repositoryImageUrl}" />`)
    expect(html).toContain(`<meta name="twitter:image" content="${repositoryImageUrl}" />`)
    expect(html).toContain('"@type": "WebApplication"')
    expect(html).toContain('"applicationCategory": "DeveloperApplication"')
    expect(html).toContain('"url": "https://labmimors.github.io/dsh-mcp-lens/"')
    expect(html).not.toContain('localhost')
  })

  it('keeps calculator execution local and avoids HTML injection sinks', async () => {
    const sources = await Promise.all([
      readFile(appPath, 'utf8'),
      readFile(sharePath, 'utf8'),
    ])
    const forbiddenBehaviors = [
      /\bfetch\s*\(/,
      /\bXMLHttpRequest\b/,
      /\bWebSocket\b/,
      /\bEventSource\b/,
      /\bsendBeacon\s*\(/,
      /\bFormData\b/,
      /\.innerHTML\s*=/,
      /\.outerHTML\s*=/,
    ]

    for (const source of sources) {
      for (const behavior of forbiddenBehaviors) {
        expect(source).not.toMatch(behavior)
      }
    }
  })

  it('measures the fixed 1,000-tool sample with exact UTF-8 byte math', async () => {
    const site = await loadSiteModule()
    const measurement = site.measurePayload(site.SAMPLE_TOOLS)

    expect(measurement.toolCount).toBe(1_000)
    expect(measurement.bytes).toBe(294_894)
    expect(site.utf8Bytes(JSON.stringify(site.SAMPLE_TOOLS))).toBe(294_894)
    expect(measurement.reductionPercent).toBeCloseTo(99.62223714283776, 12)
    expect(site.reductionPercent(2_000, 1_000)).toBe(50)
    expect(site.reductionPercent(1_000, 1_114)).toBe(0)
  })

  it('round-trips only validated aggregate metrics through a schema-free share hash', async () => {
    const site = await loadSiteModule()
    const share = await loadShareModule()
    const privatePayload = [{
      name: 'PRIVATE_TOOL_NAME_DO_NOT_SHARE',
      description: 'PRIVATE_DESCRIPTION_DO_NOT_SHARE',
      inputSchema: { type: 'object', properties: { privateField: { type: 'string' } } },
    }]
    const measurement = site.measurePayload(privatePayload)
    const enrichedMeasurement = { ...measurement, raw: JSON.stringify(privatePayload) }

    const hash = share.buildShareHash(enrichedMeasurement)
    const url = share.buildShareUrl(enrichedMeasurement)
    const markdown = share.buildShareMarkdown(enrichedMeasurement)

    expect(share.parseShareHash(hash)).toEqual({
      toolCount: measurement.toolCount,
      bytes: measurement.bytes,
    })
    expect(hash).toMatch(/^#v=1&tools=\d+&bytes=\d+&check=\d+$/)
    expect(url).toBe(`https://labmimors.github.io/dsh-mcp-lens/${hash}`)
    expect(markdown).toContain('Self-reported local measurement:')
    expect(markdown).toContain(url)
    for (const output of [hash, url, markdown]) {
      expect(output).not.toContain('PRIVATE_TOOL_NAME_DO_NOT_SHARE')
      expect(output).not.toContain('PRIVATE_DESCRIPTION_DO_NOT_SHARE')
      expect(output).not.toContain('privateField')
      expect(output).not.toContain('raw=')
    }
  })

  it('rejects checksum mismatches, malformed, oversized, and non-canonical share data', async () => {
    const share = await loadShareModule()
    const valid = { toolCount: 12, bytes: 4_862 }
    const hash = share.buildShareHash(valid)

    expect(share.parseShareHash(hash.replace('bytes=4862', 'bytes=4863'))).toBeNull()
    expect(share.parseShareHash(hash.replace('v=1', 'v=2'))).toBeNull()
    expect(share.parseShareHash(`${hash}&unknown=1`)).toBeNull()
    expect(share.parseShareHash(`${hash}&raw=PRIVATE_SCHEMA`)).toBeNull()
    expect(share.parseShareHash('#v=1&tools=NaN&bytes=4862&check=0')).toBeNull()
    expect(share.parseShareHash('#v=1&tools=-1&bytes=4862&check=0')).toBeNull()
    expect(share.parseShareHash('#v=01&tools=12&bytes=4862&check=0')).toBeNull()
    expect(share.parseShareHash(`#${'1'.repeat(share.MAX_SHARE_HASH_LENGTH)}`)).toBeNull()

    for (const invalid of [
      { toolCount: Number.NaN, bytes: 4_862 },
      { toolCount: -1, bytes: 4_862 },
      { toolCount: share.MAX_SHARE_TOOL_COUNT + 1, bytes: 4_862 },
      { toolCount: 12, bytes: Number.NaN },
      { toolCount: 12, bytes: -1 },
      { toolCount: 12, bytes: share.MAX_SHARE_SCHEMA_BYTES + 1 },
      { toolCount: 12, bytes: 12 },
    ]) {
      expect(() => share.buildShareHash(invalid)).toThrow()
    }
  })

  it('hydrates a valid self-reported hash without repopulating the schema textarea', async () => {
    const [appSource, html] = await Promise.all([
      readFile(appPath, 'utf8'),
      readFile(join(siteRoot, 'index.html'), 'utf8'),
    ])

    expect(appSource).toContain('parseShareHash(window.location.hash)')
    expect(appSource).toContain('elements.input.value = ""')
    expect(appSource).toContain('Loaded a self-reported local measurement from the URL')
    expect(appSource).not.toMatch(/elements\.input\.value\s*=\s*sharedMeasurement/)
    expect(html).toContain('reconstruct the self-reported result with an empty textarea')
  })

  it('keeps every local README link and card benchmark source resolvable', async () => {
    const site = await loadSiteModule()
    expect(site.BENCHMARK_SOURCE_FILES).toEqual([
      'benchmark/run.ts',
      'benchmark/README.md',
    ])

    const readmePaths = ['README.md', 'README.zh-CN.md']
    for (const readmePath of readmePaths) {
      const markdown = await readFile(join(repositoryRoot, readmePath), 'utf8')
      for (const target of localMarkdownTargets(markdown)) {
        await expect(access(join(repositoryRoot, target))).resolves.toBeUndefined()
      }
    }

    for (const sourceFile of site.BENCHMARK_SOURCE_FILES) {
      await expect(access(join(repositoryRoot, sourceFile))).resolves.toBeUndefined()
    }

    const appSource = await readFile(appPath, 'utf8')
    expect(appSource).toContain('Source: benchmark/run.ts + benchmark/README.md')
    expect(appSource).not.toContain('benchmark.json and benchmark/README.md')
  })

  it('publishes bilingual, crawlable study pages with the frozen pilot boundary', async () => {
    const englishPath = join(siteRoot, '1000-tool-tax', 'index.html')
    const chinesePath = join(siteRoot, 'zh-CN', '1000-tool-tax', 'index.html')
    const [english, chinese, home, robots, sitemap, styles] = await Promise.all([
      readFile(englishPath, 'utf8'),
      readFile(chinesePath, 'utf8'),
      readFile(join(siteRoot, 'index.html'), 'utf8'),
      readFile(join(siteRoot, 'robots.txt'), 'utf8'),
      readFile(join(siteRoot, 'sitemap.xml'), 'utf8'),
      readFile(join(siteRoot, 'styles.css'), 'utf8'),
    ])

    expect(home).toContain('href="./1000-tool-tax/"')
    expect(english).toContain('rel="canonical" href="https://labmimors.github.io/dsh-mcp-lens/1000-tool-tax/"')
    expect(chinese).toContain('rel="canonical" href="https://labmimors.github.io/dsh-mcp-lens/zh-CN/1000-tool-tax/"')
    expect(english).toContain('href="../styles.css"')
    expect(chinese).toContain('href="../../styles.css"')
    for (const html of [english, chinese]) {
      expect(html).toContain('hreflang="en"')
      expect(html).toContain('hreflang="zh-CN"')
      expect(html).toContain('<meta property="og:site_name" content="MCP Lens" />')
      expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />')
      expect(html).toContain(`<meta property="og:image" content="${repositoryImageUrl}" />`)
      expect(html).toContain(`<meta name="twitter:image" content="${repositoryImageUrl}" />`)
      expect(html).toContain(`"datePublished": "${frozenPilotDate}"`)
      expect(html).toContain(`"dateModified": "${frozenPilotDate}"`)
      expect(html).toContain('674,249 B')
      expect(html).toContain('27,401 B')
      expect(html).toContain('$0.0307204')
      expect(html).toContain('$0.0034707')
      expect(html).toContain('61.711%')
      expect(html).toContain('491')
      expect(html).toContain('794')
      expect(html).not.toContain('2026-08-15')
      expect(html).not.toMatch(/<script(?!\s+type="application\/ld\+json")/)
      expect(html).toContain(`DeepSeek Harness ${harnessPilotVersion}`)
      expect(html).toContain(`/releases/download/v${lensReleaseCandidate}/dsh-mcp-lens-${lensReleaseCandidate}.tgz`)
      expect(html).not.toContain('/releases/download/v0.1.0-rc.6/dsh-mcp-lens-0.1.0-rc.6.tgz')
    }

    expect(english).toContain('pricing retrieved on August 14, 2026')
    expect(english).toContain('Published August 14, 2026')
    expect(english).toContain('<meta property="og:locale" content="en_US" />')
    expect(english).toContain('<meta property="og:locale:alternate" content="zh_CN" />')
    expect(english).toContain('<meta name="twitter:title" content="The 1,000-tool tax: measuring large MCP catalogs" />')
    expect(english).toContain('href="../"')
    expect(english).toContain('href="../zh-CN/1000-tool-tax/"')
    expect(chinese).toContain('2026-08-14 抓取的 DeepSeek 价格')
    expect(chinese).toContain('发布于 2026-08-14')
    expect(chinese).toContain('<meta property="og:locale" content="zh_CN" />')
    expect(chinese).toContain('<meta property="og:locale:alternate" content="en_US" />')
    expect(chinese).toContain('<meta name="twitter:title" content="1000 个工具的固定成本：实测大型 MCP 目录" />')
    expect(chinese).toContain('href="../../"')
    expect(chinese).toContain('href="../../1000-tool-tax/"')
    expect(english).toContain('aggregate usage accounting')
    expect(chinese).toContain('聚合 Usage 计算')
    expect(robots).toContain('Sitemap: https://labmimors.github.io/dsh-mcp-lens/sitemap.xml')
    expect(sitemap).toContain('<loc>https://labmimors.github.io/dsh-mcp-lens/</loc>')
    expect(sitemap).toContain('<loc>https://labmimors.github.io/dsh-mcp-lens/1000-tool-tax/</loc>')
    expect(sitemap).toContain('<loc>https://labmimors.github.io/dsh-mcp-lens/zh-CN/1000-tool-tax/</loc>')

    await Promise.all([
      access(join(siteRoot, 'favicon.svg')),
      access(join(siteRoot, 'styles.css')),
    ])

    expect(styles).toContain('.article-shell')
    expect(styles).toContain('.article-proof')
    expect(styles).toContain('width: min(1040px, calc(100% - 20px));')
  })

  it('identifies the Lens rc.8 candidate without rewriting rc.6 Harness dependencies, pilot history, or the rc.7 Action', async () => {
    const [packageJson, shrinkwrap, englishReadme, chineseReadme, englishPilot, chinesePilot] = await Promise.all([
      readFile(join(repositoryRoot, 'package.json'), 'utf8').then(JSON.parse),
      readFile(join(repositoryRoot, 'npm-shrinkwrap.json'), 'utf8').then(JSON.parse),
      readFile(join(repositoryRoot, 'README.md'), 'utf8'),
      readFile(join(repositoryRoot, 'README.zh-CN.md'), 'utf8'),
      readFile(join(repositoryRoot, 'docs', 'LIVE_DEEPSEEK_PILOT.md'), 'utf8'),
      readFile(join(repositoryRoot, 'docs', 'LIVE_DEEPSEEK_PILOT.zh-CN.md'), 'utf8'),
    ])

    expect(packageJson.version).toBe(lensReleaseCandidate)
    expect(shrinkwrap.version).toBe(lensReleaseCandidate)
    expect(shrinkwrap.packages[''].version).toBe(lensReleaseCandidate)

    for (const dependencyGroup of [packageJson.peerDependencies, packageJson.devDependencies]) {
      for (const [name, range] of Object.entries(dependencyGroup)) {
        if (name.startsWith('@deepseek-ai/dsh-')) expect(range).toBe(`^${harnessPilotVersion}`)
      }
    }

    for (const readme of [englishReadme, chineseReadme]) {
      expect(readme).toContain(`/releases/download/v${lensReleaseCandidate}/dsh-mcp-lens-${lensReleaseCandidate}.tgz`)
      expect(readme).toContain(`labmimors/dsh-mcp-lens@v${schemaActionRelease}`)
      expect(readme).toContain(`github:labmimors/dsh-mcp-lens#v${lensReleaseCandidate}`)
      expect(readme).toContain(`/releases/tag/v${lensReleaseCandidate}`)
      expect(readme).toContain(`labmimors/dsh-mcp-lens@${immutableCandidateRevision}`)
      expect(readme).toContain(`\`${immutableCandidateRevision}\``)
      expect(readme).not.toContain('/releases/download/v0.1.0-rc.6/dsh-mcp-lens-0.1.0-rc.6.tgz')
      expect(readme).not.toContain('labmimors/dsh-mcp-lens@v0.1.0-rc.6')
      expect(readme).not.toContain('github:labmimors/dsh-mcp-lens#v0.1.0-rc.6')
      expect(readme).not.toContain('51cd0ec8d953576507a404cb06034842914b5b5c')
      expect(readme).not.toContain('6a7e006fd63887fecf2ce1e70a54af26e0df1378')
      expect(readme).not.toContain('47285d39bf267d71d196ffaec7ca58a380204566')
    }

    expect(englishPilot).toContain(`DeepSeek Harness: \`${harnessPilotVersion}\``)
    expect(chinesePilot).toContain(`DeepSeek Harness：\`${harnessPilotVersion}\``)
  })

  it('keeps the published tarball free of development-only packaging files', async () => {
    const packageJson = await readFile(join(repositoryRoot, 'package.json'), 'utf8').then(JSON.parse)
    expect(packageJson.files).not.toContain('scripts')
    expect(packageJson.files).not.toContain('tsconfig.json')
    expect(packageJson.files).not.toContain('tsdown.config.ts')
  })

  it('pins every Pages action to the reviewed immutable revision', async () => {
    const workflow = await readFile(join(repositoryRoot, '.github/workflows/pages.yml'), 'utf8')
    expect(workflow).toContain('actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09 # v5')
    expect(workflow).toContain('actions/configure-pages@983d7736d9b0ae728b81ab479565c72886d7745b # v5')
    expect(workflow).toContain('actions/upload-pages-artifact@7b1f4a764d45c48632c6b24a0339c27f5614fb0b # v4')
    expect(workflow).toContain('actions/deploy-pages@d6db90164ac5ed86f2b6aed7e0febac5b3c0c03e # v4')
    expect(workflow).not.toMatch(/uses:\s+actions\/(?:checkout|configure-pages|upload-pages-artifact|deploy-pages)@v\d+/)
  })
})
