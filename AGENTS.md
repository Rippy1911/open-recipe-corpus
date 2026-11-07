# For AI models working on this repository

You are welcome to translate recipes and to improve the code here, run by a person who opens the pull request. Read
[`WORK.md`](WORK.md) for what is needed and [`CONTRIBUTING.md`](CONTRIBUTING.md) for how. You need Node 22 and git;
nothing to install.

## Translating

1. Get your slice: `node tools/work.mjs translate <lang> --n 10 --json`. Each entry has the `file` to write, the
   `based_on` to copy, and the `source` text to translate. Check the open pull requests for `translate <lang>` and use
   `--offset` to avoid a slice someone has taken.
2. Write one file per recipe, in the format in [`contrib/README.md`](contrib/README.md).
3. Run `node tools/validate.mjs` until it reports 0 errors, and read its warnings.
4. Open a pull request titled `translate <lang>: <n> recipes`, with at most 25 recipes. In the body: the language,
   the recipe ids, your exact model id, and the last line of `validate`.

How to translate:

- Translate only the `source` text you were given. Keep the number and order of ingredients and steps. Keep every
  number, temperature, time and amount exactly. Add nothing, leave nothing out, and do not "improve" the recipe.
- Write as a cookbook in that language would today: the ingredient names a cook there uses, the usual cooking verbs.
  Where an ingredient has no common local name, keep the source name and explain it in `note`.
- `translator.model` is your **exact model id** (for example `claude-sonnet-5-5`). If you do not know it, ask the person
  running you; never guess. `translator.github` is that person's GitHub login.
- Do not translate into Polish or English: those come from the maintainers' pipeline.

## Never

- Write a new recipe, or add one you remember or found online. Recipes here come from sources whose licences allow it
  ([`SOURCES.md`](SOURCES.md)), or from people who cook them.
- Copy, paraphrase or look up text from a website or book that `SOURCES.md` does not list as in use, not even to check
  a translation.
- Add images. `photos/` is for real photographs taken by people; `ai-images/` and `ai-recipe-images/` are the
  maintainers'.
- Edit `data/`, `manifest.json`, `ai-images/` or `ai-recipe-images/`: they are regenerated for each release. Report a
  mistake as an issue instead.
- Commit secrets, tokens or keys. An API key goes into `api/corpus.config.json` only as its SHA-256.
- Merge your own pull request.

## Code

`tools/` (the work list and checks) and `api/` (the API and MCP server) are plain Node with no build step.
`node --test tools/*.test.mjs` and `cd api && npm install && npm test` must pass. Keep the tools free of dependencies.
