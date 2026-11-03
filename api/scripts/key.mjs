// Make an API key for the keyed tier. Prints the key once and the corpus.config.json `keys` entry, which holds only
// its SHA-256. Keep the key; send or commit only the entry.
// usage: node api/scripts/key.mjs <id> [--note "..."]           a new random key
//        node api/scripts/key.mjs <id> --from-env NAME           the entry for a key already in $NAME (prints no key)
import { createHash, randomBytes } from 'node:crypto';

const [id] = process.argv.slice(2);
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
if (!id || !/^[a-z0-9][a-z0-9-]{1,40}$/.test(id)) {
  console.error('usage: node api/scripts/key.mjs <id: lower-case letters, digits, dashes> [--note "..."] [--from-env NAME]');
  process.exit(2);
}
const env = arg('--from-env');
const key = env ? process.env[env] : `orc_${randomBytes(32).toString('base64url')}`;
if (!key || key.length < 32) {
  console.error(`${env} is unset or shorter than 32 characters`);
  process.exit(2);
}
const entry = { id, sha256: createHash('sha256').update(key).digest('hex'), ...(arg('--note') ? { note: arg('--note') } : {}) };
console.log(JSON.stringify(env ? { config_entry: entry } : { key, config_entry: entry }, null, 2));
