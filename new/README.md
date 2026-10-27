# New video editor (no name yet)

A phone-first video editor that runs entirely in the browser. Videos never leave the device.
Open `new/index.html` from any web server (e.g. GitHub Pages: `/new/`).

## What it does
- **Timeline**: main track with filmstrips, overlay/text/effect rows, sound rows; trim, split, move, reorder, snapping, zoom, markers, keyframes (position, size, rotation, opacity, volume), undo/redo.
- **Clips**: speed (0.1x–10x, pitch kept) and speed curves, volume and fades, in/out/loop animations, transitions (27), filters (30), adjustments (14), effects (47), masks (split, band, circle, rectangle, triangle, diamond) with edge fade, crop, flip/rotate/fit/fill, opacity and blend modes, chroma key with colour picker, cutout (background removal for people), stabilise, reverse, freeze frame, replace, extract sound, copy/paste style.
- **Face blur**: two face detectors plus body pose (for heads turned away) on every analysed frame, tracking with gap filling and motion padding, blur, mosaic, frosted or solid cover, adjustable strength, **edge fade**, size, shape and hold time. Each face can be switched on or off, and a missed face can be added by drawing a box (it is then followed through the clip). There are also free **blur areas** that can follow motion.
- **Text**: about 60 checked fonts (Latin, Arabic, Urdu), styles, outline, shadow, glow, background boxes, spacing, animations including typewriter and word by word.
- **Captions**: automatic word-by-word captions (Whisper, on the device), caption looks with word highlight, plus `.srt`/`.vtt` import and `.srt` export.
- **Shapes**: 26 shapes with fill, gradient, outline and shadow.
- **Sound**: around 50 sound effects synthesised by the app (clicks, camera shutter, clip, snap, paper, rain, wind, waves, stream, fire, thunder and more). There is no music. Also voiceover recording, voice effects, noise reduction and voice enhancement.
- **Other**: canvas ratios and background, in-app camera with timer and teleprompter, export to MP4 (720p–4K, 24–60 fps), save a single frame, save the sound as `.wav`, and offline use.

## Content rules followed
- No music, no stock pictures of living beings, no templates.
- No crescent, cross, heart or holiday shapes, and no plus-sign icons.
- Every Latin font was rendered and checked: fonts whose small "t" looks like a cross (for example Josefin Sans, Outfit, Lexend, Urbanist, Reem Kufi) are left out, as are novelty fonts.

## Files
`js/` holds the engine (WebGL renderer, composer, audio, face tracking, export), with the interface in `js/ui/`. `vendor/` holds the on-device face finders and the MP4 writer.
