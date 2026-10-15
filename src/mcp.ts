import { z } from 'zod';

const argumentsSchema = z.record(z.string(), z.json());
const protocolVersion = '2025-06-18';
const maximumBytes = 1024 * 1024;
const endpointSchema = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash;
  }, 'Use an HTTPS endpoint without credentials or a fragment.');
export const mcpServiceSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  name: z.string().trim().min(1).max(100),
  url: endpointSchema,
  enabled: z.boolean().default(false),
});
export type McpService = z.infer<typeof mcpServiceSchema>;
type CallContext = { threadId: string; turnId: string; callId: string; signal: AbortSignal };
export type McpApproval = CallContext & {
  serviceId: string;
  serviceName: string;
  url: string;
  toolName: string;
  arguments: z.infer<typeof argumentsSchema>;
  argumentsJson: string;
};
export type McpHostTool = {
  name: string;
  description: string;
  inputSchema: unknown;
  execute: (args: unknown, context: CallContext) => Promise<unknown>;
};
export type McpRequest = {
  url: string;
  headers: Record<string, string>;
  body: string;
  signal?: AbortSignal;
};
export type McpResponse = { status: number; headers: Record<string, string>; text: string };
const rpcSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number(), z.null()]),
  result: z.unknown().optional(),
  error: z.object({ code: z.number(), message: z.string() }).optional(),
});
const toolSchema = z.object({
  name: z.string().regex(/^[a-zA-Z0-9_.-]{1,128}$/),
  description: z.string().max(16_384).optional(),
  inputSchema: z.object({ type: z.literal('object') }).passthrough(),
});
const listSchema = z.object({
  tools: z.array(toolSchema).max(100),
  nextCursor: z.string().max(4096).optional(),
});
const initializedSchema = z.object({
  protocolVersion: z.enum(['2025-06-18', '2025-03-26']),
  capabilities: z.object({ tools: z.object({}).optional() }),
});

function checkSignal(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('MCP request cancelled.');
}
function header(headers: Record<string, string>, name: string): string | undefined {
  return Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
}
function messages(text: string, eventStream: boolean): unknown[] {
  if (!eventStream) return [JSON.parse(text)];
  const result: unknown[] = [];
  for (const event of text.replace(/\r\n/g, '\n').split('\n\n').slice(0, -1)) {
    const data = event
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (data) result.push(JSON.parse(data));
  }
  return result;
}
function responseMessage(
  text: string,
  eventStream: boolean,
  id: number,
): z.infer<typeof rpcSchema> | undefined {
  for (const message of messages(text, eventStream)) {
    const parsed = rpcSchema.safeParse(message);
    if (parsed.success && parsed.data.id === id) return parsed.data;
  }
}

/** Sends directly to the approved endpoint. Node HTTPS never follows redirects or inherits browser cookies. */
export function requestMcp(request: McpRequest): Promise<McpResponse> {
  checkSignal(request.signal);
  endpointSchema.parse(request.url);
  const https = require('node:https') as typeof import('node:https');
  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = (error?: Error, response?: McpResponse) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      request.signal?.removeEventListener('abort', abort);
      if (error) reject(error);
      else if (response) resolve(response);
    };
    const outgoing = https.request(
      request.url,
      {
        method: 'POST',
        headers: request.headers,
        // Use a dedicated agent without credentials or proxy configuration.
        agent: false,
        rejectUnauthorized: true,
      },
      (incoming) => {
        const headers: Record<string, string> = {};
        for (const [name, value] of Object.entries(incoming.headers))
          if (typeof value === 'string') headers[name] = value;
        const status = incoming.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          finish(new Error('MCP redirects are blocked. Configure the final HTTPS endpoint.'));
          incoming.destroy();
          return;
        }
        const chunks: Buffer[] = [];
        let length = 0;
        const eventStream =
          header(headers, 'content-type')?.split(';')[0]?.trim() === 'text/event-stream';
        const rpcRequest = z.object({ id: z.number().optional() }).parse(JSON.parse(request.body));
        incoming.on('data', (chunk: Buffer) => {
          length += chunk.length;
          if (length > maximumBytes) {
            finish(new Error('MCP response exceeded 1 MiB.'));
            incoming.destroy();
            return;
          }
          chunks.push(chunk);
          if (eventStream && rpcRequest.id !== undefined) {
            const text = Buffer.concat(chunks).toString('utf8');
            try {
              if (responseMessage(text, true, rpcRequest.id)) {
                finish(undefined, { status, headers, text });
                incoming.destroy();
              }
            } catch {
              finish(new Error('MCP server returned invalid event data.'));
              incoming.destroy();
            }
          }
        });
        incoming.on('end', () =>
          finish(undefined, { status, headers, text: Buffer.concat(chunks).toString('utf8') }),
        );
        incoming.on('error', (error) => finish(error));
        incoming.on('aborted', () => finish(new Error('MCP response was interrupted.')));
      },
    );
    const abort = () => outgoing.destroy(new Error('MCP request cancelled.'));
    outgoing.on('error', (error) => finish(error));
    const timer = setTimeout(() => outgoing.destroy(new Error('MCP request timed out.')), 30_000);
    request.signal?.addEventListener('abort', abort, { once: true });
    if (request.signal?.aborted) abort();
    else outgoing.end(request.body);
  });
}

type Session = { id?: string; version: string; tools: z.infer<typeof toolSchema>[] };
export class McpServices {
  private sequence = 0;
  private sessions = new Map<string, Session>();
  private request: (request: McpRequest) => Promise<McpResponse>;
  constructor(
    private options: {
      services: () => McpService[];
      approve: (request: McpApproval) => Promise<boolean>;
      request?: (request: McpRequest) => Promise<McpResponse>;
    },
  ) {
    this.request = options.request ?? requestMcp;
  }
  private approve(request: McpApproval): Promise<boolean> {
    checkSignal(request.signal);
    return new Promise((resolve, reject) => {
      const abort = () => {
        request.signal.removeEventListener('abort', abort);
        reject(new Error('MCP request cancelled.'));
      };
      request.signal.addEventListener('abort', abort, { once: true });
      void Promise.resolve()
        .then(() => {
          checkSignal(request.signal);
          return this.options.approve(request);
        })
        .then(
          (approved) => {
            request.signal.removeEventListener('abort', abort);
            resolve(approved);
          },
          (error: unknown) => {
            request.signal.removeEventListener('abort', abort);
            reject(error);
          },
        );
    });
  }
  private key(service: McpService): string {
    return JSON.stringify(service);
  }
  private check(service: McpService, signal?: AbortSignal): void {
    checkSignal(signal);
    if (
      !this.options
        .services()
        .some(
          (current) =>
            current.enabled && this.key(mcpServiceSchema.parse(current)) === this.key(service),
        )
    )
      throw new Error(
        'MCP service was disabled or changed. Start a new conversation to refresh tools.',
      );
  }
  private async post(
    service: McpService,
    session: Session,
    method: string,
    params: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> {
    this.check(service, signal);
    const id = ++this.sequence;
    const notification = method === 'notifications/initialized';
    const response = await this.request({
      url: service.url,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...(method !== 'initialize' ? { 'MCP-Protocol-Version': session.version } : {}),
        ...(session.id ? { 'Mcp-Session-Id': session.id } : {}),
      },
      body: JSON.stringify({ jsonrpc: '2.0', ...(notification ? {} : { id }), method, params }),
      ...(signal ? { signal } : {}),
    });
    this.check(service, signal);
    if (response.status === 404) this.sessions.delete(this.key(service));
    if (response.status < 200 || response.status >= 300)
      throw new Error(`MCP server returned HTTP ${response.status}.`);
    if (Buffer.byteLength(response.text) > maximumBytes)
      throw new Error('MCP response exceeded 1 MiB.');
    if (notification) {
      if (response.status !== 202) throw new Error('MCP server did not accept initialization.');
      return;
    }
    const type = header(response.headers, 'content-type')?.split(';')[0]?.trim();
    if (type !== 'application/json' && type !== 'text/event-stream')
      throw new Error('MCP server returned an unsupported content type.');
    const message = responseMessage(response.text, type === 'text/event-stream', id);
    if (!message) throw new Error('MCP server did not return the matching JSON-RPC response.');
    if (message.error)
      throw new Error(
        `MCP server error ${message.error.code}: ${message.error.message.slice(0, 1000)}`,
      );
    if (!('result' in message)) throw new Error('MCP response has no result.');
    if (method === 'initialize') {
      const sessionId = header(response.headers, 'mcp-session-id');
      if (sessionId && !/^[\x21-\x7e]{1,1024}$/.test(sessionId))
        throw new Error('Invalid MCP session identifier.');
      session.id = sessionId;
    }
    return message.result;
  }
  private async discover(service: McpService, signal?: AbortSignal): Promise<Session> {
    this.check(service, signal);
    const cached = this.sessions.get(this.key(service));
    if (cached) return cached;
    const session: Session = { version: protocolVersion, tools: [] };
    const initialized = initializedSchema.parse(
      await this.post(
        service,
        session,
        'initialize',
        {
          protocolVersion,
          capabilities: {},
          clientInfo: { name: 'Annotate', version: '1' },
        },
        signal,
      ),
    );
    session.version = initialized.protocolVersion;
    await this.post(service, session, 'notifications/initialized', {}, signal);
    if (initialized.capabilities.tools) {
      let cursor: string | undefined;
      const cursors = new Set<string>();
      do {
        const list = listSchema.parse(
          await this.post(service, session, 'tools/list', cursor ? { cursor } : {}, signal),
        );
        session.tools.push(...list.tools);
        if (session.tools.length > 100) throw new Error('MCP service exposes more than 100 tools.');
        cursor = list.nextCursor;
        if (cursor) {
          if (cursors.has(cursor) || cursors.size >= 10)
            throw new Error('MCP tool pagination did not finish.');
          cursors.add(cursor);
        }
      } while (cursor);
      if (new Set(session.tools.map((tool) => tool.name)).size !== session.tools.length)
        throw new Error('MCP service returned duplicate tool names.');
    }
    this.check(service, signal);
    this.sessions.set(this.key(service), session);
    return session;
  }
  async tools(signal?: AbortSignal): Promise<McpHostTool[]> {
    const result: McpHostTool[] = [];
    const services = this.options
      .services()
      .filter((service) => service.enabled)
      .map((service) => mcpServiceSchema.parse(service));
    if (new Set(services.map((service) => service.id)).size !== services.length)
      throw new Error('MCP services must have unique identifiers.');
    for (const service of services) {
      const session = await this.discover(service, signal);
      for (const tool of session.tools) {
        const { createHash } = require('node:crypto') as typeof import('node:crypto');
        const suffix = createHash('sha256')
          .update(service.id + '\0' + tool.name)
          .digest('hex')
          .slice(0, 16);
        result.push({
          name: `mcp_${service.id.slice(0, 12)}_${tool.name.slice(0, 20).replace(/[^a-zA-Z0-9_-]/g, '_')}_${suffix}`,
          description: `${service.name}: ${tool.name}. Each call requires approval before sending its arguments to ${service.url}. ${tool.description ?? ''}`,
          inputSchema: tool.inputSchema,
          execute: async (args, context) => {
            this.check(service, context.signal);
            const parsed = argumentsSchema.parse(args);
            const argumentsJson = JSON.stringify(parsed);
            if (Buffer.byteLength(argumentsJson) > 65_536)
              throw new Error('MCP arguments exceed 64 KiB.');
            const approved = await this.approve({
              ...context,
              serviceId: service.id,
              serviceName: service.name,
              url: service.url,
              toolName: tool.name,
              arguments: JSON.parse(argumentsJson),
              argumentsJson,
            });
            this.check(service, context.signal);
            if (!approved) throw new Error('MCP tool call was denied. No arguments were sent.');
            try {
              const response = await this.post(
                service,
                session,
                'tools/call',
                { name: tool.name, arguments: JSON.parse(argumentsJson) },
                context.signal,
              );
              return z
                .object({ content: z.array(z.unknown()), isError: z.boolean().optional() })
                .passthrough()
                .parse(response);
            } catch (error) {
              throw new Error(
                `MCP tool outcome is unknown after dispatch. It was not retried. ${error instanceof Error ? error.message : 'Request failed.'}`,
                { cause: error },
              );
            }
          },
        });
      }
    }
    checkSignal(signal);
    return result;
  }
}
