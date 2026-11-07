# Step pictures

A picture for each step lets someone follow a recipe without reading its language. That makes them the part of this
project that travels furthest, so they have to be right.

## Where things stand

- **150 AI pictures for 30 AI-written recipes** are in [`ai-recipe-images/`](../ai-recipe-images/): four steps and a
  card picture for each recipe. The recipes' text is not part of this dataset.
- **None yet for the recipes in `data/`.** They come next, a batch at a time, in the order the work list uses: recipes
  linked to a Wikidata dish first, then shorter recipes.

## What the first 30 taught us

All 30 used one scene: four bowls, a pot and a skillet, filmed from above, and four pictures per recipe. One scene keeps
the pictures consistent, but it does not fit every recipe:

- A recipe with ten ingredients had to put three or four things in each bowl. A recipe with four ingredients had
  bowls with nothing much to do.
- Cookware the recipe does not use stays in every picture (a pot next to an omelette), and cookware it does use is
  missing (a colander for draining pasta, a blender, an oven dish).
- Four pictures cannot follow a recipe with seven steps.

[`step-pictures-review.md`](step-pictures-review.md) lists what to check in each of the 30 sets.

## How the next ones are planned

1. **Plan the scene from the recipe, before any picture.**
   - One container for each thing the steps use on its own. Things the recipe always adds together may share one.
   - The cookware the steps use, and nothing else: pot, skillet, oven dish, tray, colander, blender, whisk, board.
   - One camera position, counter and light for the whole recipe.
2. **One picture per step.** A step that changes nothing you could see may share a picture with the step before or
   after it. Each picture says which steps it shows.
3. **Keep the scene continuous.** The same containers and cookware stay in the same places in every picture. An
   ingredient that has been used is gone from its container. Food changes only as the step says: raw, then browned,
   then simmering.
4. **Show the step, nothing more.** Amounts look right for the servings. No text, labels, logos or brands. No hands
   unless the step needs them.

## Review checklist

Every picture is checked against the scene plan and the step before it ships:

- [ ] The containers match the plan in number and contents.
- [ ] Only the planned cookware is there, and the cookware the step needs is.
- [ ] Nothing used up earlier is back, and nothing appears before its step.
- [ ] The food looks like the step says (raw, browned, drained, simmering, plated).
- [ ] No AI artefacts: merged objects, impossible shapes, text, extra fingers.

A picture that fails is made again, and so is every picture after it that depends on it.

## Labels and licence

Like every AI image here: CC0 1.0, marked as AI-generated in its `.json` sidecar and in its embedded metadata (IPTC
digital source type `trainedAlgorithmicMedia`), and never presented as a photograph. The sidecar names the recipe and
the steps a picture shows, and nothing about how it was made.

## Who makes them

The maintainers make the AI step pictures in batches, under the image rules this project keeps (no copied or
look-alike images, every picture checked). The step pictures for the recipes in `data/` will get a folder of their own,
one per recipe; its layout is fixed with the first batch.

If you photograph the steps as you cook a recipe, real photos are welcome: open an issue and we will set up the folder
with you.
