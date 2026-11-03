// Deploy one release set: build it, create and load its own D1 database (once per release), check it is ready,
// upload its photos to R2, then deploy a Worker version bound to it. Re-running with the same release reuses the
// loaded database. Rollback is `npx wrangler rollback`: the previous version is still bound to the previous database.
// Needs `npx wrangler login` once, or CLOUDFLARE_API_TOKEN (Workers Scripts, D1, R2 edit) + CLOUDFLARE_ACCOUNT_ID.
// usage: node api/scripts/deploy.mjs [--config <file>] [--release <dir>] [--ai-dir <dir>] [--local] [--skip-photos] [--reupload-photos] [--data-only] [--allow-dirty]
//   --release, --ai-dir  as for build.mjs
//   --local  load a local D1 and R2 for `npx wrangler dev` instead (no account needed)
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { build, SERVICE } from './build.mjs';

const WRANGLER = join(SERVICE, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const has = (k) => process.argv.includes(k);
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const local = has('--local');
const where = local ? '--local' : '--remote';

/** Run wrangler in api/. `quiet` captures stdout (for --json); otherwise output streams to the terminal. */
function wrangler(args, { quiet = false } = {}) {
  if (!existsSync(WRANGLER)) throw new Error('wrangler is not installed: run `npm install` in api/ first');
  const r = spawnSync(process.execPath, [WRANGLER, ...args], { cwd: SERVICE, encoding: 'utf8', stdio: ['ignore', quiet ? 'pipe' : 'inherit', quiet ? 'pipe' : 'inherit'] });
  if (r.status !== 0) throw new Error(`wrangler ${args.join(' ')} exited ${r.status}${quiet ? `\n${r.stdout}\n${r.stderr}` : ''}`);
  return r.stdout;
}
const sqlJson = (db, sql) => JSON.parse(wrangler(['d1', 'execute', db, where, '--json', '--command', sql], { quiet: true }))[0].results;

const opts = { config: arg('--config'), release: arg('--release'), aiDir: arg('--ai-dir') };
let b = build(opts);
const { set, database } = b;
if (b.manifest.dirty && !local && !has('--allow-dirty')) throw new Error('the release was exported from a dirty checkout; commit first or pass --allow-dirty');
console.log(`release ${set.release}: ${set.counts.recipes} recipes, text ${JSON.stringify(set.counts.text)}, ${set.photos.length} photo files`);

// 1. The release's own database, created and loaded once.
let databaseId = `local-${set.release}`;
if (!local) {
  // By name from the account's list: `d1 info <name>` would resolve it through wrangler.jsonc, which is not written yet.
  const find = () => JSON.parse(wrangler(['d1', 'list', '--json'], { quiet: true })).find((d) => d.name === database);
  if (!find()) wrangler(['d1', 'create', database]);
  databaseId = find()?.uuid;
  if (!databaseId) throw new Error(`could not create D1 database ${database}`);
}
b = build({ ...opts, databaseId }); // wrangler.jsonc now names this database
const partial = `If a load was interrupted, delete the database (npx wrangler d1 delete ${database}${local ? ' --local' : ''}) and run again.`;
const loaded = (() => {
  try {
    return sqlJson(database, "SELECT (SELECT v FROM meta WHERE k = 'complete') AS complete")[0].complete ?? 'partial';
  } catch (e) {
    if (/no such table/.test(e.message)) return null; // a fresh database
    throw e;
  }
})();
if (loaded === null) {
  console.log(`loading ${database} (${set.sql.length} statements)`);
  wrangler(['d1', 'execute', database, where, '--yes', '--file', join('.build', 'load.sql')]);
} else if (loaded === 'partial') {
  throw new Error(`${database} was not fully loaded. ${partial}`);
} else if (loaded !== set.release) {
  throw new Error(`${database} holds release ${loaded}, not ${set.release}`);
}

// 2. Ready: row counts equal the build's, the index holds every text, and a full-text query answers.
const [c] = sqlJson(database, 'SELECT (SELECT count(*) FROM recipe) AS recipes, (SELECT count(*) FROM txt) AS texts, (SELECT count(*) FROM fts) AS indexed, '
  + `(SELECT count(*) FROM fts WHERE fts MATCH '"${set.probe}"') AS hits`);
const texts = Object.values(set.counts.text).reduce((a, n) => a + n, 0);
if (c.recipes !== set.counts.recipes || c.texts !== texts || c.indexed !== texts || !(c.hits > 0)) {
  throw new Error(`${database} is not ready: ${JSON.stringify(c)}; expected ${set.counts.recipes} recipes, ${texts} texts and index rows, hits for "${set.probe}". ${partial}`);
}
console.log(`ready: ${JSON.stringify(c)}`);

// 3. Photos, content-addressed, so uploading again is harmless. Uploads are remembered per bucket on this machine;
// --reupload-photos forgets that (for a bucket that was emptied or recreated).
if (b.cfg.photos && set.photos.length && !has('--skip-photos')) {
  const bucket = b.cfg.photos.bucket;
  const exists = () => new RegExp(`^name:\\s+${bucket}\\s*$`, 'm').test(wrangler(['r2', 'bucket', 'list'], { quiet: true }));
  if (!local && !exists()) wrangler(['r2', 'bucket', 'create', bucket]);
  const doneFile = join(SERVICE, '.build', `uploaded-${local ? 'local' : 'remote'}-${bucket}.json`);
  const done = new Set(existsSync(doneFile) && !has('--reupload-photos') ? JSON.parse(readFileSync(doneFile, 'utf8')) : []);
  const todo = set.photos.filter((p) => !done.has(p.key));
  console.log(`photos: ${todo.length} to upload, ${set.photos.length - todo.length} already there`);
  for (const p of todo) {
    wrangler(['r2', 'object', 'put', `${bucket}/${p.key}`, where, '--file', p.file, '--content-type', p.contentType, '--cache-control', 'public, max-age=31536000, immutable'], { quiet: true });
    done.add(p.key);
    writeFileSync(doneFile, JSON.stringify([...done]));
  }
}

// 4. The Worker version bound to this release.
if (local) {
  console.log('local data ready: run `npx wrangler dev` in api/');
} else if (has('--data-only')) {
  console.log(`data ready in ${database}; the Worker was not deployed (--data-only)`);
} else {
  wrangler(['deploy']);
  const older = JSON.parse(wrangler(['d1', 'list', '--json'], { quiet: true }))
    .filter((d) => d.name.startsWith(`${b.cfg.name}-`) && d.name !== database).map((d) => d.name);
  if (older.length) console.log(`older release databases (keep the last one for rollback, delete the rest with npx wrangler d1 delete <name>): ${older.join(', ')}`);
}
