# Recipe API and MCP server

A free, read-only API over the open recipe corpus: recipes from the Wikibooks and Wikisource cookbooks, structured
into fields and checked, in Polish and English. The same Worker serves REST and a remote MCP server. It runs on
Cloudflare Workers, with D1 full-text search and photos in R2. Search runs in SQL, so no AI model is called per
request.

- **Base URL:** `https://recipes.airon.app`
- **MCP:** `https://recipes.airon.app/mcp` (Streamable HTTP, stateless)
- **No key needed.** The free tier allows 10 requests per 10 seconds.
- **Licences:** the data is CC BY-SA 4.0, and every recipe carries its own attribution. The code is Apache-2.0.

## Use the API / MCP

### REST

| Endpoint | What it returns |
|---|---|
| `GET /v1/recipes?q=…` | A page of matching recipes, in compact form. |
| `GET /v1/recipes/{id}` | One recipe with ingredients, amounts and steps. |
| `GET /v1/facets` | The languages and sources, plus every filter value with its recipe count. |
| `GET /` | What this instance serves: release, languages, limits and endpoints. |
| `GET /openapi.json` · `GET /llms.txt` | Machine-readable descriptions of the API. |

**Search parameters** (all optional; they combine with AND):

| Parameter | Meaning |
|---|---|
| `q` | Words to find in the name, summary or ingredient names. Diacritics are optional: `zurek` finds *Żurek*. Words under 3 letters are ignored when the query has a longer word. A query of short words only matches the start of a name. |
| `ingredients` | Ingredient names the recipe must all contain. Comma-separated or repeated: `ingredients=kapusta,grzyby`. |
| `lang` | `pl` or `en` (default `en`). A configured language with no text yet falls back to `en` and says `"fallback": true`. |
| `category`, `dish_type`, `cuisine`, `source` | One value each. `/v1/facets` lists the values. |
| `tags` | Recipes that carry all of these tags, e.g. `tags=vegetarian,quick`. |
| `max_total_minutes` | Prep plus cook time is at most this. A recipe with an unknown time is left out. |
| `has_photo` | `true` or `false`. |
| `limit`, `cursor` | Page size (1–50, default 20). For the next page, send back the `next_cursor` you were given. |

An unknown parameter or value is a `400`, never silently ignored.

```bash
curl 'https://recipes.airon.app/v1/recipes?q=pierogi&lang=en&limit=3'
curl 'https://recipes.airon.app/v1/recipes/plwb:9356?lang=en&servings=4'
```

**One recipe** (`GET /v1/recipes/plwb:9356?lang=en`, shortened):

```json
{
  "release": "5b066e2-4d03f6fc", "lang": "en", "lang_served": "en", "fallback": false,
  "recipe": {
    "id": "plwb:9356", "lang": "en", "name": "Bigos (Polish hunter's stew)", "summary": "…",
    "machine_translated": true, "translated_from": "pl", "source_lang": "pl", "canon_qid": "Q598222",
    "category": "dinner", "dish_type": "main", "cuisine": "polish", "servings": 10,
    "time_min": { "prep": 40, "cook": 240, "total": 280 },
    "tags": ["gluten_free", "dairy_free", "high_protein"], "allergens": [],
    "ingredients": [{ "name": "fresh white cabbage", "qty": 2, "unit": "kg" }, "…"],
    "steps": ["…"],
    "photo": { "url": "https://recipes.airon.app/photos/….webp", "ai_generated": true, "license": "CC0-1.0", "note": "AI-generated illustration of the dish, not a photo of this recipe." },
    "attribution": {
      "title": "Książka kucharska/Bigos", "source": "pl-wikibooks",
      "url": "https://pl.wikibooks.org/wiki/…", "revision": 551039,
      "revision_url": "https://pl.wikibooks.org/w/index.php?oldid=551039",
      "history_url": "https://pl.wikibooks.org/w/index.php?curid=9356&action=history",
      "credit": "Autorzy Wikibooks (pl.wikibooks.org, Książka kucharska)",
      "source_license": "CC-BY-SA-4.0", "license": "CC-BY-SA-4.0",
      "license_url": "https://creativecommons.org/licenses/by-sa/4.0/",
      "changes": "structured into fields and edited for clarity; machine-translated from pl",
      "machine_translated": true
    }
  }
}
```

- **Search results** have the same fields, except `ingredients`, `steps`, `source_lang` and `canon_qid`. Instead they
  carry `ingredient_names` and a `url` that points to the full recipe.
- **`servings`** scales ingredient amounts only, never the step text. The response then says `"scaled": true,
  "steps_scaled": false`.
- **`unit`** is one of `g`, `kg`, `ml`, `l`, `pcs`, `tsp`, `tbsp`, `pinch`, `clove`, `slice`, `bunch`, `to_taste`.
  `qty` is `null` for `to_taste`.
- **Unknown values stay `null`.** Times can be unknown.
- **Photos.** A recipe's own contributed photo comes first, with its author and licence. Otherwise you may get an
  AI-generated illustration, marked `"ai_generated": true`.
- **Not served:** nutrition and semantic search.
- **Errors** look like `{"error": {"code", "message", "retryable"}}`. The codes are `bad_request`,
  `unsupported_language`, `not_found`, `no_text_in_language` (with `available_langs`), `release_changed` (your cursor
  is from an older data release: start the search again), `invalid_key`, `rate_limited` and `internal`.

### MCP

The tools are `search_recipes`, `get_recipe` and `list_facets`. They take the same parameters as REST, as JSON
values, and every result is also returned as `structuredContent`.

- **Stateless.** Every `POST /mcp` gets a plain JSON answer; there is no event stream and nothing is kept between
  requests. `initialize` returns an `Mcp-Session-Id`, which only serves the rate limit.
- **One message per request.** JSON-RPC batches are refused with `-32600`.

- **Claude Code:**

  ```bash
  claude mcp add --transport http recipes https://recipes.airon.app/mcp
  ```

- **Clients configured with JSON** (Cursor, Claude Desktop, VS Code and others):

  ```json
  { "mcpServers": { "recipes": { "type": "http", "url": "https://recipes.airon.app/mcp" } } }
  ```

- **Clients that only speak stdio:** use `{ "command": "npx", "args": ["mcp-remote", "https://recipes.airon.app/mcp"] }`.
- **To try it by hand:** run `npx @modelcontextprotocol/inspector`, choose *Streamable HTTP*, enter the URL above,
  then *Connect* → *List Tools*.

### Limits

| Who | Limit | Counted per |
|---|---|---|
| Anyone, no key | 10 requests per 10 seconds | IP address (an IPv6 address by its /64). On `/mcp` the count is per MCP session instead, because hosted assistants share egress IPs. |
| All MCP sessions from one IP | 100 requests per 10 seconds | IP address |
| Key holders | 100 requests per 10 seconds | key |
| Photos (`/photos/…`) | 100 requests per 10 seconds | IP address |

- **Over the limit** you get `429` with `Retry-After: 10`. Wait that long and retry.
- **Session ids are not secret.** Any client can start new sessions, so for one IP the real bound on `/mcp` is the
  100 per 10 s ceiling, not the per-session 10.
- **Limits are approximate.** They are counted at each Cloudflare location over a sliding window. Steady traffic is
  held to 10 per 10 s, and a burst from a quiet start may get one request more before the `429`s begin.
- **Answers are cached at the edge** for the current data release. Repeating a search is cheap, but it still counts
  against your limit.
- **Keys** are sent as `Authorization: Bearer <key>` or `X-API-Key: <key>`.
  - Contributors whose pull requests to the corpus are merged can ask for one, and so can services that call the
    API server to server.
  - To ask, make a key with `node api/scripts/key.mjs <your-id>` and keep it to yourself. Send only the
    `config_entry` it prints, which holds just the key's SHA-256.
  - Once the entry is in `api/corpus.config.json` and deployed, your key works.

### Licence

- **The recipes are CC BY-SA 4.0.** When you show or reuse a recipe, keep its `attribution`: the credit line, the
  link to the source page and its revision, the history link (that is where the authors are), the licence, and what
  was changed. If you adapt a recipe, share the adaptation under CC BY-SA 4.0.
- **Public-domain sources** (Wikisource cookbooks) carry `based_on` with the book, author and year.
- **Machine-translated text** is marked `machine_translated: true`. Say so when you show it.
- **Photos** carry their own licence. AI-generated images are CC0-1.0 and marked as AI-generated. Do not present
  them as photos of the recipe.
- **This service's code** is Apache-2.0.

## Host your own

You need Node 22, a Cloudflare account and an open release. A release is a directory with `manifest.json`,
`data/recipes.jsonl`, `data/text/<lang>.jsonl` and `data/sources.json`. The root of the open dataset repository is
one, so a clone of it is all you need: `api/` serves the release it sits in. Only recipes that passed the
publication gate are in it, and each language passed on its own.

**1. Configure.** Everything instance-specific is in one file, `api/corpus.config.json`, next to this README. The
build rejects an unknown or invalid key.

| Key | Meaning |
|---|---|
| `name` | The Worker's name. It also prefixes each release's D1 database. |
| `domain` | A hostname in a zone on your Cloudflare account, e.g. `recipes.example.org`. Only that one DNS record is created. `null` serves on `<name>.<your-subdomain>.workers.dev` only. The edge cache works on a custom domain only. |
| `release_dir` | Where the release is, relative to the config file: `..` is the repository root. `--release <dir>` overrides it. |
| `languages`, `fallback_language` | The languages to serve. A configured language with no text yet is listed as `pending` and served in the fallback. |
| `sources.include`, `sources.licenses` | Which sources to serve, and which **source** licences (`CC-BY-SA-4.0`, `public-domain`) are accepted. |
| `photos` | `null` for no photos. Otherwise `bucket` is the R2 bucket name. `contributed_dir` is where contributed photos are, relative to the config file (`../photos/<id with ":" as "-">/1.jpg` + `1.json` with `author` and `license`). `ai_dir` is a folder of your own AI images; leave it `null` unless you have one (`--ai-dir <dir>` sets it for one run). |
| `limits` | `anonymous`, `keyed` and `network` are request counts per `period_seconds`; `network` is the per-IP ceiling for MCP sessions and photos. The period must be `10` or `60`, a limit of the Workers rate-limiting binding. `namespace_id` reserves three ids, `n`, `n+1` and `n+2`: no other rate limiter in your account may use them. |
| `keys` | `[{ "id", "sha256", "note"? }]`, from `node api/scripts/key.mjs <id>`. Start with `[]`. |

**2. Install and log in.**

```bash
cd api
npm install
npx wrangler login
```

Instead of logging in, you can set `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. The token needs Workers
Scripts, D1 and R2 edit, plus Workers Routes and DNS edit on the zone if you use `domain`.

**3. Deploy.**

```bash
npm run deploy
```

This runs `node scripts/build.mjs`, then:

1. Creates a D1 database named `<name>-<release>` and loads it with `.build/load.sql`: the recipes, their text, and
   an FTS5 trigram index over folded text. The release id is a hash of that data, so the same data always lands in
   the same database.
2. Checks the database is ready: the row counts match the build, the index holds every text, and a full-text query
   answers. A load that was cut off is reported, with the command to delete that database and start again.
3. Uploads the photos to R2. They are content-addressed, and this machine remembers what it uploaded, so a re-run
   uploads nothing new. `--reupload-photos` forgets that, for a bucket that was emptied.
4. Runs `wrangler deploy` with the generated `wrangler.jsonc`.

The Worker answers on the URL wrangler prints. Re-running with the same release reuses the loaded database.
`--data-only` stops before step 4.

**4. Change the limit.** Edit `limits` in `corpus.config.json` and run `npm run deploy` again. The data is reused,
so only the Worker changes.

**5. Load new data.** Pull the new release (or point `--release` at it) and run `npm run deploy`.

- Each release gets its own database, and the new Worker version is bound to it. Cursors carry the release id, and
  the edge cache is keyed by the release and the code version, so nothing mixes two releases.
- **Rollback** is `npx wrangler rollback`: the previous version is still bound to the previous database.
- The deploy lists older release databases. Keep the last one for rollback and delete the rest with
  `npx wrangler d1 delete <name>`. Cloudflare's free plan allows 10 D1 databases per account.

**Run it locally** (no account needed):

```bash
node scripts/deploy.mjs --local
npx wrangler dev
```

`npm test` runs the Worker in workerd (Miniflare) against a five-recipe fixture.

**Cost.** One release of 3,000 recipes in two languages is about 11 MB of SQL and 17 MB in D1, with the index. That
fits Cloudflare's free plan:
Workers, D1 and R2 each have a free allowance, and the rate-limiting binding and custom domains cost nothing extra.
On the free plan, a day over the allowance fails requests rather than billing you. Check the current allowances on
Cloudflare's pricing pages before you count on them.
