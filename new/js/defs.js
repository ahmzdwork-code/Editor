// Catalogue of looks and motions: filters, effects, transitions, animations, shapes, fonts, text styles.

/* Filters: adjustment presets plus optional split toning (shadow / highlight tint). */
export const FILTERS = [
  { id: 'natural', name: 'Natural', cat: 'Basic', adj: { contrast: 0.06, saturation: 0.08, vibrance: 0.1 } },
  { id: 'crisp', name: 'Crisp', cat: 'Basic', adj: { contrast: 0.18, sharpen: 0.35, saturation: 0.05, highlights: -0.1 } },
  { id: 'vivid', name: 'Vivid', cat: 'Basic', adj: { saturation: 0.35, vibrance: 0.3, contrast: 0.12 } },
  { id: 'soft', name: 'Soft', cat: 'Basic', adj: { contrast: -0.15, fade: 0.12, highlights: -0.1, saturation: -0.05 } },
  { id: 'bright', name: 'Bright', cat: 'Basic', adj: { exposure: 0.18, shadows: 0.2, contrast: -0.04 } },
  { id: 'warm', name: 'Warm', cat: 'Basic', adj: { temp: 0.35, saturation: 0.05 } },
  { id: 'cool', name: 'Cool', cat: 'Basic', adj: { temp: -0.35, tint: 0.04 } },
  { id: 'matte', name: 'Matte', cat: 'Film', adj: { fade: 0.25, contrast: -0.08, saturation: -0.12 }, tone: { sh: [40, 48, 60], hi: [255, 240, 220], amt: 0.15 } },
  { id: 'film', name: 'Film', cat: 'Film', adj: { contrast: 0.1, fade: 0.12, grain: 0.25, saturation: -0.08 }, tone: { sh: [20, 50, 60], hi: [255, 225, 180], amt: 0.25 } },
  { id: 'kodak', name: 'Golden', cat: 'Film', adj: { temp: 0.25, contrast: 0.12, saturation: 0.1 }, tone: { sh: [70, 40, 20], hi: [255, 220, 150], amt: 0.3 } },
  { id: 'faded', name: 'Faded', cat: 'Film', adj: { fade: 0.35, saturation: -0.25, contrast: -0.1 } },
  { id: 'retro', name: 'Retro', cat: 'Film', adj: { saturation: -0.2, fade: 0.2, temp: 0.2, grain: 0.3, vignette: 0.3 }, tone: { sh: [60, 40, 30], hi: [240, 220, 170], amt: 0.35 } },
  { id: 'polar', name: 'Polar', cat: 'Film', adj: { temp: -0.3, saturation: -0.2, exposure: 0.08, fade: 0.1 } },
  { id: 'teal', name: 'Teal & Orange', cat: 'Cinema', adj: { contrast: 0.18, saturation: 0.1 }, tone: { sh: [0, 90, 110], hi: [255, 170, 90], amt: 0.4 } },
  { id: 'cinema', name: 'Cinema', cat: 'Cinema', adj: { contrast: 0.22, saturation: -0.1, shadows: -0.1, vignette: 0.35 }, tone: { sh: [10, 40, 60], hi: [250, 230, 200], amt: 0.25 } },
  { id: 'noir', name: 'Noir', cat: 'Cinema', mono: true, adj: { contrast: 0.45, shadows: -0.2, vignette: 0.45, grain: 0.2 } },
  { id: 'bleach', name: 'Bleach', cat: 'Cinema', adj: { saturation: -0.45, contrast: 0.35, highlights: 0.1 } },
  { id: 'night', name: 'Night', cat: 'Cinema', adj: { exposure: -0.15, temp: -0.4, saturation: -0.2, contrast: 0.15 }, tone: { sh: [10, 20, 60], hi: [180, 210, 255], amt: 0.3 } },
  { id: 'desert', name: 'Desert', cat: 'Cinema', adj: { temp: 0.45, saturation: -0.05, contrast: 0.1, fade: 0.08 }, tone: { sh: [90, 50, 20], hi: [255, 210, 150], amt: 0.25 } },
  { id: 'mono', name: 'Mono', cat: 'Mono', mono: true, adj: { contrast: 0.1 } },
  { id: 'silver', name: 'Silver', cat: 'Mono', mono: true, adj: { contrast: 0.2, fade: 0.1, highlights: 0.1 } },
  { id: 'sepia', name: 'Sepia', cat: 'Mono', mono: true, adj: { contrast: 0.08 }, tone: { sh: [70, 45, 20], hi: [255, 230, 190], amt: 0.85 } },
  { id: 'cyan', name: 'Blueprint', cat: 'Mono', mono: true, adj: { contrast: 0.15 }, tone: { sh: [0, 30, 70], hi: [200, 235, 255], amt: 0.85 } },
  { id: 'forest', name: 'Forest', cat: 'Nature', adj: { saturation: 0.12, tint: -0.15, contrast: 0.08 }, tone: { sh: [10, 50, 30], hi: [230, 250, 200], amt: 0.25 } },
  { id: 'ocean', name: 'Ocean', cat: 'Nature', adj: { temp: -0.2, saturation: 0.15, contrast: 0.06 }, tone: { sh: [0, 40, 80], hi: [210, 245, 255], amt: 0.2 } },
  { id: 'sunset', name: 'Dusk', cat: 'Nature', adj: { temp: 0.3, tint: 0.1, saturation: 0.18 }, tone: { sh: [60, 20, 60], hi: [255, 190, 120], amt: 0.3 } },
  { id: 'spring', name: 'Fresh', cat: 'Nature', adj: { exposure: 0.08, saturation: 0.2, tint: -0.08, highlights: -0.1 } },
  { id: 'pastel', name: 'Pastel', cat: 'Nature', adj: { saturation: -0.15, fade: 0.2, exposure: 0.1, contrast: -0.12 }, tone: { sh: [90, 80, 110], hi: [255, 235, 240], amt: 0.25 } },
  { id: 'arctic', name: 'Arctic', cat: 'Nature', adj: { temp: -0.45, exposure: 0.12, saturation: -0.1, highlights: 0.1 } },
  { id: 'food', name: 'Food', cat: 'Nature', adj: { temp: 0.18, saturation: 0.22, contrast: 0.08, sharpen: 0.2 } },
];
export const filterById = id => FILTERS.find(f => f.id === id);

export const ADJUST = [
  { k: 'exposure', name: 'Exposure' }, { k: 'brightness', name: 'Brightness' }, { k: 'contrast', name: 'Contrast' },
  { k: 'saturation', name: 'Saturation' }, { k: 'vibrance', name: 'Vibrance' }, { k: 'temp', name: 'Temperature' },
  { k: 'tint', name: 'Tint' }, { k: 'hue', name: 'Hue' }, { k: 'highlights', name: 'Highlights' }, { k: 'shadows', name: 'Shadows' },
  { k: 'fade', name: 'Fade', min: 0 }, { k: 'sharpen', name: 'Sharpen', min: 0 }, { k: 'vignette', name: 'Vignette' }, { k: 'grain', name: 'Grain', min: 0 },
];

/* Effects: `t` is the shader number. `a` amount, `b` secondary, `sp` speed (for moving effects). */
export const EFFECTS = [
  // Basic
  { id: 'blur', t: 1, name: 'Blur', cat: 'Basic', a: 0.5 },
  { id: 'sharpen', t: 9, name: 'Sharpen', cat: 'Basic', a: 0.6 },
  { id: 'vignette', t: 8, name: 'Vignette', cat: 'Basic', a: 0.6 },
  { id: 'mono', t: 16, name: 'Black & white', cat: 'Basic', a: 1 },
  { id: 'invert', t: 15, name: 'Invert', cat: 'Basic', a: 1 },
  { id: 'letterbox', t: 27, name: 'Letterbox', cat: 'Basic', a: 0.5 },
  { id: 'fadeblack', t: 37, name: 'Fade to black', cat: 'Basic', a: 1 },
  { id: 'zoomblur', t: 39, name: 'Zoom blur', cat: 'Basic', a: 0.5 },
  { id: 'motionblur', t: 40, name: 'Motion blur', cat: 'Basic', a: 0.5 },
  { id: 'tiltshift', t: 34, name: 'Tilt-shift', cat: 'Basic', a: 0.6, b: 0.5 },
  // Retro
  { id: 'grain', t: 6, name: 'Film grain', cat: 'Retro', a: 0.5 },
  { id: 'oldfilm', t: 7, name: 'Old film', cat: 'Retro', a: 0.7 },
  { id: 'vhs', t: 5, name: 'VHS', cat: 'Retro', a: 0.6 },
  { id: 'scan', t: 28, name: 'Scan lines', cat: 'Retro', a: 0.5 },
  { id: 'halftone', t: 30, name: 'Halftone', cat: 'Retro', a: 0.5 },
  { id: 'posterize', t: 17, name: 'Posterize', cat: 'Retro', a: 0.5 },
  { id: 'duotone', t: 41, name: 'Duotone', cat: 'Retro', a: 1 },
  { id: 'static', t: 36, name: 'Static', cat: 'Retro', a: 0.4 },
  // Motion
  { id: 'shake', t: 21, name: 'Shake', cat: 'Motion', a: 0.4, sp: 1 },
  { id: 'pulse', t: 22, name: 'Zoom pulse', cat: 'Motion', a: 0.4, sp: 1 },
  { id: 'wave', t: 20, name: 'Wave', cat: 'Motion', a: 0.4, sp: 1 },
  { id: 'swirl', t: 35, name: 'Twirl', cat: 'Motion', a: 0.5 },
  { id: 'fisheye', t: 19, name: 'Fisheye', cat: 'Motion', a: 0.5 },
  { id: 'flash', t: 23, name: 'Flash', cat: 'Motion', a: 0.8, sp: 1 },
  { id: 'strobe', t: 38, name: 'Strobe', cat: 'Motion', a: 0.6, sp: 1 },
  // Glitch
  { id: 'rgbsplit', t: 3, name: 'RGB split', cat: 'Glitch', a: 0.4 },
  { id: 'glitch', t: 4, name: 'Glitch', cat: 'Glitch', a: 0.5, sp: 1 },
  { id: 'chroma', t: 29, name: 'Lens fringe', cat: 'Glitch', a: 0.5 },
  { id: 'pixelate', t: 2, name: 'Pixelate', cat: 'Glitch', a: 0.4 },
  // Light
  { id: 'glow', t: 24, name: 'Glow', cat: 'Light', a: 0.5 },
  { id: 'dream', t: 25, name: 'Dreamy', cat: 'Light', a: 0.5 },
  { id: 'leak', t: 26, name: 'Light leak', cat: 'Light', a: 0.6, sp: 1 },
  { id: 'nightvision', t: 42, name: 'Night vision', cat: 'Light', a: 1 },
  { id: 'thermal', t: 43, name: 'Heat map', cat: 'Light', a: 1 },
  // Weather
  { id: 'rain', t: 31, name: 'Rain', cat: 'Weather', a: 0.5, sp: 1 },
  { id: 'snow', t: 32, name: 'Snow', cat: 'Weather', a: 0.5, sp: 1 },
  { id: 'dust', t: 33, name: 'Dust', cat: 'Weather', a: 0.5, sp: 1 },
  { id: 'fog', t: 45, name: 'Fog', cat: 'Weather', a: 0.5, sp: 1 },
  // Split
  { id: 'mirror', t: 10, name: 'Mirror', cat: 'Split', a: 1 },
  { id: 'mirrorv', t: 11, name: 'Mirror vertical', cat: 'Split', a: 1 },
  { id: 'kaleido', t: 12, name: 'Four-way', cat: 'Split', a: 1 },
  { id: 'grid4', t: 13, name: 'Split 4', cat: 'Split', a: 1 },
  { id: 'grid3', t: 14, name: 'Split 3', cat: 'Split', a: 1 },
  { id: 'grid9', t: 46, name: 'Split 9', cat: 'Split', a: 1 },
  // Stylise
  { id: 'sketch', t: 18, name: 'Sketch', cat: 'Stylise', a: 0.8 },
  { id: 'emboss', t: 44, name: 'Emboss', cat: 'Stylise', a: 0.8 },
  { id: 'border', t: 47, name: 'Frame', cat: 'Stylise', a: 0.4 },
];
export const effectById = id => EFFECTS.find(e => e.id === id);
// effects needing a blurred copy of the image
export const NEEDS_BLUR = new Set([1, 24, 25, 34]);

export const TRANSITIONS = [
  { id: 'fade', t: 1, name: 'Dissolve', cat: 'Basic' },
  { id: 'black', t: 2, name: 'Through black', cat: 'Basic' },
  { id: 'white', t: 3, name: 'Through white', cat: 'Basic' },
  { id: 'blur', t: 4, name: 'Blur', cat: 'Basic' },
  { id: 'zoomin', t: 5, name: 'Zoom in', cat: 'Camera' },
  { id: 'zoomout', t: 6, name: 'Zoom out', cat: 'Camera' },
  { id: 'spin', t: 7, name: 'Spin', cat: 'Camera' },
  { id: 'slidel', t: 8, name: 'Slide left', cat: 'Slide' },
  { id: 'slider', t: 9, name: 'Slide right', cat: 'Slide' },
  { id: 'slideu', t: 10, name: 'Slide up', cat: 'Slide' },
  { id: 'slided', t: 11, name: 'Slide down', cat: 'Slide' },
  { id: 'pushl', t: 12, name: 'Push left', cat: 'Slide' },
  { id: 'pushr', t: 13, name: 'Push right', cat: 'Slide' },
  { id: 'pushu', t: 14, name: 'Push up', cat: 'Slide' },
  { id: 'pushd', t: 15, name: 'Push down', cat: 'Slide' },
  { id: 'wipel', t: 16, name: 'Wipe left', cat: 'Wipe' },
  { id: 'wiper', t: 17, name: 'Wipe right', cat: 'Wipe' },
  { id: 'wipeu', t: 18, name: 'Wipe up', cat: 'Wipe' },
  { id: 'wiped', t: 19, name: 'Wipe down', cat: 'Wipe' },
  { id: 'circle', t: 20, name: 'Circle', cat: 'Wipe' },
  { id: 'doors', t: 21, name: 'Doors', cat: 'Wipe' },
  { id: 'diag', t: 26, name: 'Diagonal', cat: 'Wipe' },
  { id: 'glitch', t: 22, name: 'Glitch', cat: 'Effect' },
  { id: 'flash', t: 23, name: 'Flash', cat: 'Effect' },
  { id: 'pixel', t: 24, name: 'Pixelate', cat: 'Effect' },
  { id: 'swirl', t: 25, name: 'Twirl', cat: 'Effect' },
  { id: 'ripple', t: 27, name: 'Ripple', cat: 'Effect' },
];
export const transById = id => TRANSITIONS.find(e => e.id === id);

/* Animations: in / out / loop. Values are computed in render (anim.js). */
export const ANIM_IN = [
  ['fade', 'Fade'], ['slidel', 'Slide from left'], ['slider', 'Slide from right'], ['slideu', 'Slide up'], ['slided', 'Slide down'],
  ['zoomin', 'Zoom in'], ['zoomout', 'Zoom out'], ['pop', 'Pop'], ['rotate', 'Rotate'], ['spin', 'Spin'], ['blur', 'Blur'],
  ['wipel', 'Wipe left'], ['wiper', 'Wipe right'], ['wipeu', 'Wipe up'], ['wiped', 'Wipe down'], ['drop', 'Drop'], ['bounce', 'Bounce'], ['squeeze', 'Squeeze'],
  ['type', 'Typewriter', 'text'], ['letters', 'Letters rise', 'text'], ['words', 'Word by word', 'text'],
];
export const ANIM_OUT = [
  ['fade', 'Fade'], ['slidel', 'Slide to left'], ['slider', 'Slide to right'], ['slideu', 'Slide up'], ['slided', 'Slide down'],
  ['zoomin', 'Zoom in'], ['zoomout', 'Zoom out'], ['pop', 'Pop'], ['rotate', 'Rotate'], ['spin', 'Spin'], ['blur', 'Blur'],
  ['wipel', 'Wipe left'], ['wiper', 'Wipe right'], ['wipeu', 'Wipe up'], ['wiped', 'Wipe down'], ['drop', 'Drop'], ['squeeze', 'Squeeze'],
  ['type', 'Typewriter', 'text'],
];
export const ANIM_LOOP = [
  ['pulse', 'Pulse'], ['float', 'Float'], ['sway', 'Sway'], ['shake', 'Shake'], ['spin', 'Spin'], ['blink', 'Blink'],
  ['wiggle', 'Wiggle'], ['breathe', 'Breathe'], ['swing', 'Swing'], ['drift', 'Drift'],
];

export const BLENDS = [
  ['normal', 'Normal', 0], ['multiply', 'Multiply', 1], ['screen', 'Screen', 2], ['overlay', 'Overlay', 3], ['darken', 'Darken', 4],
  ['lighten', 'Lighten', 5], ['add', 'Add', 6], ['softlight', 'Soft light', 7], ['hardlight', 'Hard light', 8],
  ['difference', 'Difference', 9], ['dodge', 'Colour dodge', 10], ['burn', 'Colour burn', 11], ['exclusion', 'Exclusion', 12],
];

export const MASKS = [
  ['none', 'None'], ['linear', 'Split'], ['mirror', 'Band'], ['circle', 'Circle'], ['rect', 'Rectangle'], ['triangle', 'Triangle'], ['diamond', 'Diamond'],
];

/* Shapes. Drawn with canvas paths (shapes.js). No crosses, hearts, stars or crescents. */
export const SHAPES = [
  ['rect', 'Rectangle'], ['square', 'Square'], ['rounded', 'Rounded'], ['circle', 'Circle'], ['ellipse', 'Oval'], ['ring', 'Ring'],
  ['triangle', 'Triangle'], ['rtriangle', 'Right triangle'], ['diamond', 'Diamond'], ['pentagon', 'Pentagon'], ['hexagon', 'Hexagon'],
  ['octagon', 'Octagon'], ['parallelogram', 'Parallelogram'], ['trapezoid', 'Trapezoid'], ['semicircle', 'Half circle'],
  ['quarter', 'Quarter circle'], ['pill', 'Pill'], ['line', 'Line'], ['arrow', 'Arrow'], ['darrow', 'Double arrow'],
  ['chevron', 'Chevron'], ['bubble', 'Speech bubble'], ['frame', 'Frame'], ['bracket', 'Corners'], ['dots', 'Dots row'], ['wave', 'Wave line'],
];

/* Fonts: every Latin font below was checked so its small "t" has a curved foot (no cross-like
   letters). No novelty fonts with decorative shapes. */
export const FONTS = [
  // Sans
  ['Inter', 'sans', '400;700;900'], ['Roboto', 'sans', '400;700;900'], ['Open Sans', 'sans', '400;700;800'], ['Lato', 'sans', '400;700;900'],
  ['Montserrat', 'sans', '400;700;900'], ['Poppins', 'sans', '400;600;800'], ['Nunito', 'sans', '400;700;900'], ['Manrope', 'sans', '400;700;800'],
  ['DM Sans', 'sans', '400;700'], ['Work Sans', 'sans', '400;700;900'], ['Rubik', 'sans', '400;700;900'], ['Figtree', 'sans', '400;700;900'],
  ['Mulish', 'sans', '400;800'], ['Plus Jakarta Sans', 'sans', '400;800'], ['Sora', 'sans', '400;700'], ['Archivo', 'sans', '400;800'],
  ['Source Sans 3', 'sans', '400;700'], ['IBM Plex Sans', 'sans', '400;700'], ['Fira Sans', 'sans', '400;700;900'], ['Raleway', 'sans', '400;700;900'],
  ['Space Grotesk', 'sans', '400;700'], ['Quicksand', 'sans', '500;700'], ['Comfortaa', 'sans', '400;700'], ['Kanit', 'sans', '400;700'],
  ['Fredoka', 'sans', '400;700'], ['Noto Sans', 'sans', '400;700'],
  // Display
  ['Oswald', 'display', '500;700'], ['Barlow', 'display', '400;700;900'], ['Barlow Condensed', 'display', '500;800'], ['Anton', 'display', '400'],
  ['Bebas Neue', 'display', '400'], ['Archivo Black', 'display', '400'], ['Alfa Slab One', 'display', '400'], ['Abril Fatface', 'display', '400'],
  // Serif
  ['Playfair Display', 'serif', '400;700;900'], ['Lora', 'serif', '400;700'], ['Merriweather', 'serif', '400;700;900'], ['DM Serif Display', 'serif', '400'],
  ['Libre Baskerville', 'serif', '400;700'], ['Roboto Slab', 'serif', '400;700;900'], ['Cormorant Garamond', 'serif', '500;700'],
  // Hand & mono
  ['Permanent Marker', 'hand', '400'], ['Pacifico', 'hand', '400'], ['JetBrains Mono', 'mono', '400;700'],
  // Arabic & Urdu
  ['Cairo', 'arabic', '400;700;900'], ['Tajawal', 'arabic', '400;700;900'], ['Almarai', 'arabic', '400;700;800'], ['Amiri', 'arabic', '400;700'],
  ['Noto Naskh Arabic', 'arabic', '400;700'], ['Noto Kufi Arabic', 'arabic', '400;700;900'], ['IBM Plex Sans Arabic', 'arabic', '400;700'],
  ['El Messiri', 'arabic', '400;700'], ['Markazi Text', 'arabic', '400;700'], ['Lalezar', 'arabic', '400'], ['Mada', 'arabic', '400;700;900'],
  ['Harmattan', 'arabic', '400;700'], ['Lateef', 'arabic', '400;700'], ['Scheherazade New', 'arabic', '400;700'], ['Baloo Bhaijaan 2', 'arabic', '400;800'],
  ['Aref Ruqaa', 'arabic', '400;700'], ['Noto Nastaliq Urdu', 'arabic', '400;700'],
];
export const FONT_CATS = [['sans', 'Sans'], ['display', 'Display'], ['serif', 'Serif'], ['hand', 'Hand'], ['mono', 'Mono'], ['arabic', 'Arabic & Urdu']];
export function fontsCssUrl() {
  const fam = FONTS.map(([n, , w]) => 'family=' + n.replace(/ /g, '+') + ':wght@' + w).join('&');
  return 'https://fonts.googleapis.com/css2?' + fam + '&display=swap';
}

/* Text styles (presets) */
export const TEXT_STYLES = [
  { id: 'plain', name: 'Plain', s: { color: '#ffffff', stroke: 0, shadow: 0, bg: null } },
  { id: 'shadow', name: 'Shadow', s: { color: '#ffffff', shadow: 0.6, shadowColor: '#000000' } },
  { id: 'outline', name: 'Outline', s: { color: '#ffffff', stroke: 0.12, strokeColor: '#000000' } },
  { id: 'thick', name: 'Bold outline', s: { color: '#ffd23f', stroke: 0.2, strokeColor: '#111111', weight: 900 } },
  { id: 'box', name: 'Box', s: { color: '#111111', bg: '#ffffff', bgPad: 0.35, bgRadius: 0.2 } },
  { id: 'boxdark', name: 'Dark box', s: { color: '#ffffff', bg: '#000000', bgAlpha: 0.65, bgPad: 0.35, bgRadius: 0.15 } },
  { id: 'tag', name: 'Tag', s: { color: '#111111', bg: '#d4f75a', bgPad: 0.3, bgRadius: 0.5, weight: 800 } },
  { id: 'line', name: 'Per line', s: { color: '#ffffff', bg: '#e8483b', bgPad: 0.25, bgRadius: 0.08, bgLines: true, weight: 800 } },
  { id: 'neon', name: 'Glow', s: { color: '#e9fff7', glow: 0.8, glowColor: '#29e0b4' } },
  { id: 'hollow', name: 'Hollow', s: { color: 'transparent', stroke: 0.08, strokeColor: '#ffffff' } },
  { id: 'lift', name: 'Lifted', s: { color: '#ffffff', shadow: 1, shadowColor: '#000000', shadowX: 0.08, shadowY: 0.08, shadowBlur: 0 } },
  { id: 'news', name: 'Lower third', s: { color: '#ffffff', bg: '#1d4ed8', bgPad: 0.3, bgRadius: 0, weight: 700, align: 'left' } },
];

/* Caption looks: per-word highlight etc. */
export const CAPTION_STYLES = [
  { id: 'clean', name: 'Clean', s: { color: '#ffffff', shadow: 0.7, shadowColor: '#000000', weight: 800 }, hl: null },
  { id: 'pop', name: 'Pop word', s: { color: '#ffffff', stroke: 0.14, strokeColor: '#000000', weight: 900 }, hl: { color: '#d4f75a', mode: 'color', scale: 1.12 } },
  { id: 'box', name: 'Word box', s: { color: '#ffffff', stroke: 0, shadow: 0.5, weight: 800 }, hl: { color: '#111111', bg: '#ffd23f', mode: 'box' } },
  { id: 'karaoke', name: 'Fill', s: { color: '#9aa0a6', weight: 800, shadow: 0.5 }, hl: { color: '#ffffff', mode: 'past' } },
  { id: 'bar', name: 'Subtitle bar', s: { color: '#ffffff', bg: '#000000', bgAlpha: 0.6, bgPad: 0.3, bgRadius: 0.12, weight: 600 }, hl: null },
  { id: 'single', name: 'One word', s: { color: '#ffffff', stroke: 0.16, strokeColor: '#000000', weight: 900 }, hl: { mode: 'single' } },
];
