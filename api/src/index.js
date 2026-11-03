// Recipe API Worker: REST under /v1, MCP at /mcp, photos at /photos, all read-only over one D1 release set.
// Free tier: no key, a per-IP rate limit (Workers Rate Limiting binding). Keyed tier: a higher limit per key.
// Answers are cached at the edge under the data release and this code's version, so a deploy of either never serves
// answers made by the other.
import R from './generated.js';
import { ApiError, errorBody, inputSchema, run, TOOLS, validate } from './api.js';
import { mcp } from './mcp.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-api-key, mcp-session-id, mcp-protocol-version, last-event-id',
  'Access-Control-Expose-Headers': 'mcp-session-id, retry-after, x-release',
};
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Release': R.release, ...CORS, ...headers },
});

export default {
  async fetch(request, env, ctx) {
    try {
      return await route(request, env, ctx);
    } catch (e) {
      if (e instanceof ApiError) return json(errorBody(e), e.status, e.headers);
      // Logs keep the failure, never the query text or a key.
      console.error('internal error', e?.name, e?.message);
      return json(errorBody(new ApiError(500, 'internal', 'Something went wrong. Try again.')), 500);
    }
  },
};

async function route(request, env, ctx) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...CORS, 'Access-Control-Max-Age': '86400' } });
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const caller = await identify(request);
  await enforce(env, caller, path === '/mcp' ? request.headers.get('mcp-session-id') : null, path.startsWith('/photos/'));
  const db = env.DB.withSession ? env.DB.withSession('first-unconstrained') : env.DB;
  const call = async (name, args) => JSON.parse(await cached(ctx, url.origin, name, args, () => run(db, name, args, url.origin)));

  if (path === '/mcp') {
    const res = await mcp(request, call, json);
    for (const [k, v] of Object.entries(CORS)) res.headers.set(k, v);
    return res;
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') throw new ApiError(405, 'bad_request', 'Only GET (and POST to /mcp).');
  if (path.startsWith('/photos/')) return photo(env, ctx, request, path.slice('/photos/'.length));
  const rest = (name, input) => {
    const args = validate(name, input, { fromQuery: true });
    return cached(ctx, url.origin, name, args, () => run(db, name, args, url.origin))
      .then((body) => new Response(body, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=300', 'X-Release': R.release, ...CORS } }));
  };
  const query = () => {
    const q = Object.create(null);
    for (const [k, v] of url.searchParams) (q[k] ??= []).push(v);
    return q;
  };
  if (path === '/v1/recipes') return rest('search_recipes', query());
  if (path.startsWith('/v1/recipes/')) {
    let id;
    try { id = decodeURIComponent(path.slice('/v1/recipes/'.length)); } catch { throw new ApiError(400, 'bad_request', 'The recipe id is not valid URL encoding.'); }
    return rest('get_recipe', { ...query(), id: [id] });
  }
  if (path === '/v1/facets') return rest('list_facets', query());
  if (path === '/' || path === '/v1') return json(about(url.origin), 200, { 'Cache-Control': 'public, max-age=300' });
  if (path === '/openapi.json') return json(openapi(url.origin), 200, { 'Cache-Control': 'public, max-age=300' });
  if (path === '/llms.txt') return new Response(llms(url.origin), { headers: { 'Content-Type': 'text/plain; charset=utf-8', ...CORS } });
  throw new ApiError(404, 'not_found', `No route ${path}. See ${url.origin}/ for the endpoints.`);
}

/**
 * Who is calling: anonymous, or the holder of a key whose SHA-256 is listed in corpus.config.json (keys). Only the
 * hash is ever stored; keys are long random strings, so a published hash gives nothing away.
 */
async function identify(request) {
  const ip = clientKey(request.headers.get('cf-connecting-ip') ?? 'unknown');
  const raw = request.headers.get('x-api-key') ?? request.headers.get('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!raw) return { tier: 'anonymous', ip };
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  const id = R.keys[[...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')];
  if (!id) throw new ApiError(401, 'invalid_key', 'This API key is not known here. Send no key to use the free tier.');
  return { tier: 'keyed', id, ip };
}

/** What an anonymous limit counts: an IPv4 address, or an IPv6 address by its /64 (one host usually holds all of it). */
function clientKey(ip) {
  if (!ip.includes(':')) return ip;
  const [head, tail = ''] = ip.split('::');
  const h = head ? head.split(':') : [], t = tail ? tail.split(':') : [];
  const full = ip.includes('::') ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t] : h;
  return `${full.slice(0, 4).map((x) => (parseInt(x, 16) || 0).toString(16)).join(':')}::/64`;
}

/**
 * Rate limits, counted per Cloudflare location. Anonymous: per IP, or per MCP session (assistants share egress IPs),
 * with a per-IP ceiling over all sessions. Keyed: per key. Photos: only the per-IP ceiling, since a page of results
 * loads many at once.
 */
async function enforce(env, c, session, isPhoto) {
  const L = R.limits;
  const sid = session && /^[\w-]{8,64}$/.test(session) ? session : null;
  const checks = isPhoto ? [['LIMIT_NETWORK', `ip:${c.ip}`, L.network]]
    : c.tier === 'keyed' ? [['LIMIT_KEYED', `key:${c.id}`, L.keyed]]
      : sid ? [['LIMIT_NETWORK', `ip:${c.ip}`, L.network], ['LIMIT_ANON', `mcp:${sid}`, L.anonymous]]
        : [['LIMIT_ANON', `ip:${c.ip}`, L.anonymous]];
  for (const [binding, key, n] of checks) {
    if (!env[binding]) continue;
    const { success } = await env[binding].limit({ key });
    if (!success) {
      throw new ApiError(429, 'rate_limited', `Rate limit: ${n} requests per ${L.period_seconds} seconds. Retry after ${L.period_seconds} seconds.`,
        { headers: { 'Retry-After': String(L.period_seconds) } });
    }
  }
}

/** A tool's JSON text, from the edge cache when this data and code already answered the same arguments here. */
async function cached(ctx, origin, name, args, compute) {
  const cache = globalThis.caches?.default;
  const key = new Request(`${origin}/__cache/${R.version}/${name}?a=${encodeURIComponent(JSON.stringify(Object.entries(args).sort()))}`);
  const hit = cache && await cache.match(key);
  if (hit) return hit.text();
  const body = JSON.stringify(await compute());
  if (cache) ctx.waitUntil(cache.put(key, new Response(body, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=86400' } })));
  return body;
}

async function photo(env, ctx, request, key) {
  if (!env.PHOTOS || !/^[0-9a-f]{20}\.(webp|jpe?g|png)$/.test(key)) throw new ApiError(404, 'not_found', 'No such photo.');
  const cache = globalThis.caches?.default;
  // Keyed by path only: a query string must not force a fresh read from R2.
  const cacheKey = new Request(new URL(`/photos/${key}`, request.url));
  const hit = cache && await cache.match(cacheKey);
  if (hit) return hit;
  const obj = await env.PHOTOS.get(key);
  if (!obj) throw new ApiError(404, 'not_found', 'No such photo.');
  const res = new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, immutable',
      ETag: obj.httpEtag,
      ...CORS,
    },
  });
  if (cache) ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}

const limitsText = () => {
  const L = R.limits;
  return {
    anonymous: `${L.anonymous} requests per ${L.period_seconds} s per IP (per session on /mcp), no key needed`,
    keyed: `${L.keyed} requests per ${L.period_seconds} s per key`,
    exceeded: `HTTP 429 with Retry-After: ${L.period_seconds}`,
  };
};

function about(origin) {
  return {
    name: 'Open recipe corpus API',
    description: 'Recipes from Wikibooks and Wikisource cookbooks, structured and checked, as REST and MCP.',
    release: R.release,
    dataset: R.dataset,
    languages: R.languages,
    fallback_language: R.fallback_language,
    endpoints: {
      search: `${origin}/v1/recipes?q=pierogi&lang=en`,
      recipe: `${origin}/v1/recipes/{id}?lang=en&servings=4`,
      facets: `${origin}/v1/facets?lang=en`,
      mcp: `${origin}/mcp`,
      openapi: `${origin}/openapi.json`,
      llms: `${origin}/llms.txt`,
    },
    limits: limitsText(),
    features: { fulltext: true, semantic: false, photos: R.photos, nutrition: false },
    license: {
      data: 'CC-BY-SA-4.0',
      url: 'https://creativecommons.org/licenses/by-sa/4.0/',
      note: 'Every recipe carries an attribution object. Keep its credit, links and licence when you reuse the recipe.',
    },
  };
}

function openapi(origin) {
  const params = (name, skip = []) => Object.entries(TOOLS[name].params).filter(([k]) => !skip.includes(k)).map(([k, s]) => ({
    name: k, in: 'query', description: s.description,
    schema: s.type === 'array' ? { type: 'array', items: s.items } : { ...s, description: undefined },
    ...(s.type === 'array' ? { style: 'form', explode: false } : {}),
  }));
  const ok = { 200: { description: 'OK' }, 400: { description: 'bad_request or unsupported_language' }, 404: { description: 'not_found or no_text_in_language' }, 409: { description: 'release_changed' }, 429: { description: 'rate_limited (see Retry-After)' } };
  return {
    openapi: '3.1.0',
    info: { title: 'Open recipe corpus API', version: R.release, license: { name: 'Apache-2.0 (service), CC BY-SA 4.0 (data)' } },
    servers: [{ url: origin }],
    components: { securitySchemes: { key: { type: 'http', scheme: 'bearer', description: 'Optional. The free tier needs no key.' } } },
    paths: {
      '/v1/recipes': { get: { operationId: 'search_recipes', summary: TOOLS.search_recipes.description, parameters: params('search_recipes'), responses: ok } },
      '/v1/recipes/{id}': {
        get: {
          operationId: 'get_recipe', summary: TOOLS.get_recipe.description,
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, ...params('get_recipe', ['id'])], responses: ok,
        },
      },
      '/v1/facets': { get: { operationId: 'list_facets', summary: TOOLS.list_facets.description, parameters: params('list_facets'), responses: ok } },
      '/mcp': { post: { operationId: 'mcp', summary: 'MCP (Streamable HTTP, stateless). Tools: ' + Object.keys(TOOLS).join(', '), responses: { 200: { description: 'JSON-RPC response' } } } },
    },
    'x-mcp-tools': Object.keys(TOOLS).map((name) => ({ name, inputSchema: inputSchema(name) })),
  };
}

function llms(origin) {
  const L = limitsText();
  return `# Open recipe corpus API

> Recipes from Wikibooks and Wikisource cookbooks, structured and checked, in ${Object.keys(R.languages).join(', ')}. Read-only, free, rate-limited.

- Search: GET ${origin}/v1/recipes?q=<words>&ingredients=<a,b>&lang=<lang>&category=&dish_type=&cuisine=&tags=&max_total_minutes=&has_photo=&limit=&cursor=
- One recipe: GET ${origin}/v1/recipes/<id>?lang=<lang>&servings=<n>
- Filter values and counts: GET ${origin}/v1/facets?lang=<lang>
- MCP (Streamable HTTP): ${origin}/mcp, tools ${Object.keys(TOOLS).join(', ')}
- OpenAPI: ${origin}/openapi.json

Limits: ${L.anonymous}. ${L.exceeded}.
Licence: every recipe is CC BY-SA 4.0 and carries "attribution" (source page, revision, history, licences, changes). Keep it with the recipe.
Machine-translated text is marked "machine_translated": true. AI-generated photos are marked "ai_generated": true.
Errors: {"error": {"code", "message", "retryable"}}.
`;
}
