# Changelog

## 1.4.0

Text tool. A paint tool that stamps text onto a texture using the pack's own bitmap
fonts, read from its `font/*.json` providers and falling back to the vanilla layout.
Glyph cells are measured for their advance widths and the drop shadow matches
Minecraft's. Live preview at texture resolution, drag to position. Also reachable
through Image > Insert Text…

Broken JSON is no longer a dead end. When control characters inside a string are the
cause, the error box offers "Repair and save"; otherwise it can jump the cursor to the
reported position. Tab now inserts four spaces in JSON files instead of a literal tab.

## 1.3.0

Text editor for `pack.mcmeta`, `.txt`, `.properties`, shaders and everything else
Blockbench can't open on its own. Saves in place via the button or Ctrl+S, and JSON is
validated live so invalid JSON never gets written.

JSON that isn't a model (blockstates, item definitions, atlases) and JSON that fails to
parse now open in the text editor instead of an error box.

Opening a pack always opens its project, so the panel can't end up hidden behind the
start screen.

## 1.2.0

Opening a pack now opens `pack.png` as a project, so the panel is actually visible.

## 1.1.0

Packs can be opened straight from `.zip`. The pack root is found even when
`pack.mcmeta` sits a folder deeper, and the archive is extracted so textures can be
written back.

## 1.0.0

First release. Panel with file tree, breadcrumbs, full-text search, PNG thumbnails,
texture painting with save-in-place, model viewing, and zip export.
