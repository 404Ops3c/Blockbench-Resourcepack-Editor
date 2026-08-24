# Resourcepack Editor

A [Blockbench](https://www.blockbench.net/) plugin for editing Minecraft: Java Edition
resource packs.

Blockbench opens single models and single images, but it has no idea what a resource
pack is. This adds one: point it at a `.zip` and you get the whole pack in a searchable
file tree. Click a texture to paint it, click a model to view it, click `pack.mcmeta`
to edit it, and export back to a `.zip` when you're done.

## What it does

* Opens a pack straight from `.zip`. The pack root is found even when `pack.mcmeta`
  sits one folder deeper inside the archive. Your original zip is not touched.
* File tree with breadcrumbs, paging, PNG thumbnails, and full-text search over the
  whole pack.
* Click a `.png` and it opens as an image project. Ctrl+S writes back into the file
  inside the pack, no export and re-import.
* Click a model `.json` and it opens in the normal 3D view.
* Text editor for everything Blockbench can't open itself: `pack.mcmeta`, `.txt`,
  `.properties`, `.lang`, shaders, blockstates, item definitions. Saves in place.
* JSON is checked while you type and a broken file is never written. If the problem is
  a control character inside a string (usually a stray tab) there's a one-click repair,
  otherwise it jumps the cursor to the error position.
* Text tool that stamps text onto a texture using the pack's own bitmap fonts, read
  from its `font/*.json` providers. Or any system font. Live preview, drag to position,
  Minecraft drop shadow.
* Export the whole folder back to a `.zip`.

## Requirements

Blockbench 5.0.0 or newer, desktop app. The web version has no file system access, so
the plugin doesn't run there.

## Installing

Copying the `.js` into the plugin folder does not work. Blockbench keeps its plugin
list in internal storage and ignores files that just show up in that folder. Do this
instead:

1. Download `resourcepack_editor.js`.
2. File > Plugins…
3. Click the `</>` icon to the right of the search bar (tooltip: Load Plugin from File).
4. Pick the file you downloaded.
5. Confirm the file system access prompt. The plugin needs it to read your pack, write
   textures back, and export the zip.

Dragging the file onto the Blockbench window works too.

To update, overwrite the file and use File > Plugins > Reload Plugins, or just restart.
File-loaded plugins are re-read from disk every time.

## Using it

The panel is called `Resource Pack` and sits on the right.

One thing that trips people up: with no project open, Blockbench shows its start screen
and hides both sidebars. The panel is there, you just can't see it. Open any project
first, or use File > Open Resource Pack (.zip)… which opens one for you.

`Open zip` extracts the pack into a folder next to the zip (`MyPack.zip` becomes
`MyPack/`) and opens it. The folder icon next to it opens a pack folder you already
extracted; pick the folder that has `pack.mcmeta` and `assets/` in it, not the one
above. Whatever you had open last comes back on the next start.

Clicking a png opens it for painting, a model json opens in 3D, anything else opens in
the text editor, and a folder navigates into it. The search box searches the whole pack
by path, so `oak` or `textures/item` both work.

### Text tool

Open a texture, switch to Paint mode at the top, pick the Text tool on the left, then
click where the text should go. The dialog previews at the texture's real size and you
can drag inside the preview to move the text. Sizes 1x to 4x map to the Minecraft sizes
8/16/24/32.

Insert stamps it onto the texture, Ctrl+S writes it back to disk. It's a single undo
step, so Ctrl+Z takes it back cleanly.

Image > Insert Text… does the same for whatever texture is already open.

### Export

The save icon in the panel toolbar repacks everything into a zip, with `pack.mcmeta`
at the top level where it belongs.

## Limitations

Java Edition only. Bedrock packs use `manifest.json` and get rejected with a message.

Zips are extracted instead of being kept in memory. That's deliberate: writing back
through Ctrl+S and showing thumbnails both need real paths on disk.

The text editor refuses files over 4 MB, because a textarea that size freezes, and
files with binary data in them.

Bitmap font metrics are measured, not guessed. Every glyph cell gets scanned for its
first and last non-transparent column, which is how Minecraft derives advance widths,
so spacing comes out right on HD fonts too.

## Credits

Made by 404opsec (Eot Labs).

Blockbench is by JannisX11. Minecraft is a trademark of Mojang Studios / Microsoft.
Neither is affiliated with this plugin.

## License

MIT, see [LICENSE](LICENSE).
