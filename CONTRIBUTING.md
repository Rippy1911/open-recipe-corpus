# Contributing

Everything here can be done by a person, and translations also by an AI model run by a person
([`AGENTS.md`](AGENTS.md)). [`WORK.md`](WORK.md) lists what is needed most. You need git, and Node 22 to run the
checks; nothing to install.
Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md).

Before you open a pull request:

```bash
node tools/validate.mjs
node --test tools/*.test.mjs
```

## Translate

Translate recipes into a language that does not have them yet: any language except Polish and English, which come
from the maintainers' pipeline.

1. `node tools/work.mjs translate <lang> --n 10` lists the next recipes for your language. `--json` gives their text,
   the file to write and the `based_on` to copy. `--offset 50` takes a different slice, if someone else is working on
   the same language.
2. Write each one to `contrib/translations/<lang>/<recipe id, ":" as "-">.json`. [`contrib/README.md`](contrib/README.md)
   has the format.
3. Open a pull request titled `translate <lang>: <how many> recipes`. Up to 25 recipes per pull request keeps the
   review easy. Open it as a draft early to show which recipes you have taken.

A maintainer checks each translation and adds it to the next release in your language. Your GitHub login is credited
with it.

## Photo

Cook a recipe, photograph the result, and add it to `photos/`:

```
photos/<recipe id, with ":" as "-">/1.jpg      (or .webp, .png)
photos/<recipe id, with ":" as "-">/1.json
```

`1.json` states who took the photo and its licence:

```json
{ "author": "Your Name", "license": "CC-BY-4.0", "ai_generated": false, "source_url": "https://… (optional)" }
```

- **Licence:** one of `CC0-1.0`, `CC-BY-4.0`, `CC-BY-SA-4.0` or `public-domain`.
- **Only your own photo** of a dish made from that recipe. No stock photos, and no AI-generated images.
- **No location:** phones store where a photo was taken. Remove it before you add the photo (the check refuses a JPEG
  that still has it): `exiftool -gps:all= photo.jpg`, or export the photo without location.
- Keep it under about 1 MB.
- **Example:** recipe `plwb:9356` goes in `photos/plwb-9356/`.

`node tools/work.mjs photos` lists recipes that have no picture at all. A contributed photo is served ahead of any
other image for its recipe, with your name and licence. `ai-images/` and `ai-recipe-images/` hold the project's own
AI-generated illustrations. Don't add to those folders: a real photo goes in `photos/` and takes their place.

## Share a recipe

Open a [**Share a recipe**](https://github.com/Rippy1911/open-recipe-corpus/issues/new?template=share-a-recipe.yml) issue, in any language. It can be:

- **your own recipe**, one you cook, which you agree to license under CC BY-SA 4.0; or
- **a recipe from a source that allows it**, such as a public-domain cookbook. [`SOURCES.md`](SOURCES.md) lists which
  sources do.

Not a recipe copied from a website, a book still in copyright, or written by an AI model. A maintainer structures it
like the others, runs the same checks, and adds it to a release with your credit.

## Report a mistake

Open a [**Report a mistake**](https://github.com/Rippy1911/open-recipe-corpus/issues/new?template=report-a-mistake.yml) issue with the recipe `id`, the language,
and what is wrong: an amount, a unit, a step, a translation, or a tag. The files in `data/` are regenerated for each
release, so an edit made straight to them would be overwritten. An issue gets the fix made where it lasts.

## Propose a source

Know a cookbook or recipe collection that can be shared? Open a
[**Propose a source**](https://github.com/Rippy1911/open-recipe-corpus/issues/new?template=propose-a-source.yml) issue. [`SOURCES.md`](SOURCES.md) says what a
source needs (a licence that allows sharing and changing, or the public domain in both the US and its own country) and
how a source is harvested.

## The API and the tools

Pull requests to `api/` and `tools/` are welcome. Run the tests first:

```bash
node --test tools/*.test.mjs
cd api && npm install && npm test
```

## An API key with a higher limit

Once one of your pull requests has merged, you can have a key with 100 requests per 10 s instead of 10:

1. Run `node api/scripts/key.mjs gh-<your GitHub login>` and keep the key it prints to yourself.
2. Open a pull request that adds only its `config_entry` to `keys` in `api/corpus.config.json`. That entry holds the
   key's SHA-256, never the key.
3. A maintainer merges it, and your key works from the next deploy.

## Licence of contributions

What you contribute is licensed like the part it goes into: Apache-2.0 for code, CC BY-SA 4.0 for recipes and
translations (credited to you), and the licence you state for a photo.

The corpus is maintained by [Airon](https://airon.app/?utm_source=open-recipe-corpus).
