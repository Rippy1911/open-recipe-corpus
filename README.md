# Open recipe corpus

Recipes from the Wikibooks and Wikisource cookbooks, structured into fields and checked, in Polish and English.
Each recipe has servings, times, a category, dish type and cuisine, diet tags, allergens, ingredients with amounts in
fixed units, and steps. Every record links back to the page and revision it came from.

- **3,013 recipes** in Polish and **1,561** in English. The English text is machine-translated from Polish and
  marked as such.
- **Only recipes that passed review** are here, and each language passed on its own.
- **No nutrition** data.
- **97 AI-generated dish illustrations** are in `ai-images/`, CC0 and labelled as AI-generated. They are not
  photographs, and a contributed photo of the recipe takes their place.
- **Licences:** the data is CC BY-SA 4.0 ([`LICENSE-DATA.md`](LICENSE-DATA.md), [`ATTRIBUTION.md`](ATTRIBUTION.md)).
  The code in `api/` is Apache-2.0 ([`LICENSE`](LICENSE), [`NOTICE`](NOTICE)).

## Use it without downloading anything

A free API and MCP server serve this data. No key is needed, and the limit is 10 requests per 10 seconds.

```bash
curl 'https://recipes.airon.app/v1/recipes?q=pierogi&lang=en&limit=3'
claude mcp add --transport http recipes https://recipes.airon.app/mcp
```

[`api/README.md`](api/README.md) has every endpoint and parameter, the MCP tools, client configs and limits.

## Host your own API

The API lives in this repository and serves the data next to it, so a clone is all you need. It runs on Cloudflare's
free plan (Workers, D1, R2).

- **With an AI coding assistant:** open this repository and ask it to *deploy `api/` to my Cloudflare account,
  following `api/README.md`*.
- **By hand:**
  1. In `api/corpus.config.json`, set `name`, and set `domain` to your own hostname (or `null` for the
     `workers.dev` URL).
  2. Run:

     ```bash
     cd api
     npm install
     npx wrangler login
     npm run deploy
     ```

  The deploy creates and loads a D1 database, uploads any photos to R2, and deploys the Worker.
  [`api/README.md`](api/README.md) § "Host your own" covers every config key, changing the limit, loading a new
  release and rolling back.

## The data

| File | One line per | Holds |
|---|---|---|
| `data/recipes.jsonl` | recipe | `id`, `source_lang`, `servings`, `time_min` (`prep`, `cook`), `category`, `dish_type`, `cuisine`, `tags`, `allergens`, `canon_qid` (Wikidata), `ingredients` (`qty`, `unit`), `step_count`, `provenance` |
| `data/text/<lang>.jsonl` | recipe in that language | `id`, `name`, `summary`, `ingredients` (`name`, `note`), `steps`, and `machine_translated` with `translated_from` for translated text |
| `data/sources.json` | (one array) | each source: site, licence, credit line |
| `manifest.json` | (one object) | the data licence, the corpus revision it was built from, and counts |
| `ai-images/<dish>/1.webp` + `1.json` | dish | an AI-generated illustration with `dish`, `qid`, `ai_generated: true` and `license: CC0-1.0`. The API matches it to recipes by Wikidata QID or exact dish name. |
| `photos/<recipe id>/` | recipe | contributed photos with their author and licence ([`CONTRIBUTING.md`](CONTRIBUTING.md)) |

- **Ingredients line up by position.** `recipes.jsonl` holds the amounts, and each text file holds the names in its
  language.
- **Units** are `g`, `kg`, `ml`, `l`, `pcs`, `tsp`, `tbsp`, `pinch`, `clove`, `slice`, `bunch` and `to_taste`.
  Unknown values are `null`.
- **`provenance`** has what you need to attribute a recipe: `source`, `title`, `url`, `revision`, `history_url`,
  `attribution` (the credit line), `source_license`, `license` and `changes`. Recipes from public-domain books also
  have `based_on` and `adaptation_notes`. See [`ATTRIBUTION.md`](ATTRIBUTION.md).

## Contributing

Photos of dishes cooked from these recipes, corrections, and API improvements are all welcome. See
[`CONTRIBUTING.md`](CONTRIBUTING.md). Once a pull request of yours has merged, you can have an API key with a 10×
higher limit.
