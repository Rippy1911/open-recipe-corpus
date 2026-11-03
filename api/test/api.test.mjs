// The Worker in workerd (Miniflare): local D1 with FTS5, local R2, the rate-limit bindings. Built from a five-recipe
// fixture release, so it runs on a fresh clone. usage: npm test (in api/)
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { Miniflare } from 'miniflare';
import { buildSet, COMPATIBILITY_DATE, findPhotos, readRelease, SERVICE, selectRelease, validateConfig, wranglerConfig } from '../scripts/build.mjs';

const FIX = join(SERVICE, 'test', 'fixture');
const KEY = 'orc_fixture-key-not-a-real-one-0123456789abcdef';
const cfg = validateConfig({
  name: 'test-api', domain: null, release_dir: 'release', languages: ['pl', 'en', 'de'], fallback_language: 'en',
  sources: { include: ['pl-wikibooks', 'pl-wikisource'], licenses: ['CC-BY-SA-4.0', 'public-domain'] },
  photos: { bucket: 'test-photos', contributed_dir: 'photos', ai_dir: 'ai' },
  limits: { anonymous: 10, keyed: 100, network: 30, period_seconds: 10, namespace_id: 1 },
  keys: [{ id: 'fixture-client', sha256: createHash('sha256').update(KEY).digest('hex') }],
});
const rel = readRelease(join(FIX, 'release'));
const sel = selectRelease(rel, cfg);
const photos = findPhotos(sel.core, sel.text, cfg.photos, FIX, () => {});
const set = buildSet(cfg, rel, photos);

let mf, ipSeq = 0;
const nextIp = () => `198.51.100.${++ipSeq}`;
const fetchAt = (path, { ip = nextIp(), headers = {}, ...init } = {}) =>
  mf.dispatchFetch(`http://api.test${path}`, { ...init, headers: { 'cf-connecting-ip': ip, ...headers } });
const getJson = async (path, opts) => {
  const res = await fetchAt(path, opts);
  return { status: res.status, headers: res.headers, body: await res.json() };
};
const rpc = (body, opts = {}) => fetchAt('/mcp', {
  method: 'POST', ...opts,
  headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...opts.headers },
  body: JSON.stringify(body),
});

before(async () => {
  const mod = (f, contents = readFileSync(join(SERVICE, 'src', f), 'utf8')) => ({ type: 'ESModule', path: join(SERVICE, 'src', f), contents });
  const limits = Object.fromEntries(wranglerConfig(cfg, { release: set.release }).ratelimits.map((r) => [r.name, { namespace_id: r.namespace_id, simple: r.simple }]));
  mf = new Miniflare({
    modulesRoot: join(SERVICE, 'src'),
    modules: [mod('index.js'), mod('api.js'), mod('mcp.js'), mod('text.js'), mod('generated.js', set.generated)],
    compatibilityDate: COMPATIBILITY_DATE,
    d1Databases: { DB: 'test-db' },
    r2Buckets: ['PHOTOS'],
    ratelimits: limits,
  });
  const db = await mf.getD1Database('DB');
  for (const s of set.sql) await db.prepare(s).run();
  const bucket = await mf.getR2Bucket('PHOTOS');
  for (const p of set.photos) await bucket.put(p.key, readFileSync(p.file), { httpMetadata: { contentType: p.contentType } });
});
after(() => mf?.dispose());

describe('build', () => {
  test('a configured language with no text is pending; the release id carries the corpus revision', () => {
    const g = JSON.parse(set.generated.slice(set.generated.indexOf('{'), set.generated.lastIndexOf('}') + 1));
    assert.match(set.release, /^fixture-[0-9a-f]{8}$/);
    assert.match(g.version, new RegExp(`^${set.release}-[0-9a-f]{6}$`));
    assert.deepEqual(g.languages, { pl: { status: 'available', recipes: 5 }, en: { status: 'available', recipes: 4 }, de: { status: 'pending', recipes: 0 } });
    assert.deepEqual(set.counts, { recipes: 5, text: { pl: 5, en: 4, de: 0 }, photos: 2 });
  });
  test('photos: a contributed photo wins; else our AI image by canon QID; never by a partial name', () => {
    assert.deepEqual(photos.get('plwb:10326').meta, { ai_generated: false, license: 'CC-BY-4.0', author: 'Test Author', source_url: 'https://example.org/photo' });
    assert.deepEqual(photos.get('plwb:9356').meta, { ai_generated: true, digital_source_type: 'trainedAlgorithmicMedia', license: 'CC0-1.0' });
    assert.equal(photos.has('plws:520710'), false); // "Bigos z karpia" is not "Bigos"
  });
  test('an unknown or invalid config key fails the build', () => {
    assert.throws(() => validateConfig({ ...cfg, semantic: true }), /semantic: unknown key/);
    assert.throws(() => validateConfig({ ...cfg, limits: { ...cfg.limits, period_seconds: 30 } }), /limits\.period_seconds: invalid/);
    assert.throws(() => validateConfig({ ...cfg, fallback_language: 'fr' }), /fallback_language: invalid/);
    assert.throws(() => validateConfig({ ...cfg, keys: [{ id: 'x1', sha256: 'not-a-hash' }] }), /keys: invalid/);
  });
  test('a source left out of the config is left out of the set', () => {
    const only = buildSet({ ...cfg, sources: { ...cfg.sources, include: ['pl-wikibooks'] } }, rel);
    assert.equal(only.counts.recipes, 4);
  });
  test('the release id follows the data, and the load ends with its completion mark', () => {
    const edited = structuredClone(rel);
    edited.text.pl[0].name += ' (poprawione)';
    assert.notEqual(buildSet(cfg, edited, photos).release, set.release);
    assert.equal(buildSet(cfg, structuredClone(rel), photos).release, set.release);
    assert.match(set.sql.at(-1), /^INSERT INTO meta \(k, v\) VALUES \('complete', 'fixture-/);
    assert.throws(() => validateConfig({ ...cfg, languages: ['pl', 'pl'] }), /languages: invalid/);
  });
  test('a record without its attribution fields fails the build', () => {
    const broken = structuredClone(rel);
    delete broken.core[0].provenance.history_url;
    assert.throws(() => buildSet(cfg, broken), /provenance lacks history_url/);
  });
});

describe('REST', () => {
  test('search folds diacritics and returns attribution on every hit', async () => {
    const { status, body } = await getJson('/v1/recipes?q=zurek&lang=pl');
    assert.equal(status, 200);
    assert.deepEqual(body.results.map((r) => r.id), ['plwb:2728']);
    const a = body.results[0].attribution;
    assert.equal(a.license, 'CC-BY-SA-4.0');
    assert.equal(a.source_license, 'CC-BY-SA-4.0');
    assert.match(a.url, /^https:\/\/pl\.wikibooks\.org\/wiki\//);
    assert.match(a.revision_url, /^https:\/\/pl\.wikibooks\.org\/w\/index\.php\?oldid=\d+$/);
    assert.match(a.history_url, /action=history$/);
    assert.equal(a.machine_translated, false);
    assert.equal(body.release, set.release);
  });
  test('ingredients must all match, in the ingredient names only', async () => {
    const both = await getJson('/v1/recipes?ingredients=kapusta,kielbasa&lang=pl');
    assert.deepEqual(both.body.results.map((r) => r.id), ['plwb:9356']);
    const one = await getJson('/v1/recipes?ingredients=kielbasa&lang=pl');
    assert.deepEqual(one.body.results.map((r) => r.id).sort(), ['plwb:2728', 'plwb:9356']);
  });
  test('a query under 3 letters matches the start of a name', async () => {
    const { body } = await getJson('/v1/recipes?q=bi&lang=pl');
    assert.deepEqual(body.results.map((r) => r.id).sort(), ['plwb:9356', 'plws:520710']);
  });
  test('filters combine with AND; unknown total time is left out', async () => {
    assert.deepEqual((await getJson('/v1/recipes?dish_type=soup&lang=pl')).body.results.map((r) => r.id), ['plwb:2728']);
    assert.deepEqual((await getJson('/v1/recipes?tags=vegetarian,quick&lang=pl')).body.results.map((r) => r.id), ['plwb:10326']);
    const quick = (await getJson('/v1/recipes?max_total_minutes=600&lang=pl')).body.results.map((r) => r.id);
    assert.equal(quick.includes('plws:520710'), false);
    assert.equal((await getJson('/v1/recipes?has_photo=true&lang=pl')).body.results.length, 2);
  });
  test('English serves English text only; a pending language falls back and says so', async () => {
    const en = await getJson('/v1/recipes?q=bigos&lang=en');
    assert.deepEqual(en.body.results.map((r) => r.id), ['plwb:9356']);
    assert.equal(en.body.results[0].machine_translated, true);
    assert.match(en.body.results[0].attribution.changes, /machine-translated from pl$/);
    const de = await getJson('/v1/recipes?q=bigos&lang=de');
    assert.equal(de.status, 200);
    assert.deepEqual([de.body.lang, de.body.lang_served, de.body.fallback], ['de', 'en', true]);
  });
  test('pages: an opaque cursor, bound to the search and the release', async () => {
    const p1 = await getJson('/v1/recipes?lang=pl&limit=2');
    assert.equal(p1.body.results.length, 2);
    const p2 = await getJson(`/v1/recipes?lang=pl&limit=2&cursor=${p1.body.next_cursor}`);
    assert.equal(p2.body.results.length, 2);
    assert.equal(new Set([...p1.body.results, ...p2.body.results].map((r) => r.id)).size, 4);
    const other = await getJson(`/v1/recipes?lang=en&limit=2&cursor=${p1.body.next_cursor}`);
    assert.equal(other.body.error.code, 'bad_request');
    const old = Buffer.from(JSON.stringify({ r: 'older-release', h: 'x', o: 2 })).toString('base64url');
    const stale = await getJson(`/v1/recipes?lang=pl&cursor=${old}`);
    assert.deepEqual([stale.status, stale.body.error.code], [409, 'release_changed']);
  });
  test('get_recipe: amounts and steps; servings scales amounts only', async () => {
    const { body } = await getJson('/v1/recipes/plwb:9356?lang=en&servings=5');
    const r = body.recipe;
    assert.equal(r.servings, 5);
    assert.deepEqual([r.scaled, r.steps_scaled], [true, false]);
    assert.deepEqual(r.ingredients[0], { name: 'fresh white cabbage', qty: 1, unit: 'kg' });
    assert.equal(r.ingredients[2].qty, 375); // 750 g × 0.5
    assert.ok(r.steps.length > 0);
    assert.deepEqual(r.photo.ai_generated, true);
    assert.match(r.photo.url, /^http:\/\/api\.test\/photos\/[0-9a-f]{20}\.webp$/);
  });
  test('get_recipe errors: not found, no text in the language, unsupported language', async () => {
    assert.deepEqual((await getJson('/v1/recipes/plwb:1')).body.error.code, 'not_found');
    const pl = await getJson('/v1/recipes/plws:520710?lang=en');
    assert.deepEqual([pl.status, pl.body.error.code, pl.body.error.available_langs], [404, 'no_text_in_language', ['pl']]);
    const fr = await getJson('/v1/recipes/plwb:9356?lang=fr');
    assert.deepEqual([fr.status, fr.body.error.code, fr.body.error.retryable], [400, 'unsupported_language', false]);
  });
  test('unknown parameters and bad values are 400, never ignored', async () => {
    assert.equal((await getJson('/v1/recipes?query=bigos')).body.error.code, 'bad_request');
    assert.equal((await getJson('/v1/recipes?cuisine=martian')).status, 400);
    assert.equal((await getJson('/v1/recipes?limit=500')).status, 400);
    assert.equal((await getJson('/v1/recipes?__proto__=1')).body.error.code, 'bad_request');
    assert.equal((await getJson('/v1/recipes?constructor=1')).status, 400);
    assert.equal((await getJson('/v1/recipes/%E0%A4%A')).status, 400);
    assert.equal((await getJson('/v1/recipes?cursor=bnVsbA')).status, 400); // base64 of "null"
    assert.equal((await getJson(`/v1/recipes?cursor=${btoa(JSON.stringify({ r: set.release, h: 0, o: 1e9 }))}`)).status, 400);
  });
  test('a query of short words only matches name prefixes, however long it is', async () => {
    const { status, body } = await getJson(`/v1/recipes?q=${encodeURIComponent('ab '.repeat(30))}&lang=pl`);
    assert.deepEqual([status, body.results], [200, []]);
  });
  test('one recipe is read by index, not by scanning every text', async () => {
    const db = await mf.getD1Database('DB');
    const plan = (await db.prepare("EXPLAIN QUERY PLAN SELECT t.lang FROM recipe r LEFT JOIN txt t ON t.id = r.id WHERE r.id = 'plwb:9356'").all()).results.map((x) => x.detail);
    assert.equal(plan.some((d) => /^SCAN t\b/.test(d)), false, plan.join('; '));
  });
  test('facets count what a language serves', async () => {
    const { body } = await getJson('/v1/facets?lang=en');
    assert.equal(body.recipes, 4);
    assert.equal(body.dish_type.main, 2);
    assert.equal(body.languages.de.status, 'pending');
  });
  test('photos: served from R2 with a long cache; nutrition is never served', async () => {
    const r = (await getJson('/v1/recipes/plwb:10326?lang=pl')).body.recipe;
    assert.deepEqual([r.photo.ai_generated, r.photo.author, r.photo.license], [false, 'Test Author', 'CC-BY-4.0']);
    const res = await fetchAt(new URL(r.photo.url).pathname);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/jpeg');
    assert.match(res.headers.get('cache-control'), /immutable/);
    assert.equal(await res.text(), 'fixture contributed photo');
    assert.equal(JSON.stringify(r).includes('kcal'), false);
  });
  test('index, OpenAPI and llms.txt', async () => {
    const about = await getJson('/');
    assert.equal(about.body.endpoints.mcp, 'http://api.test/mcp');
    const oa = await getJson('/openapi.json');
    assert.equal(oa.body.openapi, '3.1.0');
    assert.match(await (await fetchAt('/llms.txt')).text(), /CC BY-SA 4\.0/);
  });
});

describe('rate limits', () => {
  test('the 11th request from one IP within 10 s is 429 with Retry-After', async () => {
    const ip = nextIp();
    const codes = [];
    for (let i = 0; i < 11; i++) codes.push((await fetchAt('/v1/recipes?q=bigos&lang=pl', { ip })).status);
    assert.deepEqual(codes, [...Array(10).fill(200), 429]);
    const res = await getJson('/v1/facets', { ip });
    assert.deepEqual([res.status, res.headers.get('retry-after'), res.body.error.code, res.body.error.retryable], [429, '10', 'rate_limited', true]);
    assert.equal((await fetchAt('/v1/facets', { ip: nextIp() })).status, 200); // another IP is unaffected
  });
  test('IPv6 addresses count per /64', async () => {
    const codes = [];
    for (let i = 0; i < 11; i++) codes.push((await fetchAt('/v1/facets', { ip: `2001:db8:7:1::${(i + 1).toString(16)}` })).status);
    assert.deepEqual(codes, [...Array(10).fill(200), 429]);
    assert.equal((await fetchAt('/v1/facets', { ip: '2001:db8:7:2::1' })).status, 200);
  });
  test('a key gets its own, higher limit; an unknown key is refused', async () => {
    const ip = nextIp();
    for (let i = 0; i < 10; i++) await fetchAt('/v1/facets', { ip });
    assert.equal((await fetchAt('/v1/facets', { ip })).status, 429);
    assert.equal((await fetchAt('/v1/facets', { ip, headers: { authorization: `Bearer ${KEY}` } })).status, 200);
    assert.equal((await fetchAt('/v1/facets', { ip, headers: { 'x-api-key': KEY } })).status, 200);
    const bad = await getJson('/v1/facets', { headers: { authorization: 'Bearer nope' } });
    assert.deepEqual([bad.status, bad.body.error.code], [401, 'invalid_key']);
  });
  test('MCP counts per session, under a per-IP ceiling', async () => {
    const ip = nextIp();
    const codes = async (sid, n) => {
      const out = [];
      for (let i = 0; i < n; i++) out.push((await rpc({ jsonrpc: '2.0', id: i, method: 'ping' }, { ip, headers: { 'mcp-session-id': sid } })).status);
      return out;
    };
    assert.deepEqual(await codes('session-aaaaaaaa', 11), [...Array(10).fill(200), 429]);
    assert.deepEqual(await codes('session-bbbbbbbb', 10), Array(10).fill(200));
    // The ceiling counts every request from this IP: 21 so far, so a third session gets 9 more under 30.
    assert.deepEqual(await codes('session-cccccccc', 10), [...Array(9).fill(200), 429]);
  });
});

describe('MCP', () => {
  test('initialize, tools/list, tools/call', async () => {
    const init = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
    assert.equal(init.status, 200);
    assert.match(init.headers.get('mcp-session-id'), /^[0-9a-f-]{36}$/);
    const i = await init.json();
    assert.equal(i.result.protocolVersion, '2025-06-18');
    assert.deepEqual(i.result.capabilities, { tools: { listChanged: false } });
    assert.equal((await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' })).status, 202);
    const list = await (await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).json();
    assert.deepEqual(list.result.tools.map((t) => t.name), ['search_recipes', 'get_recipe', 'list_facets']);
    assert.deepEqual(list.result.tools[1].inputSchema.required, ['id']);
    const call = await (await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'search_recipes', arguments: { q: 'pierogi', lang: 'en' } } })).json();
    assert.equal(call.result.isError, undefined);
    assert.deepEqual(call.result.structuredContent.results.map((r) => r.id), ['plwb:21745']);
    assert.deepEqual(JSON.parse(call.result.content[0].text), call.result.structuredContent);
  });
  test('a bad argument is a tool error the model can read; an unknown method is a protocol error', async () => {
    const bad = await (await rpc({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'get_recipe', arguments: { id: 'plwb:1' } } })).json();
    assert.equal(bad.result.isError, true);
    assert.equal(JSON.parse(bad.result.content[0].text).error.code, 'not_found');
    const unknown = await (await rpc({ jsonrpc: '2.0', id: 5, method: 'resources/list' })).json();
    assert.equal(unknown.error.code, -32601);
    assert.equal((await fetchAt('/mcp')).status, 405);
    const proto = await (await rpc({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'constructor', arguments: {} } })).json();
    assert.equal(proto.error.code, -32602);
  });
  test('one message per request: a batch is refused; a notification still carries CORS', async () => {
    const batch = await rpc([{ jsonrpc: '2.0', id: 1, method: 'ping' }, { jsonrpc: '2.0', id: 2, method: 'ping' }]);
    assert.deepEqual([batch.status, (await batch.json()).error.code], [400, -32600]);
    const note = await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' });
    assert.deepEqual([note.status, note.headers.get('access-control-allow-origin')], [202, '*']);
  });
});
