import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const requested = Number.parseInt(process.argv[2] ?? '12', 10)
const toolCount = Number.isInteger(requested) && requested >= 12 ? requested : 12

const server = new McpServer(
  { name: 'mcp-lens-fixture', version: '1.0.0' },
  { capabilities: { tools: { listChanged: true } } },
)

server.registerTool('github_create_issue', {
  title: 'Create GitHub issue',
  description: 'Create a new issue in a GitHub repository with title, body, and labels.',
  inputSchema: {
    repository: z.string().describe('Repository in owner/name form'),
    title: z.string().describe('Issue title'),
    body: z.string().optional().describe('Markdown issue body'),
    labels: z.array(z.string()).optional().describe('Labels to attach'),
  },
  annotations: { readOnlyHint: false, destructiveHint: false },
}, async args => ({ content: [{ type: 'text', text: `created:${args.repository}:${args.title}` }] }))

server.registerTool('github_list_pull_requests', {
  title: 'List pull requests',
  description: 'Find open pull requests in a GitHub repository, optionally filtered by author.',
  inputSchema: {
    repository: z.string().describe('Repository in owner/name form'),
    author: z.string().optional().describe('GitHub login'),
    state: z.enum(['open', 'closed', 'all']).optional().describe('Pull request state'),
  },
  annotations: { readOnlyHint: true, destructiveHint: false },
}, async args => ({ content: [{ type: 'text', text: `pull-requests:${args.repository}` }] }))

server.registerTool('slack_search_messages', {
  title: 'Search Slack messages',
  description: 'Search workspace conversations and channel messages using keywords.',
  inputSchema: {
    query: z.string().describe('Search keywords'),
    channel: z.string().optional().describe('Channel identifier'),
  },
  annotations: { readOnlyHint: true, destructiveHint: false },
}, async args => ({ content: [{ type: 'text', text: `messages:${args.query}` }] }))

server.registerTool('calendar_create_event', {
  title: 'Create calendar event',
  description: 'Schedule a meeting or calendar event with attendees and a start time.',
  inputSchema: {
    summary: z.string().describe('Event summary'),
    startsAt: z.string().describe('ISO 8601 start time'),
    attendees: z.array(z.string().email()).optional().describe('Attendee email addresses'),
  },
  annotations: { readOnlyHint: false, destructiveHint: false },
}, async args => ({ content: [{ type: 'text', text: `scheduled:${args.summary}` }] }))

server.registerTool('filesystem_read_file', {
  title: 'Read file',
  description: 'Read UTF-8 text from a local file path without modifying it.',
  inputSchema: { path: z.string().describe('Absolute file path') },
  annotations: { readOnlyHint: true, destructiveHint: false },
}, async args => ({ content: [{ type: 'text', text: `contents:${args.path}` }] }))

server.registerTool('database_run_query', {
  title: 'Run database query',
  description: 'Execute a read-only SQL query against an analytics database.',
  inputSchema: {
    sql: z.string().describe('Read-only SQL statement'),
    limit: z.number().int().positive().optional().describe('Maximum rows'),
  },
  annotations: { readOnlyHint: true, destructiveHint: false },
}, async args => ({ content: [{ type: 'text', text: `rows:${String(args.limit ?? 100)}` }] }))

server.registerTool('deploy_service', {
  title: 'Deploy service',
  description: 'Deploy an application service to a named production or staging environment.',
  inputSchema: {
    service: z.string().describe('Service name'),
    environment: z.enum(['staging', 'production']).describe('Target environment'),
    revision: z.string().describe('Immutable revision'),
  },
  annotations: { readOnlyHint: false, destructiveHint: true },
}, async args => ({ content: [{ type: 'text', text: `deployed:${args.service}:${args.environment}` }] }))

server.registerTool('echo_structured', {
  title: 'Structured echo',
  description: 'Echo a message and return matching structured content.',
  inputSchema: { message: z.string().describe('Message to echo') },
  outputSchema: { echoed: z.string() },
  annotations: { readOnlyHint: true, destructiveHint: false },
}, async args => ({
  content: [
    { type: 'text', text: args.message },
    {
      type: 'resource',
      resource: {
        uri: 'fixture://private-resource',
        mimeType: 'text/plain',
        text: 'RESOURCE_PAYLOAD_MUST_NOT_BE_RENDERED',
      },
    },
    {
      type: 'resource_link',
      name: 'private fixture link',
      uri: 'https://fixture.invalid/download?signature=SIGNED_URL_MUST_NOT_BE_RENDERED',
    },
  ],
  structuredContent: { echoed: args.message },
  _meta: { privateTrace: 'TOP_LEVEL_META_MUST_NOT_LEAVE_CLIENT_LAYER' },
}))

server.registerTool('always_fail', {
  title: 'Always fail',
  description: 'Return a controlled MCP tool error for integration tests.',
  inputSchema: {},
  annotations: { readOnlyHint: true, destructiveHint: false },
}, async () => ({ content: [{ type: 'text', text: 'controlled fixture failure' }], isError: true }))

server.registerTool('search_support_tickets', {
  title: '搜尋中文工單',
  description: '依照關鍵字搜尋支援工單與客戶問題。',
  inputSchema: { 關鍵字: z.string().describe('要搜尋的文字') },
  annotations: { readOnlyHint: true, destructiveHint: false },
}, async args => ({ content: [{ type: 'text', text: `工單:${args.關鍵字}` }] }))

server.registerTool('lookup_customer_by_email', {
  title: 'Customer lookup',
  description: 'Find a CRM customer record using an email address.',
  inputSchema: { emailAddress: z.string().email().describe('Customer email address') },
  annotations: { readOnlyHint: true, destructiveHint: false },
}, async args => ({ content: [{ type: 'text', text: `customer:${args.emailAddress}` }] }))

server.registerTool('remove_cloud_resource', {
  title: 'Delete cloud resource',
  description: 'Permanently delete a cloud resource by identifier.',
  inputSchema: {
    resourceId: z.string().describe('Cloud resource identifier'),
    reason: z.string().describe('Audit reason'),
  },
  annotations: { readOnlyHint: false, destructiveHint: true },
}, async args => ({ content: [{ type: 'text', text: `removed:${args.resourceId}` }] }))

for (let index = 12; index < toolCount; index += 1) {
  server.registerTool(`synthetic_operation_${String(index).padStart(4, '0')}`, {
    title: `Synthetic operation ${index}`,
    description: `Controlled benchmark capability number ${index} for measuring schema surface growth.`,
    inputSchema: {
      resource: z.string().describe('Resource identifier'),
      query: z.string().describe('Search or operation query'),
      region: z.string().optional().describe('Deployment region'),
      limit: z.number().int().positive().optional().describe('Maximum result count'),
      dryRun: z.boolean().optional().describe('Preview without mutation'),
    },
    annotations: { readOnlyHint: index % 3 !== 0, destructiveHint: index % 3 === 0 },
  }, async args => ({ content: [{ type: 'text', text: `synthetic:${index}:${args.resource}` }] }))
}

await server.connect(new StdioServerTransport())
