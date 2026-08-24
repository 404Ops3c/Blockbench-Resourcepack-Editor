(function () {
  const ID = "resourcepack_editor"
  const STORE_KEY = "resourcepack_editor.last_pack"
  const UNPACK_BATCH = 24

  let fs, panel, css, actionOpen, actionOpenZip, panelVue, toolText, actionText

  // json is tried as a model first, everything else lands in the text editor
  const IMAGE_EXT = ["png", "tga"]
  // a textarea starts freezing above this
  const MAX_TEXT_BYTES = 4 * 1024 * 1024

  const IGNORED_DIRS = new Set([".git", "node_modules", "__MACOSX"])

  // fallback layout for packs without font/*.json, same grid as vanilla
  // ascii.png (16x16, cp437 further down). "\0" = unused cell.
  const FONT_ROWS = [
    "ÀÁÂÈÊËÍÓÔÕÚßãõğİ",
    "ıŒœŞşŴŵžȇ\0\0\0\0\0\0\0",
    " !\"#$%&'()*+,-./",
    "0123456789:;<=>?",
    "@ABCDEFGHIJKLMNO",
    "PQRSTUVWXYZ[\\]^_",
    "`abcdefghijklmno",
    "pqrstuvwxyz{|}~\0",
    "ÇüéâäàåçêëèïîìÄÅ",
    "ÉæÆôöòûùÿÖÜø£Ø×ƒ",
    "áíóúñÑªº¿®¬½¼¡«»",
    "░▒▓│┤╡╢╖╕╣║╗╝╜╛┐",
    "└┴┬├─┼╞╟╚╔╩╦╠═╬╧",
    "╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀",
    "αβΓπΣσμτΦΘΩδ∞∅∈∩",
    "≡±≥≤⌠⌡÷≈°∙·√ⁿ²■\0"
  ]
  const SYSTEM_FONTS = ["monospace", "sans-serif", "serif", "Assistant", "Montserrat"]
  // font pixels: glyph is 8 tall, a line is 9
  const EM = 8
  const LINE = 9

  const atlas_cache = {}

  // "minecraft:font/ascii.png" -> assets/minecraft/textures/font/ascii.png
  function resolveFontRef(ref, assets) {
    const raw = String(ref)
    const i = raw.indexOf(":")
    const ns = i === -1 ? "minecraft" : raw.slice(0, i)
    const rest = i === -1 ? raw : raw.slice(i + 1)
    if (rest.includes("..")) return null
    return PathModule.join(assets, ns, "textures", ...rest.split("/"))
  }

  // every bitmap font in the open pack, layout from its own font/*.json
  function listPackFonts() {
    const root = panelVue && panelVue.root
    if (!root) return []
    const assets = PathModule.join(root, "assets")
    let namespaces
    try {
      namespaces = fs
        .readdirSync(assets, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
    } catch (err) {
      return []
    }

    const meta = {}
    for (const ns of namespaces) {
      const fontdir = PathModule.join(assets, ns, "font")
      let files
      try {
        files = fs.readdirSync(fontdir).filter((n) => n.toLowerCase().endsWith(".json"))
      } catch (err) {
        continue
      }
      for (const file of files) {
        let json
        try {
          json = JSON.parse(fs.readFileSync(PathModule.join(fontdir, file), "utf8"))
        } catch (err) {
          continue
        }
        const providers = json && Array.isArray(json.providers) ? json.providers : []
        // the space provider carries the width of the space char (4 in vanilla)
        const advances = {}
        for (const p of providers) {
          if (p && p.type === "space" && p.advances) Object.assign(advances, p.advances)
        }
        for (const p of providers) {
          if (!p || p.type !== "bitmap" || !p.file || !Array.isArray(p.chars)) continue
          const abs = resolveFontRef(p.file, assets)
          if (!abs) continue
          meta[abs] = { chars: p.chars, advances, height: p.height || EM }
        }
      }
    }

    const seen = new Set()
    const out = []
    const add = (abs, ns, name) => {
      if (seen.has(abs) || !fs.existsSync(abs)) return
      seen.add(abs)
      const m = meta[abs]
      out.push({
        id: abs,
        label: ns + ":" + name,
        png: abs,
        chars: (m && m.chars) || FONT_ROWS,
        advances: (m && m.advances) || { " ": 4 },
        height: (m && m.height) || EM,
        known: !!m
      })
    }
    for (const ns of namespaces) {
      const texdir = PathModule.join(assets, ns, "textures", "font")
      let files
      try {
        files = fs.readdirSync(texdir)
      } catch (err) {
        continue
      }
      for (const name of files) {
        if (!name.toLowerCase().endsWith(".png")) continue
        add(PathModule.join(texdir, name), ns, name.replace(/\.png$/i, ""))
      }
    }
    // fonts whose json points somewhere outside textures/font
    for (const abs of Object.keys(meta)) add(abs, "pack", PathModule.basename(abs).replace(/\.png$/i, ""))
    out.sort((a, b) => a.label.localeCompare(b.label))
    return out
  }

  // measures every cell: first and last column that is not fully transparent.
  // that gives the advance width, same way mc does it.
  function loadAtlas(entry) {
    if (atlas_cache[entry.png]) return Promise.resolve(atlas_cache[entry.png])
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => {
        try {
          let rows = Math.max(1, entry.chars.length)
          // some packs have a trailing empty line in chars, then the height
          // doesn't divide and every glyph sits wrong. so recount.
          if (img.naturalHeight % rows !== 0) {
            const cw = img.naturalWidth / 16
            const square = cw > 0 ? img.naturalHeight / cw : 0
            if (square >= 1 && Number.isInteger(square) && square <= rows) {
              rows = square
            } else {
              while (rows > 1 && img.naturalHeight % rows !== 0) rows--
            }
          }
          const cell_w = img.naturalWidth / 16
          const cell_h = img.naturalHeight / rows
          if (!cell_w || !cell_h) throw new Error("Font PNG has an unusable size")

          const c = document.createElement("canvas")
          c.width = img.naturalWidth
          c.height = img.naturalHeight
          const cx = c.getContext("2d")
          cx.drawImage(img, 0, 0)
          const data = cx.getImageData(0, 0, c.width, c.height).data

          const glyphs = {}
          for (let row = 0; row < rows; row++) {
            const line = Array.from(entry.chars[row] || "")
            for (let col = 0; col < 16; col++) {
              const ch = line[col]
              if (!ch || ch === "\0") continue
              const x0 = Math.floor(col * cell_w)
              const y0 = Math.floor(row * cell_h)
              let left = -1
              let right = -1
              for (let x = 0; x < cell_w; x++) {
                let filled = false
                for (let y = 0; y < cell_h; y++) {
                  if (data[((y0 + y) * c.width + (x0 + x)) * 4 + 3] > 0) {
                    filled = true
                    break
                  }
                }
                if (filled) {
                  if (left === -1) left = x
                  right = x
                }
              }
              glyphs[ch] = { col, row, left, right }
            }
          }
          const atlas = { img, cell_w, cell_h, rows, glyphs }
          atlas_cache[entry.png] = atlas
          resolve(atlas)
        } catch (err) {
          reject(err)
        }
      }
      img.onerror = () => reject(new Error("Font PNG could not be read: " + entry.png))
      img.src = entry.png
    })
  }

  // advance width in font pixels
  function advanceOf(ch, atlas, entry) {
    if (ch === " " || !atlas.glyphs[ch]) {
      const a = entry.advances && entry.advances[ch]
      return typeof a === "number" ? a : ch === " " ? 4 : 0
    }
    const g = atlas.glyphs[ch]
    if (g.right < 0) {
      const a = entry.advances && entry.advances[ch]
      return typeof a === "number" ? a : 4
    }
    return Math.round((g.right + 1) * (EM / atlas.cell_w)) + 1
  }

  function tintCanvas(canvas, color) {
    const ctx = canvas.getContext("2d")
    ctx.save()
    ctx.globalCompositeOperation = "source-in"
    ctx.fillStyle = color
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.restore()
  }

  function darken(hex) {
    // mc drop shadow colour is (c & 0xFCFCFC) >> 2
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex))
    if (!m) return "#3f3f3f"
    const n = parseInt(m[1], 16)
    const v = (n & 0xfcfcfc) >> 2
    return "#" + v.toString(16).padStart(6, "0")
  }

  function thresholdAlpha(canvas) {
    const ctx = canvas.getContext("2d")
    const d = ctx.getImageData(0, 0, canvas.width, canvas.height)
    for (let i = 3; i < d.data.length; i += 4) d.data[i] = d.data[i] >= 128 ? 255 : 0
    ctx.putImageData(d, 0, 0)
  }

  // bare letter shape, white on transparent. colour and shadow come later.
  function buildMask(opts) {
    const lines = String(opts.text).split("\n")
    const canvas = document.createElement("canvas")

    if (opts.mode === "bitmap") {
      const atlas = opts.atlas
      const entry = opts.entry
      const s = opts.size / EM
      const widths = lines.map((line) =>
        Array.from(line).reduce((sum, ch) => sum + advanceOf(ch, atlas, entry) + opts.spacing, 0)
      )
      const w = Math.max(1, Math.ceil(Math.max(...widths, 1) * s))
      const h = Math.max(1, Math.ceil((lines.length * LINE - (LINE - EM)) * s))
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext("2d")
      ctx.imageSmoothingEnabled = false

      const cell_font_w = atlas.cell_w * (EM / atlas.cell_h)
      lines.forEach((line, li) => {
        let pen = 0
        const total = widths[li]
        if (opts.align === "center") pen = (Math.max(...widths, 1) - total) / 2
        if (opts.align === "right") pen = Math.max(...widths, 1) - total
        const top = li * LINE * s
        for (const ch of Array.from(line)) {
          const g = atlas.glyphs[ch]
          if (g && g.right >= 0) {
            ctx.drawImage(
              atlas.img,
              g.col * atlas.cell_w,
              g.row * atlas.cell_h,
              atlas.cell_w,
              atlas.cell_h,
              Math.round(pen * s),
              Math.round(top),
              Math.round(cell_font_w * s),
              Math.round(EM * s)
            )
          }
          pen += advanceOf(ch, atlas, entry) + opts.spacing
        }
      })
      return canvas
    }

    // system font
    const font =
      (opts.italic ? "italic " : "") + (opts.bold ? "bold " : "") + opts.size + "px " + opts.family
    const probe = document.createElement("canvas").getContext("2d")
    probe.font = font
    const widths = lines.map((line) => probe.measureText(line).width + opts.spacing * line.length)
    const line_h = Math.ceil(opts.size * 1.25)
    canvas.width = Math.max(1, Math.ceil(Math.max(...widths, 1)))
    canvas.height = Math.max(1, lines.length * line_h)
    const ctx = canvas.getContext("2d")
    ctx.font = font
    ctx.textBaseline = "top"
    ctx.fillStyle = "#ffffff"
    lines.forEach((line, li) => {
      let x = 0
      if (opts.align === "center") x = (canvas.width - widths[li]) / 2
      if (opts.align === "right") x = canvas.width - widths[li]
      if (opts.spacing) {
        // canvas has no letter spacing, so draw char by char
        for (const ch of Array.from(line)) {
          ctx.fillText(ch, x, li * line_h)
          x += ctx.measureText(ch).width + opts.spacing
        }
      } else {
        ctx.fillText(line, x, li * line_h)
      }
    })
    if (opts.crisp) thresholdAlpha(canvas)
    return canvas
  }

  function buildStamp(opts) {
    const mask = buildMask(opts)
    if (opts.tint) tintCanvas(mask, opts.color)
    if (!opts.shadow) return mask

    const off = Math.max(1, Math.round(opts.mode === "bitmap" ? opts.size / EM : opts.size / 10))
    const shadow = document.createElement("canvas")
    shadow.width = mask.width
    shadow.height = mask.height
    const sx = shadow.getContext("2d")
    sx.imageSmoothingEnabled = false
    sx.drawImage(mask, 0, 0)
    tintCanvas(shadow, darken(opts.tint ? opts.color : "#ffffff"))

    const out = document.createElement("canvas")
    out.width = mask.width + off
    out.height = mask.height + off
    const ox = out.getContext("2d")
    ox.imageSmoothingEnabled = false
    ox.drawImage(shadow, off, off)
    ox.drawImage(mask, 0, 0)
    return out
  }

  function currentColor() {
    try {
      const v = ColorPanel.get()
      if (typeof v === "string" && /^#?[0-9a-f]{6}/i.test(v)) return v.startsWith("#") ? v.slice(0, 7) : "#" + v.slice(0, 6)
      if (v && typeof v.toHexString === "function") return v.toHexString()
    } catch (err) {
      /* no colour panel, white it is */
    }
    return "#ffffff"
  }

  // control chars in a string are illegal json, but mc's own parser eats them
  // anyway. escape them inside strings only, leave the rest alone.
  function escapeControlChars(src) {
    let out = ""
    let in_string = false
    let escaped = false
    for (const ch of String(src)) {
      if (escaped) {
        out += ch
        escaped = false
        continue
      }
      if (in_string) {
        if (ch === "\\") {
          out += ch
          escaped = true
          continue
        }
        if (ch === '"') {
          in_string = false
          out += ch
          continue
        }
        const code = ch.charCodeAt(0)
        if (code < 0x20) {
          out +=
            ch === "\n" ? "\\n" : ch === "\t" ? "\\t" : ch === "\r" ? "\\r"
              : "\\u" + code.toString(16).padStart(4, "0")
          continue
        }
        out += ch
        continue
      }
      if (ch === '"') in_string = true
      out += ch
    }
    return out
  }

  function jsonOk(text) {
    try {
      JSON.parse(text)
      return true
    } catch (err) {
      return false
    }
  }

  function textureSize(texture) {
    const w = texture.width || (texture.canvas && texture.canvas.width) || (texture.img && texture.img.naturalWidth)
    const h = texture.height || (texture.canvas && texture.canvas.height) || (texture.img && texture.img.naturalHeight)
    return [w || 16, h || 16]
  }

  // x/y is the pixel that was clicked
  function openTextDialog(texture, x, y) {
    if (!texture) {
      Blockbench.showMessageBox({
        title: "No texture",
        message:
          "No texture is open. Click a `.png` in the **Resource Pack** panel, " +
          "then switch to **Paint** mode at the top.",
        icon: "error"
      })
      return
    }
    const [tw, th] = textureSize(texture)
    const fonts = listPackFonts()
    const start = fonts.length ? "atlas:0" : "sys:monospace"

    const dialog = new Dialog("resourcepack_editor_text_dialog", {
      title: "Insert text",
      width: 760,
      resizable: true,
      buttons: ["Insert", "Cancel"],
      confirmIndex: 0,
      cancelIndex: 1,
      onConfirm() {
        const vue = dialog.content_vue
        if (!vue) return false
        return vue.apply()
      },
      component: {
        data() {
          return {
            text: "Text",
            font: start,
            fonts,
            system_fonts: SYSTEM_FONTS,
            family: "monospace",
            size: fonts.length ? 8 : 16,
            color: currentColor(),
            tint: true,
            shadow: false,
            bold: false,
            italic: false,
            crisp: true,
            spacing: 0,
            opacity: 100,
            align: "left",
            x: Math.round(x || 0),
            y: Math.round(y || 0),
            tw,
            th,
            atlas: null,
            error: "",
            stamp_size: [0, 0]
          }
        },
        computed: {
          bitmap() {
            return this.font.startsWith("atlas:")
          },
          entry() {
            if (!this.bitmap) return null
            return this.fonts[parseInt(this.font.slice(6), 10)] || null
          }
        },
        watch: {
          font() {
            this.loadFont()
          },
          text() { this.draw() },
          size() { this.draw() },
          color() { this.draw() },
          tint() { this.draw() },
          shadow() { this.draw() },
          bold() { this.draw() },
          italic() { this.draw() },
          crisp() { this.draw() },
          spacing() { this.draw() },
          opacity() { this.draw() },
          align() { this.draw() },
          family() { this.draw() },
          x() { this.draw() },
          y() { this.draw() }
        },
        methods: {
          options() {
            return {
              mode: this.bitmap ? "bitmap" : "system",
              atlas: this.atlas,
              entry: this.entry,
              text: this.text || "",
              size: Math.max(1, Math.min(512, Number(this.size) || 1)),
              color: this.color,
              tint: this.tint,
              shadow: this.shadow,
              bold: this.bold,
              italic: this.italic,
              crisp: this.crisp,
              spacing: Number(this.spacing) || 0,
              family: this.family,
              align: this.align
            }
          },
          // stamp sits by its top left corner, centre/right shifts it back
          origin(stamp) {
            let ox = Number(this.x) || 0
            if (this.align === "center") ox -= Math.round(stamp.width / 2)
            if (this.align === "right") ox -= stamp.width
            return [ox, Number(this.y) || 0]
          },
          makeStamp() {
            if (!this.text) return null
            if (this.bitmap && !this.atlas) return null
            try {
              const stamp = buildStamp(this.options())
              this.error = ""
              return stamp
            } catch (err) {
              console.error(err)
              this.error = String((err && err.message) || err)
              return null
            }
          },
          loadFont() {
            const entry = this.entry
            if (!entry) {
              this.atlas = null
              if (this.font.startsWith("sys:")) this.family = this.font.slice(4)
              this.$nextTick(() => this.draw())
              return
            }
            loadAtlas(entry)
              .then((atlas) => {
                this.atlas = atlas
                this.error = ""
                this.draw()
              })
              .catch((err) => {
                this.atlas = null
                this.error = String((err && err.message) || err)
                this.draw()
              })
          },
          draw() {
            const canvas = this.$refs.preview
            if (!canvas) return
            const ctx = canvas.getContext("2d")
            ctx.imageSmoothingEnabled = false
            ctx.clearRect(0, 0, canvas.width, canvas.height)
            // checkerboard so transparency stays visible
            const step = Math.max(2, Math.round(Math.max(this.tw, this.th) / 16))
            for (let gy = 0; gy < this.th; gy += step) {
              for (let gx = 0; gx < this.tw; gx += step) {
                ctx.fillStyle = ((gx / step + gy / step) | 0) % 2 ? "#3a3a3a" : "#2e2e2e"
                ctx.fillRect(gx, gy, step, step)
              }
            }
            const src = texture.canvas && texture.canvas.width ? texture.canvas : texture.img
            if (src) {
              try {
                ctx.drawImage(src, 0, 0, this.tw, this.th)
              } catch (err) {
                /* not loaded yet, redraws on the next keystroke */
              }
            }
            const stamp = this.makeStamp()
            if (!stamp) {
              this.stamp_size = [0, 0]
              return
            }
            this.stamp_size = [stamp.width, stamp.height]
            const [ox, oy] = this.origin(stamp)
            ctx.save()
            ctx.globalAlpha = Math.max(0, Math.min(100, Number(this.opacity) || 0)) / 100
            ctx.drawImage(stamp, ox, oy)
            ctx.restore()
            ctx.save()
            ctx.strokeStyle = "#58a6ff"
            ctx.lineWidth = 1
            ctx.setLineDash([2, 2])
            ctx.strokeRect(ox + 0.5, oy + 0.5, stamp.width - 1, stamp.height - 1)
            ctx.restore()
          },
          drag(event) {
            const canvas = this.$refs.preview
            if (!canvas) return
            const move = (e) => {
              const rect = canvas.getBoundingClientRect()
              this.x = Math.round(((e.clientX - rect.left) / rect.width) * this.tw)
              this.y = Math.round(((e.clientY - rect.top) / rect.height) * this.th)
            }
            const stop = () => {
              document.removeEventListener("pointermove", move)
              document.removeEventListener("pointerup", stop)
            }
            move(event)
            document.addEventListener("pointermove", move)
            document.addEventListener("pointerup", stop)
          },
          apply() {
            const stamp = this.makeStamp()
            if (!stamp) {
              Blockbench.showMessageBox({
                title: "Nothing to insert",
                message: this.error
                  ? "The font could not be loaded:\n\n" + this.error
                  : "The text field is empty.",
                icon: "error"
              })
              return false
            }
            const [ox, oy] = this.origin(stamp)
            const alpha = Math.max(0, Math.min(100, Number(this.opacity) || 0)) / 100
            texture.edit(
              (canvas, info) => {
                const off = (info && info.offset) || [0, 0]
                const ctx = canvas.getContext("2d")
                ctx.save()
                ctx.imageSmoothingEnabled = false
                ctx.globalAlpha = alpha
                ctx.drawImage(stamp, ox - (off[0] || 0), oy - (off[1] || 0))
                ctx.restore()
              },
              { edit_name: "Insert text" }
            )
            Blockbench.showQuickMessage("Text inserted, Ctrl+S writes it into the file", 2500)
            return true
          }
        },
        mounted() {
          this.loadFont()
          this.$nextTick(() => this.draw())
        },
        template: `
          <div class="rpe_txt">
            <div class="rpe_txt_left">
              <div class="rpe_txt_preview">
                <canvas ref="preview" :width="tw" :height="th" @pointerdown="drag"></canvas>
              </div>
              <div class="rpe_txt_hint">
                {{ tw }} x {{ th }} px &middot; drag in the preview to place the text
                <template v-if="stamp_size[0]"> &middot; text {{ stamp_size[0] }} x {{ stamp_size[1] }} px</template>
              </div>
              <div class="rpe_txt_err" v-if="error">{{ error }}</div>
            </div>

            <div class="rpe_txt_right">
              <label>Text</label>
              <textarea v-model="text" rows="3" spellcheck="false" class="dark_bordered"></textarea>

              <label>Font</label>
              <select v-model="font" class="dark_bordered">
                <optgroup label="From the pack" v-if="fonts.length">
                  <option v-for="(f, i) in fonts" :value="'atlas:' + i">{{ f.label }}</option>
                </optgroup>
                <optgroup label="System font">
                  <option v-for="f in system_fonts" :value="'sys:' + f">{{ f }}</option>
                </optgroup>
              </select>
              <input v-if="!bitmap" type="text" class="dark_bordered" v-model="family"
                     placeholder="Custom font name">

              <div class="rpe_txt_row">
                <div>
                  <label>Size (px)</label>
                  <input type="number" class="dark_bordered" v-model.number="size" min="1" max="512">
                </div>
                <div>
                  <label>Colour</label>
                  <input type="color" v-model="color">
                </div>
              </div>

              <div class="rpe_txt_row" v-if="bitmap">
                <button v-for="n in [1,2,3,4]" @click="size = n*8">{{ n }}x</button>
              </div>

              <div class="rpe_txt_row">
                <div>
                  <label>X</label>
                  <input type="number" class="dark_bordered" v-model.number="x">
                </div>
                <div>
                  <label>Y</label>
                  <input type="number" class="dark_bordered" v-model.number="y">
                </div>
              </div>

              <div class="rpe_txt_row">
                <div>
                  <label>Alignment</label>
                  <select v-model="align" class="dark_bordered">
                    <option value="left">left</option>
                    <option value="center">centre</option>
                    <option value="right">right</option>
                  </select>
                </div>
                <div>
                  <label>Letter spacing</label>
                  <input type="number" class="dark_bordered" v-model.number="spacing" min="-4" max="16">
                </div>
              </div>

              <label>Opacity {{ opacity }}%</label>
              <input type="range" min="0" max="100" v-model.number="opacity">

              <label class="rpe_txt_check"><input type="checkbox" v-model="shadow"> Drop shadow (like in game)</label>
              <label class="rpe_txt_check"><input type="checkbox" v-model="tint"> Apply colour (off keeps the original colours)</label>
              <template v-if="!bitmap">
                <label class="rpe_txt_check"><input type="checkbox" v-model="bold"> Bold</label>
                <label class="rpe_txt_check"><input type="checkbox" v-model="italic"> Italic</label>
                <label class="rpe_txt_check"><input type="checkbox" v-model="crisp"> Hard edges (no anti-aliasing)</label>
              </template>
            </div>
          </div>
        `
      }
    })
    dialog.show()
  }

  Plugin.register(ID, {
    title: "Resourcepack Editor",
    icon: "inventory_2",
    author: "Eot Labs",
    description:
      "Opens a whole Java resource pack straight from the .zip, in a searchable " +
      "file tree. Paint textures with a click (Ctrl+S writes straight back into the " +
      "file), open models, edit text files like pack.mcmeta in the built-in editor, " +
      "and save the whole pack back out as a .zip. Comes with a text tool that stamps " +
      "text onto any texture, using the pack's own Minecraft bitmap fonts.",
    version: "1.4.0",
    min_version: "5.0.0",
    variant: "desktop",
    tags: ["Minecraft: Java Edition", "Resource Packs"],

    onload() {
      fs = require("fs", {
        message:
          "Needed to read your resource pack from disk, write edited textures back " +
          "into it, and export the pack as a .zip.",
        optional: false
      })
      if (!fs) throw new Error("Resourcepack Editor: file system access denied")

      css = Blockbench.addCSS(`
        .rpe { display:flex; flex-direction:column; height:100%; min-height:0; font-size:13px; }
        .rpe_bar { display:flex; gap:4px; padding:4px; flex-shrink:0; }
        .rpe_bar button {
          flex:1; display:flex; align-items:center; justify-content:center; gap:4px;
          height:28px; cursor:pointer; background:var(--color-button); color:var(--color-text);
          border:none; border-radius:3px; white-space:nowrap; overflow:hidden;
        }
        .rpe_bar button:hover:not(:disabled) { background:var(--color-accent); color:var(--color-accent_text); }
        .rpe_bar button:disabled { opacity:.4; cursor:default; }
        .rpe_bar button.rpe_icon_only { flex:0 0 30px; }
        .rpe_bar .material-icons { font-size:17px; }

        .rpe_busy {
          padding:10px 8px; text-align:center; color:var(--color-subtle_text);
          font-size:12px; flex-shrink:0;
        }

        .rpe_head { padding:2px 6px 4px; flex-shrink:0; border-bottom:1px solid var(--color-border); }
        .rpe_title { font-weight:bold; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .rpe_sub { color:var(--color-subtle_text); font-size:11px; }

        .rpe_search { display:flex; align-items:center; gap:4px; padding:4px; flex-shrink:0; }
        .rpe_search input { flex:1; min-width:0; }

        .rpe_crumbs {
          display:flex; flex-wrap:wrap; align-items:center; gap:2px;
          padding:2px 6px; flex-shrink:0; color:var(--color-subtle_text); font-size:11px;
        }
        .rpe_crumbs span { cursor:pointer; }
        .rpe_crumbs span:hover { color:var(--color-light); text-decoration:underline; }

        .rpe_list { flex:1; overflow-y:auto; overflow-x:hidden; min-height:0; }
        .rpe_row {
          display:flex; align-items:center; gap:6px; padding:2px 6px;
          cursor:pointer; height:26px; overflow:hidden;
        }
        .rpe_row:hover { background:var(--color-selected); }
        .rpe_row .material-icons { font-size:18px; flex-shrink:0; color:var(--color-subtle_text); }
        .rpe_thumb {
          width:18px; height:18px; flex-shrink:0; object-fit:contain;
          image-rendering:pixelated; background:var(--color-dark); border-radius:2px;
        }
        .rpe_name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; }
        .rpe_path { color:var(--color-subtle_text); font-size:10px; }
        .rpe_dim { color:var(--color-subtle_text); font-size:10px; flex-shrink:0; }

        .rpe_pager { display:flex; align-items:center; justify-content:center; gap:8px; padding:4px; flex-shrink:0; font-size:11px; }
        .rpe_pager button { cursor:pointer; background:var(--color-button); color:var(--color-text); border:none; border-radius:3px; padding:2px 8px; }
        .rpe_pager button:disabled { opacity:.4; cursor:default; }
        .rpe_empty { padding:14px 8px; text-align:center; color:var(--color-subtle_text); }

        .rpe_text { display:flex; flex-direction:column; gap:6px; }
        .rpe_text textarea {
          width:100%; height:58vh; min-height:200px; resize:vertical;
          font-family:var(--font-code, monospace); font-size:13px; line-height:1.45;
          white-space:pre; overflow:auto; tab-size:2; padding:6px;
          background:var(--color-back); color:var(--color-text);
          border:1px solid var(--color-border); border-radius:3px;
        }
        .rpe_text_info {
          display:flex; justify-content:space-between; align-items:baseline; gap:10px;
          font-size:11px; color:var(--color-subtle_text);
        }
        .rpe_text_info > span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .rpe_text_mid { flex:1; text-align:center; }
        .rpe_text_bad { color:var(--color-error, #ff5555); }
        .rpe_text_dirty { color:var(--color-accent, #58a6ff); }
        .rpe_text_jump { cursor:pointer; text-decoration:underline; }

        .rpe_txt { display:flex; gap:12px; align-items:flex-start; }
        .rpe_txt_left { flex:1; min-width:0; }
        .rpe_txt_right { width:280px; flex-shrink:0; display:flex; flex-direction:column; gap:2px; }
        .rpe_txt_right label { font-size:11px; color:var(--color-subtle_text); margin-top:5px; }
        .rpe_txt_right input[type=text], .rpe_txt_right input[type=number],
        .rpe_txt_right select, .rpe_txt_right textarea {
          width:100%; background:var(--color-back); color:var(--color-text);
          border:1px solid var(--color-border); border-radius:3px; padding:3px 5px;
        }
        .rpe_txt_right textarea { font-family:var(--font-code, monospace); resize:vertical; }
        .rpe_txt_right input[type=color] { width:100%; height:26px; padding:0; border:none; background:none; }
        .rpe_txt_row { display:flex; gap:6px; align-items:flex-end; }
        .rpe_txt_row > div { flex:1; min-width:0; }
        .rpe_txt_row button {
          flex:1; height:24px; cursor:pointer; margin-top:4px;
          background:var(--color-button); color:var(--color-text); border:none; border-radius:3px;
        }
        .rpe_txt_row button:hover { background:var(--color-accent); color:var(--color-accent_text); }
        .rpe_txt_check { display:flex; align-items:center; gap:5px; font-size:12px; color:var(--color-text); margin-top:5px; }
        .rpe_txt_check input { margin:0; }
        .rpe_txt_preview {
          display:flex; align-items:center; justify-content:center;
          background:var(--color-dark); border:1px solid var(--color-border);
          border-radius:3px; padding:6px; min-height:180px; max-height:60vh;
        }
        .rpe_txt_preview canvas {
          max-width:100%; max-height:56vh; image-rendering:pixelated; cursor:crosshair;
        }
        .rpe_txt_hint { font-size:11px; color:var(--color-subtle_text); padding-top:4px; }
        .rpe_txt_err { font-size:11px; color:var(--color-error, #ff5555); padding-top:4px; }
      `)

      panel = new Panel({
        id: "resourcepack_editor_panel",
        name: "Resource Pack",
        icon: "inventory_2",
        default_side: "right",
        default_position: { slot: "right_bar", height: 460 },
        expand_button: true,
        resizable: true,
        growable: true,
        min_height: 220,
        component: {
          name: "resourcepack-editor-panel",
          data() {
            return {
              root: "",
              info: null,
              cwd: [],
              entries: [],
              query: "",
              index: null,
              page: 0,
              per_page: 120,
              busy: false,
              status: "",
              zip_source: "",
              broken: {}
            }
          },
          computed: {
            searching() {
              return this.query.trim().length > 0
            },
            matches() {
              if (!this.searching || !this.index) return []
              const q = this.query.trim().toLowerCase()
              const out = []
              for (const e of this.index) {
                if (e.lower.includes(q)) {
                  out.push(e)
                  if (out.length > 4000) break
                }
              }
              return out
            },
            shown() {
              const list = this.searching ? this.matches : this.entries
              const start = this.page * this.per_page
              return list.slice(start, start + this.per_page)
            },
            total() {
              return (this.searching ? this.matches : this.entries).length
            },
            pages() {
              return Math.max(1, Math.ceil(this.total / this.per_page))
            }
          },
          watch: {
            query() {
              this.page = 0
            }
          },
          methods: {
            pickZip() {
              if (this.busy) return
              const opts = {
                resource_id: "resourcepack_editor_zip",
                extensions: ["zip"],
                type: "Resource Pack (.zip)",
                title: "Choose a resource pack .zip",
                readtype: "none"
              }
              if (this.zip_source) opts.startpath = this.zip_source
              Blockbench.import(opts, (files) => {
                if (files && files.length && files[0].path) {
                  this.openZip(files[0].path)
                }
              })
            },

            // with no project open blockbench hides both sidebars and the panel
            // is gone with them. so always open something, pack.png if there is one.
            openProject() {
              if (!this.root) return
              const icon = PathModule.join(this.root, "pack.png")
              try {
                if (fs.existsSync(icon)) {
                  // don't open a second tab for it
                  const open =
                    typeof ModelProject !== "undefined" && ModelProject.all
                      ? ModelProject.all.find((p) => p.export_path === icon)
                      : null
                  if (open) {
                    open.select()
                    return
                  }
                  Codecs.image.load([icon], icon)
                  return
                }
                // no pack.png: blank project only if nothing is open at all
                if (typeof Project !== "undefined" && Project) return
                newProject("image")
                if (typeof Project !== "undefined" && Project) {
                  Project.name = PathModule.basename(this.root)
                }
              } catch (err) {
                console.error(err)
              }
            },

            // message box as a promise, resolves to the button index
            ask(options) {
              return new Promise((resolve) => {
                Blockbench.showMessageBox(options, resolve)
              })
            },

            // pack.mcmeta may sit one level deeper ("Pack.zip/Pack/pack.mcmeta").
            // returns that prefix, or null.
            findPackRoot(zip) {
              let best = null
              zip.forEach((path, entry) => {
                if (entry.dir) return
                if (path.startsWith("__MACOSX/")) return
                const parts = path.split("/")
                if (parts[parts.length - 1] !== "pack.mcmeta") return
                const dirs = parts.slice(0, -1)
                const prefix = dirs.length ? dirs.join("/") + "/" : ""
                if (best === null || prefix.length < best.length) best = prefix
              })
              return best
            },

            // zip slip: nothing may escape the target folder
            safeRel(rel) {
              if (!rel || rel.startsWith("/") || rel.includes("\\")) return false
              return !rel.split("/").some((p) => p === "" || p === "." || p === "..")
            },

            folderNameFor(zipPath) {
              const base = PathModule.basename(zipPath).replace(/\.zip$/i, "")
              const clean = base
                .trim()
                .replace(/[^a-zA-Z0-9._-]+/g, "-")
                .replace(/^[-.]+|-+$/g, "")
              return clean || "pack"
            },

            async openZip(zipPath) {
              if (this.busy) return
              this.busy = true
              this.status = "Reading zip…"
              try {
                let zip
                try {
                  zip = await JSZip.loadAsync(fs.readFileSync(zipPath))
                } catch (err) {
                  console.error(err)
                  Blockbench.showMessageBox({
                    title: "Zip could not be read",
                    message:
                      "`" + PathModule.basename(zipPath) + "` could not be opened.\n\n" +
                      String(err),
                    icon: "error"
                  })
                  return
                }

                const prefix = this.findPackRoot(zip)
                if (prefix === null) {
                  Blockbench.showMessageBox({
                    title: "Not a resource pack",
                    message:
                      "There is no `pack.mcmeta` anywhere inside this zip.\n\n" +
                      "Either this is not a Java resource pack, or it is a Bedrock " +
                      "pack (`manifest.json` instead of `pack.mcmeta`).",
                    icon: "error"
                  })
                  return
                }

                const files = []
                zip.forEach((path, entry) => {
                  if (entry.dir) return
                  if (path.startsWith("__MACOSX/")) return
                  if (!path.startsWith(prefix)) return
                  const rel = path.slice(prefix.length)
                  const name = rel.split("/").pop()
                  if (name === ".DS_Store" || name.startsWith("._")) return
                  if (!this.safeRel(rel)) return
                  files.push({ rel, entry })
                })
                if (!files.length) {
                  Blockbench.showMessageBox({
                    title: "Zip is empty",
                    message: "There is not a single file below the pack root.",
                    icon: "error"
                  })
                  return
                }

                // extract next to the zip, blockbench needs real files on disk
                const target = PathModule.join(
                  PathModule.dirname(zipPath),
                  this.folderNameFor(zipPath)
                )

                if (fs.existsSync(target)) {
                  const choice = await this.ask({
                    title: "Folder already exists",
                    message:
                      "`" + target + "` already exists.\n\n" +
                      "**Extract again** overwrites it, any textures you already " +
                      "edited in there are lost. Your original .zip is never touched.",
                    icon: "warning",
                    buttons: ["Extract again", "Open existing", "Cancel"],
                    confirm: 0,
                    cancel: 2
                  })
                  if (choice === 1) {
                    if (this.load(target, zipPath)) this.openProject()
                    return
                  }
                  if (choice !== 0) return
                  fs.rmSync(target, { recursive: true, force: true })
                }

                fs.mkdirSync(target, { recursive: true })

                const made = new Set()
                let done = 0
                for (let i = 0; i < files.length; i += UNPACK_BATCH) {
                  const batch = files.slice(i, i + UNPACK_BATCH)
                  await Promise.all(
                    batch.map(async (f) => {
                      const abs = PathModule.join(target, f.rel)
                      const dir = PathModule.dirname(abs)
                      if (!made.has(dir)) {
                        fs.mkdirSync(dir, { recursive: true })
                        made.add(dir)
                      }
                      fs.writeFileSync(abs, await f.entry.async("uint8array"))
                    })
                  )
                  done += batch.length
                  this.status = "Extracting… " + done + " / " + files.length
                  Blockbench.setProgress(done / files.length)
                }

                if (this.load(target, zipPath)) this.openProject()
                Blockbench.showQuickMessage(
                  files.length + " files extracted to " + PathModule.basename(target),
                  3000
                )
              } catch (err) {
                console.error(err)
                Blockbench.showMessageBox({
                  title: "Extraction failed",
                  message: String(err),
                  icon: "error"
                })
              } finally {
                this.busy = false
                this.status = ""
                Blockbench.setProgress(0)
              }
            },

            pick() {
              const dir = Blockbench.pickDirectory({
                title: "Choose the resource pack folder (the one containing pack.mcmeta)",
                startpath: this.root || undefined
              })
              if (dir) {
                if (this.load(dir)) this.openProject()
              }
            },

            // true only if the pack really loaded
            load(dir, zip_source) {
              if (!fs.existsSync(dir)) {
                Blockbench.showQuickMessage("That folder no longer exists", 2000)
                return false
              }
              const mcmeta = PathModule.join(dir, "pack.mcmeta")
              if (!fs.existsSync(mcmeta)) {
                Blockbench.showMessageBox({
                  title: "Not a resource pack",
                  message:
                    "There is no `pack.mcmeta` in this folder.\n\n" +
                    "Pick the folder that has `pack.mcmeta` and `assets/` **directly** " +
                    "inside it, not the folder above that one.",
                  icon: "error"
                })
                return false
              }

              let info = { description: PathModule.basename(dir), format: "?" }
              try {
                const meta = JSON.parse(fs.readFileSync(mcmeta, "utf8"))
                const d = meta.pack && meta.pack.description
                info.description =
                  typeof d === "string" ? d : PathModule.basename(dir)
                info.format = (meta.pack && meta.pack.pack_format) ?? "?"
              } catch (err) {
                info.description = PathModule.basename(dir)
                info.format = "pack.mcmeta unreadable"
              }

              this.root = dir
              this.info = info
              this.zip_source = zip_source || ""
              this.cwd = []
              this.query = ""
              this.index = null
              this.page = 0
              this.broken = {}
              localStorage.setItem(STORE_KEY, dir)
              this.refresh()
              this.buildIndex()
              return true
            },

            abs(rel) {
              return PathModule.join(this.root, ...(rel || []))
            },

            refresh() {
              this.page = 0
              if (!this.root) {
                this.entries = []
                return
              }
              const dir = this.abs(this.cwd)
              let raw
              try {
                raw = fs.readdirSync(dir, { withFileTypes: true })
              } catch (err) {
                Blockbench.showQuickMessage("Folder could not be read", 2000)
                this.entries = []
                return
              }
              const out = []
              for (const d of raw) {
                if (d.isDirectory()) {
                  if (IGNORED_DIRS.has(d.name)) continue
                  out.push({ name: d.name, dir: true, rel: this.cwd.concat(d.name) })
                } else if (d.isFile()) {
                  out.push({
                    name: d.name,
                    dir: false,
                    rel: this.cwd.concat(d.name),
                    ext: d.name.split(".").pop().toLowerCase()
                  })
                }
              }
              out.sort((a, b) =>
                a.dir !== b.dir ? (a.dir ? -1 : 1) : a.name.localeCompare(b.name)
              )
              this.entries = out
            },

            buildIndex() {
              // index once, otherwise every keystroke hits the disk
              const index = []
              const walk = (parts) => {
                let raw
                try {
                  raw = fs.readdirSync(PathModule.join(this.root, ...parts), {
                    withFileTypes: true
                  })
                } catch (err) {
                  return
                }
                for (const d of raw) {
                  if (d.isDirectory()) {
                    if (IGNORED_DIRS.has(d.name)) continue
                    walk(parts.concat(d.name))
                  } else if (d.isFile()) {
                    const rel = parts.concat(d.name)
                    const joined = rel.join("/")
                    index.push({
                      name: d.name,
                      dir: false,
                      rel,
                      joined,
                      lower: joined.toLowerCase(),
                      ext: d.name.split(".").pop().toLowerCase()
                    })
                  }
                }
              }
              walk([])
              this.index = index
            },

            enter(entry) {
              this.query = ""
              this.cwd = entry.rel.slice()
              this.refresh()
            },

            goto(i) {
              this.query = ""
              this.cwd = this.cwd.slice(0, i)
              this.refresh()
            },

            up() {
              if (!this.cwd.length) return
              this.query = ""
              this.cwd.pop()
              this.refresh()
            },

            click(entry) {
              if (entry.dir) return this.enter(entry)
              this.open(entry)
            },

            open(entry) {
              const abs = this.abs(entry.rel)
              const ext = entry.ext

              if (IMAGE_EXT.includes(ext)) {
                // second arg sets Project.export_path, so Ctrl+S lands here
                Codecs.image.load([abs], abs)
                return
              }

              if (ext === "json") {
                let parsed
                try {
                  parsed = JSON.parse(fs.readFileSync(abs, "utf8"))
                } catch (err) {
                  // broken json goes to the text editor, it can be fixed there
                  Blockbench.showQuickMessage(
                    "Broken JSON, opening as text: " + entry.name,
                    2500
                  )
                  return this.openText(entry)
                }
                // same check as blockbench's java_block codec. blockstates, item
                // definitions and atlases are not models.
                if (!(parsed.parent || parsed.elements || parsed.textures)) {
                  return this.openText(entry)
                }
                if (!parsed.elements) {
                  Blockbench.showQuickMessage(
                    "`parent` only, this model has no geometry of its own",
                    2500
                  )
                }
                loadModelFile({ content: fs.readFileSync(abs, "utf8"), path: abs })
                return
              }

              // everything else as text, openText reports binary itself
              this.openText(entry)
            },

            // blockbench only knows images and models. pack.mcmeta, .txt,
            // .properties, shaders and blockstates get this editor instead.
            openText(entry) {
              const abs = this.abs(entry.rel)
              const ext = entry.ext

              let buf
              try {
                buf = fs.readFileSync(abs)
              } catch (err) {
                Blockbench.showMessageBox({
                  title: "File could not be read",
                  message:
                    "`" + entry.name + "` could not be read.\n\n" + String(err),
                  icon: "error"
                })
                return
              }

              if (buf.length > MAX_TEXT_BYTES) {
                Blockbench.showMessageBox({
                  title: "File too large",
                  message:
                    "`" + entry.name + "` is " + Math.round(buf.length / 1024) +
                    " KB. The editor stops at " +
                    Math.round(MAX_TEXT_BYTES / 1024) +
                    " KB so Blockbench does not freeze.",
                  icon: "warning"
                })
                return
              }

              // a NUL byte near the start means binary
              if (buf.subarray(0, 8192).includes(0)) {
                Blockbench.showMessageBox({
                  title: "Not a text file",
                  message:
                    "`" + entry.name + "` contains binary data (." + ext + ") and " +
                    "can be opened neither as an image nor as text.",
                  icon: "error"
                })
                return
              }

              const rel = entry.rel.join("/")
              const is_json = ext === "json" || ext === "mcmeta"
              const original = buf.toString("utf8")

              // false when nothing was written, that keeps onConfirm from closing
              const write = () => {
                const vue = dialog.content_vue
                if (!vue) return false
                if (is_json && vue.json_error) {
                  // offer a repair, or at least jump to the position
                  const fixed = escapeControlChars(vue.text)
                  const fixable = fixed !== vue.text && jsonOk(fixed)
                  const buttons = fixable
                    ? ["Repair and save", "Go to error", "Cancel"]
                    : ["Go to error", "Cancel"]
                  Blockbench.showMessageBox(
                    {
                      title: "Broken JSON",
                      message:
                        "Saved like this, `" + entry.name + "` would break the pack:\n\n" +
                        vue.json_error +
                        (fixable
                          ? "\n\nThe cause is **control characters inside a string** " +
                            "(usually a tab or a line break in the middle of the text). " +
                            "The repair writes them as `\\n` / `\\t`, the content stays the same."
                          : "\n\nFix it first, then save."),
                      icon: "error",
                      buttons,
                      confirm: 0,
                      cancel: buttons.length - 1
                    },
                    (choice) => {
                      if (fixable && choice === 0) {
                        vue.text = fixed
                        vue.$nextTick(() => write())
                      } else if (choice === (fixable ? 1 : 0)) {
                        vue.jumpToError()
                      }
                    }
                  )
                  return false
                }
                try {
                  fs.writeFileSync(abs, vue.text, "utf8")
                } catch (err) {
                  Blockbench.showMessageBox({
                    title: "Saving failed",
                    message: String(err),
                    icon: "error"
                  })
                  return false
                }
                vue.saved = vue.text
                Blockbench.showQuickMessage("Saved: " + entry.name, 1500)
                // header line comes from pack.mcmeta
                if (entry.rel.length === 1 && entry.name === "pack.mcmeta") {
                  this.reloadInfo()
                }
                return true
              }

              const dialog = new Dialog("resourcepack_editor_text_editor", {
                title: entry.name,
                width: 900,
                resizable: true,
                buttons: ["Save", "Close"],
                confirmIndex: 0,
                cancelIndex: 1,
                // Ctrl+S saves without closing. guarded in case Keybind is ever
                // not global, then only the shortcut is gone.
                keyboard_actions:
                  typeof Keybind === "undefined"
                    ? {}
                    : {
                        save: {
                          keybind: new Keybind({ key: "s", ctrl: true }),
                          run() {
                            write()
                          }
                        }
                      },
                onConfirm() {
                  return write()
                },
                onCancel() {
                  const vue = dialog.content_vue
                  if (!vue || vue.text === vue.saved) return
                  Blockbench.showMessageBox(
                    {
                      title: "Unsaved changes",
                      message:
                        "`" + entry.name + "` was changed but not saved.",
                      icon: "warning",
                      buttons: ["Save", "Discard", "Back"],
                      confirm: 0,
                      cancel: 2
                    },
                    (choice) => {
                      if (choice === 0) {
                        if (write()) dialog.hide()
                      } else if (choice === 1) {
                        dialog.hide()
                      }
                    }
                  )
                  return false
                },
                component: {
                  data() {
                    return { text: original, saved: original, path: rel, is_json }
                  },
                  computed: {
                    dirty() {
                      return this.text !== this.saved
                    },
                    line_count() {
                      return this.text.length ? this.text.split("\n").length : 0
                    },
                    json_error() {
                      if (!this.is_json) return ""
                      try {
                        JSON.parse(this.text)
                        return ""
                      } catch (err) {
                        return String((err && err.message) || err)
                      }
                    }
                  },
                  methods: {
                    // tab indents instead of moving focus. spaces in json,
                    // a real tab inside a string is illegal there.
                    insertTab(event) {
                      event.preventDefault()
                      const ta = event.target
                      const a = ta.selectionStart
                      const b = ta.selectionEnd
                      const insert = this.is_json ? "    " : "\t"
                      this.text = this.text.slice(0, a) + insert + this.text.slice(b)
                      this.$nextTick(() => {
                        ta.selectionStart = ta.selectionEnd = a + insert.length
                      })
                    },
                    jumpToError() {
                      const m = /position (\d+)/.exec(this.json_error || "")
                      const ta = this.$el && this.$el.querySelector("textarea")
                      if (!ta) return
                      const pos = m ? Math.min(this.text.length, parseInt(m[1], 10)) : 0
                      ta.focus()
                      ta.selectionStart = pos
                      ta.selectionEnd = Math.min(this.text.length, pos + 1)
                      // roughly the right line
                      const line = this.text.slice(0, pos).split("\n").length - 1
                      ta.scrollTop = Math.max(0, line * 19 - ta.clientHeight / 2)
                    }
                  },
                  mounted() {
                    this.$nextTick(() => {
                      const ta = this.$el.querySelector("textarea")
                      if (ta) ta.focus()
                    })
                  },
                  template: `
                    <div class="rpe_text">
                      <textarea v-model="text" spellcheck="false" autocomplete="off"
                                wrap="off" @keydown.tab="insertTab"></textarea>
                      <div class="rpe_text_info">
                        <span :title="path">{{ path }}</span>
                        <span class="rpe_text_mid">
                          <span v-if="is_json && json_error"
                                class="rpe_text_bad rpe_text_jump"
                                @click="jumpToError"
                                title="Click to jump to the error">Broken JSON: {{ json_error }}</span>
                          <span v-else-if="is_json">JSON ok</span>
                        </span>
                        <span>
                          {{ line_count }} lines<span v-if="dirty"
                            class="rpe_text_dirty"> &middot; unsaved</span>
                        </span>
                      </div>
                    </div>
                  `
                }
              })
              dialog.show()
            },

            // re-read description / pack_format from pack.mcmeta
            reloadInfo() {
              if (!this.root) return
              const mcmeta = PathModule.join(this.root, "pack.mcmeta")
              try {
                const meta = JSON.parse(fs.readFileSync(mcmeta, "utf8"))
                const d = meta.pack && meta.pack.description
                this.info = {
                  description:
                    typeof d === "string" ? d : PathModule.basename(this.root),
                  format: (meta.pack && meta.pack.pack_format) ?? "?"
                }
              } catch (err) {
                this.info = {
                  description: PathModule.basename(this.root),
                  format: "pack.mcmeta unreadable"
                }
              }
            },

            thumb(entry) {
              if (entry.dir || entry.ext !== "png") return null
              if (this.broken[entry.joined || entry.rel.join("/")]) return null
              return this.abs(entry.rel)
            },
            thumbFailed(entry) {
              this.$set(this.broken, entry.joined || entry.rel.join("/"), true)
            },
            icon(entry) {
              if (entry.dir) return "folder"
              if (IMAGE_EXT.includes(entry.ext)) return "image"
              if (entry.ext === "json") return "data_object"
              if (entry.ext === "mcmeta") return "settings"
              return "description"
            },

            async exportZip() {
              if (!this.root || this.busy) return
              this.busy = true
              this.status = "Packing…"
              try {
                if (!this.index) this.buildIndex()
                const zip = new JSZip()
                for (const e of this.index) {
                  zip.file(e.joined, fs.readFileSync(this.abs(e.rel)))
                }
                const blob = await zip.generateAsync(
                  {
                    type: "blob",
                    compression: "DEFLATE",
                    compressionOptions: { level: 6 }
                  },
                  (meta) => {
                    Blockbench.setProgress(meta.percent / 100)
                  }
                )
                // came from a zip, suggest that name again
                const name = this.zip_source
                  ? PathModule.basename(this.zip_source).replace(/\.zip$/i, "")
                  : PathModule.basename(this.root)
                Blockbench.export({
                  type: "Resource Pack",
                  extensions: ["zip"],
                  name,
                  content: blob,
                  savetype: "zip"
                })
              } catch (err) {
                console.error(err)
                Blockbench.showMessageBox({
                  title: "Export failed",
                  message: String(err),
                  icon: "error"
                })
              } finally {
                this.busy = false
                this.status = ""
                Blockbench.setProgress(0)
              }
            },

            reload() {
              if (!this.root) return
              this.index = null
              this.refresh()
              this.buildIndex()
              Blockbench.showQuickMessage("Pack re-read from disk", 1400)
            }
          },

          mounted() {
            panelVue = this
            const last = localStorage.getItem(STORE_KEY)
            if (last && fs.existsSync(PathModule.join(last, "pack.mcmeta"))) {
              this.load(last)
            }
          },

          template: `
            <div class="rpe">

              <div class="rpe_bar">
                <button @click="pickZip" :disabled="busy"
                        title="Open a resource pack .zip, it gets extracted so it can be edited">
                  <i class="material-icons">archive</i><span>Open zip</span>
                </button>
                <button class="rpe_icon_only" @click="pick" :disabled="busy"
                        title="Open an already extracted pack folder instead">
                  <i class="material-icons">folder_open</i>
                </button>
                <button class="rpe_icon_only" @click="reload" :disabled="!root || busy"
                        title="Re-read from disk">
                  <i class="material-icons">refresh</i>
                </button>
                <button class="rpe_icon_only" @click="exportZip" :disabled="!root || busy"
                        title="Save the whole pack back out as a .zip">
                  <i class="material-icons">save</i>
                </button>
              </div>

              <div v-if="busy" class="rpe_busy">{{ status || 'Working…' }}</div>

              <div v-if="!root && !busy" class="rpe_empty">
                No pack open.<br>
                Click <b>Open zip</b> above and choose your <code>.zip</code>.<br>
                <span style="font-size:11px;">
                  It is extracted into a folder next to the zip,
                  your original <code>.zip</code> is never modified.
                </span>
              </div>

              <template v-if="root">
                <div class="rpe_head">
                  <div class="rpe_title">{{ info.description }}</div>
                  <div class="rpe_sub">
                    pack_format {{ info.format }}
                    <template v-if="index"> &middot; {{ index.length }} files</template>
                    <template v-if="zip_source"> &middot; from .zip</template>
                  </div>
                </div>

                <div class="rpe_search">
                  <i class="material-icons" style="font-size:17px;">search</i>
                  <input type="text" class="dark_bordered" v-model="query"
                         :placeholder="index ? 'Search the whole pack…' : 'Building index…'">
                  <i class="material-icons" style="font-size:17px;cursor:pointer;"
                     v-if="query" @click="query=''">close</i>
                </div>

                <div class="rpe_crumbs" v-if="!searching">
                  <span @click="goto(0)">{{ info.description }}</span>
                  <template v-for="(part, i) in cwd">
                    <span style="cursor:default;">/</span>
                    <span @click="goto(i+1)">{{ part }}</span>
                  </template>
                </div>
                <div class="rpe_crumbs" v-else>
                  {{ total }} matches{{ total > per_page ? ' - page ' + (page+1) + '/' + pages : '' }}
                </div>

                <div class="rpe_list">
                  <div class="rpe_row" v-if="!searching && cwd.length" @click="up">
                    <i class="material-icons">arrow_upward</i>
                    <span class="rpe_name">..</span>
                  </div>

                  <div class="rpe_row" v-for="entry in shown"
                       :key="entry.rel.join('/')" @click="click(entry)"
                       :title="entry.rel.join('/')">
                    <img v-if="thumb(entry)" class="rpe_thumb"
                         :src="thumb(entry)" @error="thumbFailed(entry)">
                    <i v-else class="material-icons">{{ icon(entry) }}</i>
                    <span class="rpe_name">
                      {{ entry.name }}
                      <span v-if="searching" class="rpe_path">
                        &middot; {{ entry.rel.slice(0,-1).join('/') }}
                      </span>
                    </span>
                  </div>

                  <div class="rpe_empty" v-if="!shown.length">
                    {{ searching ? 'Nothing found' : 'This folder is empty' }}
                  </div>
                </div>

                <div class="rpe_pager" v-if="pages > 1">
                  <button @click="page = Math.max(0, page-1)" :disabled="page === 0">&lsaquo;</button>
                  <span>{{ page+1 }} / {{ pages }}</span>
                  <button @click="page = Math.min(pages-1, page+1)" :disabled="page >= pages-1">&rsaquo;</button>
                </div>
              </template>

            </div>
          `
        }
      })

      actionOpenZip = new Action("resourcepack_editor_open_zip", {
        name: "Open Resource Pack (.zip)…",
        description: "Extracts a resource pack zip and opens it in the Resourcepack Editor",
        icon: "archive",
        click() {
          const vue = panelVue || (panel && panel.vue)
          if (vue) vue.pickZip()
        }
      })
      MenuBar.addAction(actionOpenZip, "file")

      actionOpen = new Action("resourcepack_editor_open_folder", {
        name: "Open Resource Pack Folder…",
        description: "Opens an already extracted resource pack folder in the Resourcepack Editor",
        icon: "inventory_2",
        click() {
          const vue = panelVue || (panel && panel.vue)
          if (vue) vue.pick()
        }
      })
      MenuBar.addAction(actionOpen, "file")

      // same toolbar as brush and fill. returning false keeps blockbench from
      // painting a dot on top of the click.
      toolText = new Tool("resourcepack_editor_text", {
        name: "Text",
        description:
          "Place text on the texture, with the pack's own fonts or a system font",
        icon: "fa-font",
        category: "tools",
        cursor: "crosshair",
        selectFace: true,
        transformerMode: "hidden",
        paintTool: true,
        allowed_view_modes: ["textured", "material"],
        modes: ["paint"],
        onTextureEditorClick(texture, x, y) {
          openTextDialog(texture, Math.floor(x), Math.floor(y))
          return false
        },
        onCanvasClick(data) {
          // 3d model click: face -> texture -> pixel
          if (!data || !data.intersects || !data.element) return
          try {
            const face = data.element.faces[data.face]
            const texture = face && face.getTexture()
            if (!texture) {
              Blockbench.showQuickMessage("This face has no texture", 2000)
              return
            }
            const coords = Painter.getCanvasToolPixelCoords(data.intersects[0].uv, texture)
            openTextDialog(texture, Math.floor(coords[0]), Math.floor(coords[1]))
          } catch (err) {
            console.error(err)
            openTextDialog(Texture.selected, 0, 0)
          }
        }
      })
      const tool_bar = (typeof Toolbars !== "undefined" && Toolbars.tools) || (typeof Toolbox !== "undefined" ? Toolbox : null)
      if (tool_bar && tool_bar.add) tool_bar.add(toolText)

      actionText = new Action("resourcepack_editor_insert_text", {
        name: "Insert Text…",
        description: "Places text on the currently open texture",
        icon: "fa-font",
        condition: () => !!(typeof Texture !== "undefined" && Texture.selected),
        click() {
          openTextDialog(Texture.selected, 0, 0)
        }
      })
      MenuBar.addAction(actionText, "image")
    },

    onunload() {
      panelVue = null
      if (panel) panel.delete()
      if (css) css.delete()
      if (actionOpen) actionOpen.delete()
      if (actionOpenZip) actionOpenZip.delete()
      if (actionText) actionText.delete()
      if (toolText) {
        const bar = (typeof Toolbars !== "undefined" && Toolbars.tools) || null
        if (bar && bar.remove) bar.remove(toolText)
        toolText.delete()
      }
    }
  })
})()
