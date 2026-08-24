# Resourcepack Editor

A [Blockbench](https://www.blockbench.net/) plugin that turns Blockbench into a full
**Minecraft: Java Edition resource pack editor**.

Blockbench opens single models and single images. It has no way to open a resource pack.
This plugin adds one: point it at a `.zip` and the whole pack shows up in a searchable
file tree — click a texture to paint it, click a model to view it in 3D, click
`pack.mcmeta` to edit it, and export the whole thing back to a `.zip` when you are done.

---

## Features

| | |
|---|---|
| **Open a pack straight from `.zip`** | Finds the pack root automatically, even when `pack.mcmeta` sits one folder deeper inside the archive. Your original `.zip` is never modified. |
| **Searchable file tree** | Full-text search across every file in the pack, with breadcrumbs, paging and PNG thumbnails inline in the list. |
| **Paint textures in place** | Click any `.png` and it opens as a Blockbench image project. <kbd>Ctrl</kbd>+<kbd>S</kbd> writes straight back into the file inside the pack — no export, no re-import. |
| **Open models in 3D** | Click any model `.json` and it loads in the normal Blockbench model view. |
| **Built-in text editor** | `pack.mcmeta`, `.txt`, `.properties`, `.lang`, shaders, blockstates, item definitions — everything Blockbench itself cannot open gets a real editor with save-in-place via button or <kbd>Ctrl</kbd>+<kbd>S</kbd>. |
| **JSON safety net** | JSON is validated live while you type. A broken file is never written. When the cause is control characters inside a string (the classic stray tab), the editor offers a one-click repair; otherwise it jumps the cursor to the exact error position. |
| **Text tool** | A paint tool that stamps text onto any texture — using **the pack's own Minecraft bitmap fonts**, read from its `font/*.json` providers, or any system font. Live preview, drag to position, Minecraft-accurate drop shadow. |
| **Export to `.zip`** | Repacks the whole folder with `pack.mcmeta` correctly at the top level. |

---

## Requirements

- **Blockbench 5.0.0 or newer**
- The **desktop app** (the plugin needs file system access, so it does not run in the web version)

---

## Installation

The plugin is a single `.js` file. **Copying it into the plugin folder is not enough** —
Blockbench keeps its list of installed plugins in internal storage, so a file dropped into
that folder is simply ignored. Use one of the two supported ways below.

### The reliable way — the `</>` button

1. Download **[`resourcepack_editor.js`](resourcepack_editor.js)** from this repository.
2. Open Blockbench.
3. Go to **File → Plugins…**
4. In the plugin dialog, click the **`</>` icon** to the right of the search bar
   (its tooltip reads *Load Plugin from File*).
5. Pick the `resourcepack_editor.js` you downloaded.
6. Blockbench asks for **file system access** — this is required. The plugin reads your
   pack from disk, writes edited textures back, and exports the `.zip`.

### Alternative — drag and drop

Drag `resourcepack_editor.js` from your file manager onto the Blockbench window.

### Updating

Download the new file over the old one and use **File → Plugins → Reload Plugins**,
or just restart Blockbench. File-loaded plugins are re-read from disk every time.

---

## Getting started

### 1. Open your pack

The plugin lives in the **`Resource Pack` panel** on the right-hand side.

> **Important:** with no project open, Blockbench shows its start screen and **hides both
> sidebars**. The panel exists, but you cannot see it. If the panel seems to be missing,
> open any project first — or just use **File → Open Resource Pack (.zip)…**, which opens
> a project for you automatically.

Two ways in:

- **`Open zip`** — pick your pack `.zip`. It is extracted into a folder next to the zip
  (`MyPack.zip` → `MyPack/`) and opened. The original `.zip` is left untouched.
- **The folder icon** — open a pack folder you already extracted. Pick the folder that
  contains `pack.mcmeta` and `assets/` *directly*, not the folder above it.

The pack you had open last is restored the next time you start Blockbench.

### 2. Edit files

| Click on | What happens |
|---|---|
| a `.png` | Opens as an image project. Paint it, then <kbd>Ctrl</kbd>+<kbd>S</kbd> — it saves back into the pack. |
| a model `.json` | Opens in the 3D model view. |
| `pack.mcmeta`, `.txt`, `.properties`, blockstates, shaders … | Opens in the built-in text editor. |
| a folder | Navigates into it. Use the breadcrumbs or `..` to go back. |

Type in the search box to search the entire pack by path — for example `oak` or
`textures/item`.

### 3. Use the text tool

1. Open a texture (click any `.png`).
2. Switch Blockbench to **Paint** mode at the top.
3. Pick the **Text** tool from the tool bar on the left.
4. Click the texture where the text should go.

In the dialog you get a live preview at the texture's real size. **Drag inside the
preview** to move the text. Options: font (any bitmap font from the pack, or a system
font), size — `1x`–`4x` map to the Minecraft sizes 8/16/24/32 — colour, Minecraft drop
shadow, alignment, letter spacing and opacity.

Press **Insert** to stamp it onto the texture, then <kbd>Ctrl</kbd>+<kbd>S</kbd> to write
the texture back to disk. It is a single undo step, so <kbd>Ctrl</kbd>+<kbd>Z</kbd> takes
it back cleanly.

You can also reach it from **Image → Insert Text…** for the currently open texture.

### 4. Export

Click the **save icon** in the panel's tool bar to repack everything into a `.zip`.

---

## Notes and limitations

- **Java Edition only.** Bedrock packs use `manifest.json` instead of `pack.mcmeta` and
  are rejected with a clear message.
- **Zips are extracted, not edited in memory.** This is on purpose: writing back through
  <kbd>Ctrl</kbd>+<kbd>S</kbd> and showing thumbnails both need real absolute paths.
- **The text editor stops at 4 MB** per file so Blockbench does not freeze, and refuses
  files containing binary data.
- **Bitmap font metrics are measured, not guessed.** Every glyph cell is scanned for its
  first and last non-transparent column, which is how Minecraft derives advance widths —
  so spacing comes out right, including on HD fonts.

---

## Credits

Made by **404opsec** — *aka Opsec*, founder of **Eot Labs**.

Blockbench is by JannisX11 and is not affiliated with this plugin.
Minecraft is a trademark of Mojang Studios / Microsoft; this project is not affiliated
with either.

## License

[MIT](LICENSE) © 404opsec (Eot Labs)
