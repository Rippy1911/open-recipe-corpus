// Build one release set for the recipe API from an open release (a directory holding the dataset's manifest.json and
// data/): the D1 load SQL, the photo upload list, the Worker's generated module and wrangler.jsonc. Everything
// instance-specific comes from api/corpus.config.json; an unknown or invalid key fails the build.
// usage: node api/scripts/build.mjs [--config <file>] [--release <dir>] [--ai-dir <dir>] [--database-id <uuid>]
//   --release and --ai-dir override the config's release_dir and photos.ai_dir; paths given here are relative to the
//   current directory, paths in the config to the config file.
//   writes api/.build/{load.sql,photos.json}, api/src/generated.js and api/wrangler.jsonc (all gitignored)
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fold } from '../src/text.js';

export const SERVICE = fileURLToPath(new URL('..', import.meta.url));
export const COMPATIBILITY_DATE = '2026-07-01';
// Photo licences a contributed photo may carry. Our AI-generated images are CC0-1.0 with ai_generated: true.
export const PHOTO_LICENSES = ['CC0-1.0', 'CC-BY-4.0', 'CC-BY-SA-4.0', 'public-domain'];

const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));
const readJsonl = (f) => readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
const dirs = (d) => (existsSync(d) ? readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort() : []);
const sha = (s, n = 64) => createHash('sha256').update(s).digest('hex').slice(0, n);

// ---- corpus.config.json ----
const str = (v) => typeof v === 'string' && v.length > 0;
const posInt = (v) => Number.isInteger(v) && v > 0;
const strList = (v) => Array.isArray(v) && v.length > 0 && v.every(str);
const nullable = (shape) => ({ nullable: true, shape });
const SHAPE = {
  name: (v) => typeof v === 'string' && /^[a-z0-9][a-z0-9-]{0,30}$/.test(v),
  domain: (v) => v === null || (typeof v === 'string' && /^([a-z0-9-]+\.)+[a-z]{2,}$/.test(v)),
  release_dir: str,
  languages: (v) => strList(v) && v.every((l) => /^[a-z]{2,3}$/.test(l)) && new Set(v).size === v.length,
  fallback_language: (v, c) => str(v) && c.languages?.includes(v),
  sources: { include: strList, licenses: strList },
  photos: nullable({ bucket: (v) => typeof v === 'string' && /^[a-z0-9][a-z0-9-]{2,62}$/.test(v), contributed_dir: (v) => v === null || str(v), ai_dir: (v) => v === null || str(v) }),
  limits: { anonymous: posInt, keyed: posInt, network: posInt, period_seconds: (v) => v === 10 || v === 60, namespace_id: posInt },
  // Keyed tier: the SHA-256 of each key (api/scripts/key.mjs makes one), never the key itself.
  keys: (v) => Array.isArray(v) && new Set(v.map((k) => k?.id)).size === v.length && v.every((k) => k
    && /^[a-z0-9][a-z0-9-]{1,40}$/.test(k.id) && /^[0-9a-f]{64}$/.test(k.sha256) && Object.keys(k).every((x) => ['id', 'sha256', 'note'].includes(x))),
};

/** Validate a parsed config; throws listing every problem. */
export function validateConfig(cfg) {
  const errors = [];
  const walk = (obj, shape, path) => {
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) { errors.push(`${path || 'config'}: must be an object`); return; }
    for (const k of Object.keys(obj)) if (!(k in shape) && k !== '$comment') errors.push(`${path}${k}: unknown key`);
    for (const [k, s] of Object.entries(shape)) {
      const v = obj[k], p = `${path}${k}`;
      if (v === undefined) errors.push(`${p}: missing`);
      else if (typeof s === 'function') { if (!s(v, cfg)) errors.push(`${p}: invalid value ${JSON.stringify(v)}`); }
      else if (s.nullable) { if (v !== null) walk(v, s.shape, `${p}.`); }
      else walk(v, s, `${p}.`);
    }
  };
  walk(cfg, SHAPE, '');
  if (errors.length) throw new Error(`corpus.config.json:\n  ${errors.join('\n  ')}`);
  return cfg;
}

// ---- the release ----
/** An open release directory: manifest.json, data/recipes.jsonl, data/text/<lang>.jsonl, data/sources.json. */
export function readRelease(dir) {
  if (!existsSync(join(dir, 'manifest.json'))) throw new Error(`no open release in ${dir} (no manifest.json): set release_dir or pass --release`);
  const text = {};
  for (const f of readdirSync(join(dir, 'data', 'text'))) {
    const m = f.match(/^([a-z]{2,3})\.jsonl$/);
    if (m) text[m[1]] = readJsonl(join(dir, 'data', 'text', f));
  }
  return {
    manifest: readJson(join(dir, 'manifest.json')),
    core: readJsonl(join(dir, 'data', 'recipes.jsonl')),
    text,
    sources: readJson(join(dir, 'data', 'sources.json')),
  };
}

const asciiSlug = (s) => fold(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
const fileId = (id) => id.replace(':', '-');

/**
 * Photos per recipe id: a contributed photo (`<contributed_dir>/<id, ":" as "-">/<n>.<ext>` + `<n>.json` with author
 * and licence) wins; otherwise one of our AI dish images (`<ai_dir>/<dish>/<n>.json` + image), matched by the recipe's
 * canon QID, else by an exact dish-name match in any language. Returns Map<id, { file, key, meta }>.
 */
export function findPhotos(core, text, { contributed_dir, ai_dir }, root, warn = console.warn) {
  const contributed = new Map(), ai = [];
  for (const rid of contributed_dir ? dirs(resolve(root, contributed_dir)) : []) {
    const d = join(resolve(root, contributed_dir), rid);
    const f = readdirSync(d).filter((x) => /^\d+\.json$/.test(x)).sort((a, b) => parseInt(a, 10) - parseInt(b, 10))[0];
    const s = f && readJson(join(d, f));
    const img = f && readdirSync(d).find((x) => x.startsWith(`${parseInt(f, 10)}.`) && /\.(webp|jpe?g|png)$/i.test(x));
    if (!img || !s.author || !PHOTO_LICENSES.includes(s.license)) { warn(`${contributed_dir}/${rid}: needs an image, an author and one of ${PHOTO_LICENSES.join(', ')}; skipped`); continue; }
    contributed.set(rid, { file: join(d, img), meta: { ai_generated: false, license: s.license, author: s.author, ...(s.source_url ? { source_url: s.source_url } : {}) } });
  }
  for (const dish of ai_dir ? dirs(resolve(root, ai_dir)) : []) {
    const d = join(resolve(root, ai_dir), dish);
    for (const f of readdirSync(d).filter((x) => /^\d+\.json$/.test(x)).sort((a, b) => parseInt(a, 10) - parseInt(b, 10))) {
      const s = readJson(join(d, f));
      const file = join(d, s.file ?? f.replace('.json', '.webp'));
      if (s.ai_generated !== true || !existsSync(file)) continue;
      ai.push({ file, dish: asciiSlug(s.dish ?? ''), qid: s.qid ?? null, meta: { ai_generated: true, digital_source_type: 'trainedAlgorithmicMedia', license: 'CC0-1.0' } });
      break;
    }
  }
  const names = new Map();
  for (const rows of Object.values(text)) for (const t of rows) (names.get(t.id) ?? names.set(t.id, new Set()).get(t.id)).add(asciiSlug(t.name));
  const out = new Map();
  for (const r of core) {
    const hit = contributed.get(fileId(r.id))
      ?? (r.canon_qid && ai.find((p) => p.qid === r.canon_qid))
      ?? ai.find((p) => p.dish && names.get(r.id)?.has(p.dish));
    if (!hit) continue;
    const bytes = readFileSync(hit.file);
    out.set(r.id, { file: hit.file, key: `${sha(bytes, 20)}${extname(hit.file).toLowerCase().replace('.jpeg', '.jpg')}`, meta: hit.meta });
  }
  return out;
}

/** What this instance serves from a release: configured sources, source licences and languages only. */
export function selectRelease(rel, cfg) {
  const core = rel.core.filter((r) => cfg.sources.include.includes(r.provenance.source) && cfg.sources.licenses.includes(r.provenance.source_license));
  const ids = new Set(core.map((r) => r.id));
  const text = Object.fromEntries(cfg.languages.map((l) => [l, (rel.text[l] ?? []).filter((t) => ids.has(t.id))]));
  const withText = new Set(Object.values(text).flatMap((rows) => rows.map((t) => t.id)));
  const kept = core.filter((r) => withText.has(r.id));
  assertServable(kept, text);
  return { core: kept, text, sources: rel.sources.filter((s) => cfg.sources.include.includes(s.id) && kept.some((r) => r.provenance.source === s.id)) };
}

/** Fail the build on a record the API could not serve with its attribution, or whose text does not line up. */
function assertServable(core, text) {
  const bad = [];
  const byId = new Map(core.map((r) => [r.id, r]));
  for (const r of core) {
    const p = r.provenance ?? {};
    const missing = ['source', 'title', 'url', 'history_url', 'attribution', 'source_license', 'license', 'changes'].filter((k) => !p[k]);
    if (!URL.canParse(p.url ?? '')) missing.push('url (not a URL)');
    if (missing.length) bad.push(`${r.id}: provenance lacks ${missing.join(', ')}`);
  }
  for (const [l, rows] of Object.entries(text)) {
    for (const t of rows) {
      if (!t.name || !Array.isArray(t.steps) || t.ingredients?.length !== byId.get(t.id).ingredients.length) bad.push(`${t.id} (${l}): text has no name or steps, or its ingredients do not match the core`);
    }
  }
  if (bad.length) throw new Error(`${bad.length} record(s) cannot be served:\n  ${bad.slice(0, 10).join('\n  ')}`);
}

// ---- SQL ----
const lit = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
export const SCHEMA = [
  'CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)',
  'CREATE TABLE recipe (id TEXT PRIMARY KEY, source TEXT NOT NULL, category TEXT, dish_type TEXT, cuisine TEXT, total_min INTEGER, tags TEXT NOT NULL, has_photo INTEGER NOT NULL, core TEXT NOT NULL, photo TEXT)',
  'CREATE TABLE txt (n INTEGER PRIMARY KEY, id TEXT NOT NULL, lang TEXT NOT NULL, name_norm TEXT NOT NULL, body TEXT NOT NULL, UNIQUE (id, lang))',
  'CREATE INDEX txt_name ON txt (lang, name_norm)',
  // Contentless: the index only finds rows; txt holds the text. Trigram over folded text finds substrings in any language.
  "CREATE VIRTUAL TABLE fts USING fts5 (name, ingredients, summary, content='', tokenize='trigram')",
];

/** INSERT statements of `rows` (arrays of values), several rows each, every statement under D1's 100 KB limit. */
function inserts(table, cols, rows, maxBytes = 90_000) {
  const out = [];
  let buf = [], size = 0;
  const head = `INSERT INTO ${table} (${cols.join(', ')}) VALUES `;
  for (const r of rows) {
    const v = `(${r.map(lit).join(', ')})`, b = Buffer.byteLength(v) + 2;
    if (b + head.length > maxBytes) throw new Error(`${table} row ${r[0]} is over ${maxBytes} bytes`);
    if (buf.length && size + b + head.length > maxBytes) { out.push(head + buf.join(', ')); buf = []; size = 0; }
    buf.push(v); size += b;
  }
  if (buf.length) out.push(head + buf.join(', '));
  return out;
}

/** Recipe counts per filter value, as a language's searches see them (its own text, else the fallback's). */
function facetsFor(core, text, L, F) {
  const own = new Set(text[L].map((t) => t.id));
  const fb = L === F ? new Set() : new Set(text[F].map((t) => t.id).filter((id) => !own.has(id)));
  const rows = core.filter((r) => own.has(r.id) || fb.has(r.id));
  const count = (f) => {
    const m = {};
    for (const r of rows) for (const v of [].concat(f(r))) if (v != null) m[v] = (m[v] ?? 0) + 1;
    return Object.fromEntries(Object.entries(m).sort(([a, x], [b, y]) => y - x || a.localeCompare(b)));
  };
  return {
    recipes: rows.length,
    in_fallback_language: fb.size,
    category: count((r) => r.category),
    dish_type: count((r) => r.dish_type),
    cuisine: count((r) => r.cuisine),
    tags: count((r) => r.tags),
    source: count((r) => r.provenance.source),
  };
}

/**
 * Everything a deploy needs, from a validated config, a release and its photos: { release, version, sql: [statements],
 * generated (module text), counts, probe, photos: [{ key, file, contentType }] }. Deterministic for the same inputs.
 * `release` names the data (and its D1 database); `version` adds the Worker code, and keys the edge cache.
 */
export function buildSet(cfg, rel, photos = new Map()) {
  const sel = selectRelease(rel, cfg);
  const F = cfg.fallback_language;
  const languages = Object.fromEntries(cfg.languages.map((l) => [l, { status: sel.text[l].length ? 'available' : 'pending', recipes: sel.text[l].length }]));
  if (languages[F].status !== 'available') throw new Error(`fallback_language ${F} has no text in this release`);
  const m = rel.manifest;

  const recipeRows = sel.core.map((r) => {
    const { prep, cook } = r.time_min, p = photos.get(r.id);
    return [r.id, r.provenance.source, r.category, r.dish_type, r.cuisine, prep != null && cook != null ? prep + cook : null,
      JSON.stringify(r.tags), p ? 1 : 0, JSON.stringify(r), p ? JSON.stringify({ path: `/photos/${p.key}`, ...p.meta }) : null];
  });
  let n = 0;
  const txtRows = [], ftsRows = [];
  for (const l of cfg.languages) {
    for (const t of sel.text[l]) {
      n += 1;
      txtRows.push([n, t.id, l, fold(t.name), JSON.stringify(t)]);
      ftsRows.push([n, fold(t.name), fold(t.ingredients.map((i) => i.name).join(' | ')), fold(t.summary)]);
    }
  }
  const counts = { recipes: recipeRows.length, text: Object.fromEntries(cfg.languages.map((l) => [l, sel.text[l].length])), photos: photos.size };
  const rows = [
    ...inserts('recipe', ['id', 'source', 'category', 'dish_type', 'cuisine', 'total_min', 'tags', 'has_photo', 'core', 'photo'], recipeRows),
    ...inserts('txt', ['n', 'id', 'lang', 'name_norm', 'body'], txtRows),
    ...inserts('fts', ['rowid', 'name', 'ingredients', 'summary'], ftsRows),
  ];
  // The release id hashes the SQL itself, so any change to the data, the schema or the folding is a new release.
  const release = `${m.corpus_revision}${m.dirty ? 'd' : ''}-${sha([...SCHEMA, ...rows].join('\n'), 8)}`;
  const code = ['index.js', 'api.js', 'mcp.js', 'text.js'].map((f) => readFileSync(join(SERVICE, 'src', f), 'utf8')).join('\n');
  const version = `${release}-${sha(code, 6)}`;
  const sql = [
    ...SCHEMA,
    ...inserts('meta', ['k', 'v'], [['release', release], ['dataset', JSON.stringify(m)], ['counts', JSON.stringify(counts)]]),
    ...rows,
    // Written last: a database without it was not fully loaded.
    ...inserts('meta', ['k', 'v'], [['complete', release]]),
  ];
  const facets = Object.fromEntries(cfg.languages.map((l) => {
    const L = languages[l].status === 'available' ? l : F;
    return [L, facetsFor(sel.core, sel.text, L, F)];
  }));
  const values = (field) => [...new Set(sel.core.flatMap((r) => [].concat(field(r))).filter((v) => v != null))].sort();
  const generated = {
    name: cfg.name,
    release,
    version,
    dataset: { name: m.dataset, version: m.version, corpus_revision: m.corpus_revision, generated_at: m.generated_at, license: m.data_license },
    languages,
    fallback_language: F,
    sources: sel.sources,
    enums: { category: values((r) => r.category), dish_type: values((r) => r.dish_type), cuisine: values((r) => r.cuisine), tags: values((r) => r.tags), source: sel.sources.map((s) => s.id) },
    facets,
    photos: photos.size > 0,
    limits: { anonymous: cfg.limits.anonymous, keyed: cfg.limits.keyed, network: cfg.limits.network, period_seconds: cfg.limits.period_seconds },
    keys: Object.fromEntries(cfg.keys.map((k) => [k.sha256, k.id])),
  };
  const TYPES = { '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png' };
  return {
    release,
    version,
    sql,
    counts,
    // A word the readiness check searches for: the first 3+ letter word of the first recipe name.
    probe: ftsRows[0]?.[1].split(/[^\p{L}\p{N}]+/u).find((w) => [...w].length >= 3) ?? null,
    generated: `// Generated by api/scripts/build.mjs for release ${release}. Do not edit.\nexport default ${JSON.stringify(generated, null, 2)};\n`,
    photos: [...new Map([...photos.values()].map((p) => [p.key, { key: p.key, file: p.file, contentType: TYPES[extname(p.key)] }])).values()],
  };
}

/** wrangler.jsonc for one release set. Without a domain the Worker answers on its workers.dev URL only. */
export function wranglerConfig(cfg, { release, databaseId }) {
  const L = cfg.limits, ns = (i) => String(L.namespace_id + i);
  const limit = (name, i, n) => ({ name, namespace_id: ns(i), simple: { limit: n, period: L.period_seconds } });
  return {
    $schema: 'node_modules/wrangler/config-schema.json',
    name: cfg.name,
    main: 'src/index.js',
    compatibility_date: COMPATIBILITY_DATE,
    workers_dev: true,
    ...(cfg.domain ? { routes: [{ pattern: cfg.domain, custom_domain: true }] } : {}),
    d1_databases: [{ binding: 'DB', database_name: `${cfg.name}-${release}`, database_id: databaseId ?? 'local' }],
    ...(cfg.photos ? { r2_buckets: [{ binding: 'PHOTOS', bucket_name: cfg.photos.bucket }] } : {}),
    ratelimits: [limit('LIMIT_ANON', 0, L.anonymous), limit('LIMIT_KEYED', 1, L.keyed), limit('LIMIT_NETWORK', 2, L.network)],
    // Request logs without query strings: searches are never logged.
    observability: { enabled: true, head_sampling_rate: 0.1, redact_query_string: true },
  };
}

/** Load config and release, build the set and write it. Returns what deploy.mjs needs. */
export function build({ config = join(SERVICE, 'corpus.config.json'), release: relDir, aiDir, databaseId } = {}) {
  const root = resolve(config, '..');
  const cfg = validateConfig(readJson(config));
  if (aiDir && !cfg.photos) throw new Error('--ai-dir needs a photos section in the config');
  const dir = relDir ? resolve(relDir) : resolve(root, cfg.release_dir);
  const rel = readRelease(dir);
  const sel = selectRelease(rel, cfg);
  const photoDirs = cfg.photos && (aiDir ? { ...cfg.photos, ai_dir: resolve(aiDir) } : cfg.photos);
  const photos = photoDirs ? findPhotos(sel.core, sel.text, photoDirs, root) : new Map();
  const set = buildSet(cfg, rel, photos);
  const out = join(SERVICE, '.build');
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'load.sql'), set.sql.map((s) => `${s};`).join('\n') + '\n');
  writeFileSync(join(out, 'photos.json'), JSON.stringify(set.photos, null, 2) + '\n');
  writeFileSync(join(SERVICE, 'src', 'generated.js'), set.generated);
  writeFileSync(join(SERVICE, 'wrangler.jsonc'), `// Generated by api/scripts/build.mjs from corpus.config.json. Do not edit.\n${JSON.stringify(wranglerConfig(cfg, { release: set.release, databaseId }), null, 2)}\n`);
  return { cfg, set, database: `${cfg.name}-${set.release}`, manifest: rel.manifest, dir };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
  const { set, database } = build({ config: arg('--config'), release: arg('--release'), aiDir: arg('--ai-dir'), databaseId: arg('--database-id') });
  console.log(JSON.stringify({ release: set.release, database, statements: set.sql.length, ...set.counts }));
}
