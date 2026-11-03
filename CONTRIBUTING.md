# Contributing

## A photo of a dish

Cook a recipe, photograph the result, and add it to `photos/`:

```
photos/<recipe id, with ":" as "-">/1.jpg      (or .webp, .png)
photos/<recipe id, with ":" as "-">/1.json
```

`1.json` states who took the photo and its licence:

```json
{ "author": "Your Name", "license": "CC-BY-4.0", "source_url": "https://… (optional)" }
```

- **Licence:** one of `CC0-1.0`, `CC-BY-4.0`, `CC-BY-SA-4.0` or `public-domain`.
- **Only your own photo** of a dish made from that recipe. No stock photos, and no AI-generated images.
- Keep it under about 1 MB.
- **Example:** recipe `plwb:9356` goes in `photos/plwb-9356/`.

A contributed photo is served by the API ahead of any other image for that recipe, with your name and licence.
`ai-images/` and `ai-recipe-images/` hold the project's own AI-generated illustrations. Don't add to those folders: a
real photo goes in `photos/` and takes their place.

## A correction to a recipe

Open an issue with the recipe `id`, the language, and what is wrong: an amount, a unit, a step, a translation, or a
tag. The files in `data/` are regenerated for each release, so an edit made straight to them would be overwritten.
An issue gets the fix made where it lasts.

## The API

Pull requests to `api/` are welcome. Run the tests first:

```bash
cd api
npm install
npm test
```

## An API key with a higher limit

Once one of your pull requests has merged, you can have a key with 100 requests per 10 s instead of 10:

1. Run `node api/scripts/key.mjs gh-<your GitHub login>` and keep the key it prints to yourself.
2. Open a pull request that adds only its `config_entry` to `keys` in `api/corpus.config.json`. That entry holds the
   key's SHA-256, never the key.
3. A maintainer merges it, and your key works from the next deploy.

## Licence of contributions

What you contribute is licensed like the part it goes into: Apache-2.0 for code, CC BY-SA 4.0 for data, and the
licence you state for a photo.

The corpus is maintained by [Airon](https://airon.app/?utm_source=open-recipe-corpus).
