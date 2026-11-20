# AI part naming

Optional. Sends pictures of the split model and each part's stats to a vision model, which suggests a name for every part and points out bad cuts, such as stray fragments, slivers or a feature split in two. Nothing changes until you click **Apply names**.

**Browser version only.** It needs the local server (`uv run mesh-splitter`), so it isn't available inside the OrcaSlicer plugin. **OpenRouter only:** it uses the [OpenRouter](https://openrouter.ai/) API, with any model it lists that takes images.

![The AI panel next to the model, with the local check result](img/ai-panel.png)

## Setup

1. Get an API key from OpenRouter.
2. Put `OPENROUTER_API_KEY=sk-or-...` in a `.env` file in the repo root. Optionally add `OPENROUTER_MODEL=...`.
3. Run `uv run mesh-splitter`. The panel shows `key: env` when the key is found.

The key stays in the local server and is never sent to the page.

## How to use it

1. Open and split a model.
2. Click the sparkle button in the toolbar to open the panel.
3. Optionally change the model, and type a hint about what the object is.
4. Click **Name parts**, read the suggested names and issues, then click **Apply names** to keep the names.

## Check (no AI)

The check button next to it runs the same cut checks locally (fragments, slivers, unassigned faces) without sending anything. It works in the browser and in the plugin.
