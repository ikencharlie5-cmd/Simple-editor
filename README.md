# 🐔 Chiken

A photo, video, audio and animation editor that runs entirely in your browser. You can install it like an app on a Chromebook, and it works offline.

## Run it

```bash
npm install
npm run dev        # open the printed localhost URL in Chrome
npm run build      # production build in dist/
```

**Install on a Chromebook:** open the app in Chrome, then click the install icon (⊕) at the right end of the address bar. It gets its own window and launcher icon, and works offline. (This is called a PWA, short for Progressive Web App.)

## Tabs

| Tab | What it does |
| --- | --- |
| 🖼 **Photo** | A Photoshop-style editor with layers, blend modes, selections, history, adjustments, filters and the full tool set below. |
| 🎬 **Video** | A CapCut-style editor: multi-track timeline, split/trim/ripple, speed, volume and fades, text and stickers, filters, adjustments, transitions, in/out/loop animations, keyframes, chroma key, aspect-ratio presets. |
| 🎵 **Audio** | Import music, 17 built-in royalty-free sounds and loops, voiceover recording, waveform range picking, "fit to video length", and a mixer. |
| 🐔 **Animator** | Keyframe motion graphics, frame-by-frame drawing with onion skin, and one-click presets. **Send to video editor** stays live-linked: edits in the Animator update the clip in your video. |
| ⬇ **Export** | MP4/WebM/MOV video, GIF/APNG/sprite sheet, PNG/JPG/WebP (and photo slices), MP3/WAV audio, and `.chiken` project files. |

Your work autosaves in the browser (IndexedDB). Use **Export → Project file** to back it up or move it to another computer.

## Photo tools and shortcuts

Press a tool's key to select it. Press **Shift + the key** to cycle through that key's group. You can also right-click or long-press a toolbar button to open its flyout.

- **V**: Move, Artboard
- **M**: Rectangular / Elliptical / Single Row / Single Column Marquee
- **L**: Lasso, Polygonal Lasso, Magnetic Lasso, Selection Brush
- **W**: Object Selection, Quick Selection, Magic Wand
- **C**: Crop, Perspective Crop, Slice, Slice Select
- **K**: Frame
- **I**: Eyedropper, 3D Material Eyedropper, Color Sampler, Ruler, Note, Count
- **J**: Remove, Spot Healing Brush, Healing Brush, Patch, Content-Aware Move, Red Eye
- **B**: Brush, Pencil, Color Replacement, Mixer Brush, Adjustment Brush
- **S**: Clone Stamp, Pattern Stamp
- **Y**: History Brush, Art History Brush
- **E**: Eraser, Background Eraser, Magic Eraser
- **G**: Gradient, Paint Bucket
- **No shortcut**: Blur, Sharpen, Smudge
- **O**: Dodge, Burn, Sponge
- **P**: Pen, Freeform Pen, Curvature Pen, Add / Delete Anchor Point, Convert Point
- **T**: Horizontal / Vertical Type, Horizontal / Vertical Type Mask
- **A**: Path Selection, Direct Selection
- **U**: Rectangle, Ellipse, Triangle, Polygon, Line, Custom Shape
- **H**: Hand (or hold Space with any tool) · **R**: Rotate View · **Z**: Zoom
- **Q**: Quick Mask · **F**: Change Screen Mode · **D**: default colours · **X**: swap colours · **[ ]**: brush size · **0–9**: opacity
- **Ctrl+Z / Ctrl+Shift+Z**: undo / redo · **Ctrl+A / D / Shift+I**: select all / deselect / inverse · **Ctrl+J**: layer via copy · **Ctrl+E**: merge down · **Ctrl+T**: transform · **Enter**: apply crop

Content-aware tools (Remove, Spot Healing, Content-Aware Move, Object Selection) run on-device using classic algorithms: patch-based inpainting and colour-model segmentation. Nothing is uploaded.

## Video shortcuts

Space play/pause · S or Ctrl+B split · Del delete · Shift+Del ripple delete · Ctrl+D duplicate · ←/→ step a frame (Shift = 1 s) · Alt+1…5 switch tabs.

## Notes

- Video export uses WebCodecs, which is hardware-accelerated in Chrome on ChromeOS. Very long 4K projects can run into the browser's memory limits; 1080p projects of a few minutes are fine.
- MOV export is H.264 in a QuickTime-compatible MP4 container.
