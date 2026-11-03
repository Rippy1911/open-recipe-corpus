// Stateless MCP over Streamable HTTP: every POST is answered with plain JSON, nothing is kept between requests.
// The tools are the REST operations (api.js), validated by the same schema.
import R from './generated.js';
import { ApiError, errorBody, inputSchema, TOOLS, validate } from './api.js';

const VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const INSTRUCTIONS = 'Recipes from Wikibooks and Wikisource cookbooks, structured and checked, in '
  + `${Object.keys(R.languages).join(', ')}. Search with search_recipes, then get_recipe for amounts and steps. `
  + 'Every recipe is CC BY-SA 4.0 and carries an attribution object: keep its credit, links and licence when you show or reuse the recipe, '
  + 'and say when a recipe is machine-translated or a photo is AI-generated.';

const TOOL_LIST = Object.entries(TOOLS).map(([name, t]) => ({
  name,
  title: t.title,
  description: t.description,
  inputSchema: inputSchema(name),
  annotations: { title: t.title, readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}));

const ok = (id, result) => ({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

/** `call(name, args)` runs a validated tool and returns its result object; it throws ApiError on a caller error. */
export async function mcp(request, call, json) {
  if (request.method !== 'POST') {
    return new Response(null, { status: 405, headers: { Allow: 'POST, OPTIONS' } });
  }
  let m;
  try { m = await request.json(); } catch { return json(fail(null, -32700, 'Parse error'), 400); }
  // One message per request, so one request is one rate-limit count. JSON-RPC batches left MCP in 2025-06-18.
  if (Array.isArray(m)) return json(fail(null, -32600, 'Batches are not supported: send one message per request.'), 400);
  if (!m || typeof m !== 'object') return json(fail(null, -32600, 'Invalid Request'), 400);
  // Notifications and the client's own responses get no answer.
  if (m.id === undefined || m.id === null) {
    return typeof m.method === 'string' || 'result' in m || 'error' in m ? new Response(null, { status: 202 }) : json(fail(null, -32600, 'Invalid Request'), 400);
  }
  if (m.jsonrpc !== '2.0' || typeof m.method !== 'string') return json(fail(m.id, -32600, 'Invalid Request'), 400);
  let reply;
  try {
    reply = await handle(m, call);
  } catch (e) {
    console.error('mcp internal error', e?.name, e?.message);
    reply = fail(m.id, -32603, 'Internal error. Try again.');
  }
  const res = json(reply, 200);
  // A session id lets the rate limit count per conversation rather than per egress IP; nothing is stored under it.
  if (m.method === 'initialize') res.headers.set('Mcp-Session-Id', crypto.randomUUID());
  return res;
}

async function handle(m, call) {
  switch (m.method) {
    case 'initialize': {
      const asked = m.params?.protocolVersion;
      return ok(m.id, {
        protocolVersion: VERSIONS.includes(asked) ? asked : VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: R.name, title: 'Open recipe corpus', version: R.release },
        instructions: INSTRUCTIONS,
      });
    }
    case 'ping':
      return ok(m.id, {});
    case 'tools/list':
      return ok(m.id, { tools: TOOL_LIST });
    case 'tools/call': {
      const name = m.params?.name;
      if (typeof name !== 'string' || !Object.hasOwn(TOOLS, name)) return fail(m.id, -32602, `Unknown tool "${name}". Tools: ${Object.keys(TOOLS).join(', ')}.`);
      try {
        const result = await call(name, validate(name, m.params.arguments ?? {}));
        return ok(m.id, { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result });
      } catch (e) {
        // A bad argument or a missing recipe is a tool result the model can act on, not a protocol error.
        if (e instanceof ApiError && e.status < 500) {
          return ok(m.id, { content: [{ type: 'text', text: JSON.stringify(errorBody(e)) }], isError: true });
        }
        throw e;
      }
    }
    default:
      return fail(m.id, -32601, `Method not found: ${m.method}`);
  }
}
