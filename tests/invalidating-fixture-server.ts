import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

let listCalls = 0
const server = new Server(
  { name: 'mcp-lens-invalidating-fixture', version: '1.0.0' },
  { capabilities: { tools: { listChanged: true } } },
)

server.setRequestHandler(ListToolsRequestSchema, async () => {
  listCalls += 1
  if (listCalls === 1) {
    await server.sendToolListChanged()
    return {
      tools: [{
        name: 'stale_capability',
        description: 'This generation must never be published.',
        inputSchema: { type: 'object', properties: {} },
      }],
    }
  }
  return {
    tools: [
      {
        name: 'fresh_capability',
        description: 'The catalog generation after list_changed.',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'list_count',
        description: 'Return the number of tools/list requests observed by the fixture.',
        inputSchema: { type: 'object', properties: {} },
      },
    ],
  }
})

server.setRequestHandler(CallToolRequestSchema, async request => ({
  content: [{
    type: 'text',
    text: request.params.name === 'list_count' ? String(listCalls) : request.params.name,
  }],
}))

await server.connect(new StdioServerTransport())
