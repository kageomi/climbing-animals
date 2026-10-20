import { drawEmoji, GLYPH_FILL } from './emoji';
import type { MaterialId, WallId } from './world';

/**
 * Everything the stage is drawn with. The game only knows these IDs; a skin
 * (public/skins/<name>/skin.json) maps them to image files. Anything a skin
 * leaves out, or that fails to load, is drawn as its emoji instead.
 */
export type AssetId =
  | `platform.${MaterialId}`
  | `wall.${WallId}`
  | 'hazard.bee'
  | 'hazard.cactus'
  | 'flag'
  | 'flag.reached'
  | 'water.wave';

export const EMOJI: Record<AssetId, string> = {
  'platform.log': '🪵',
  'platform.lotus': '🪷',
  'platform.leaf': '🍃',
  'platform.mushroom': '🍄',
  'platform.rock': '🪨',
  'platform.ice': '🧊',
  'platform.cloud': '☁️',
  'platform.star': '🌟',
  'wall.reeds': '🌾',
  'wall.forest': '🌲',
  'wall.mountain': '🪨',
  'wall.sky': '☁️',
  'hazard.bee': '🐝',
  'hazard.cactus': '🌵',
  flag: '🚩',
  'flag.reached': '🏁',
  'water.wave': '🌊',
};

export const DEFAULT_SKIN = 'default';

/** Images for one asset. Rows (platforms) use left/right as end caps; single sprites only `mid`. */
interface Pieces<T> {
  left: T;
  mid: T;
  right: T;
}

export interface Skin {
  /** Pixel art: scale images with nearest-neighbour instead of smoothing. */
  pixelated: boolean;
  /** Absolute image URLs per asset. */
  files: Map<AssetId, Pieces<string>>;
  /** Keys in the manifest that aren't asset IDs (typos, removed assets). */
  ignored: string[];
}

/**
 * Validates a skin.json and resolves its file names against `base` (the skin's folder URL).
 * An asset is a file name, or `{ "left"?, "mid", "right"? }` for rows with end caps.
 */
export function parseSkin(json: unknown, base: string): Skin {
  if (typeof json !== 'object' || json === null) throw new Error('skin.json must be an object');
  const { pixelated = false, assets = {} } = json as { pixelated?: unknown; assets?: unknown };
  if (typeof pixelated !== 'boolean') throw new Error('"pixelated" must be true or false');
  if (typeof assets !== 'object' || assets === null) throw new Error('"assets" must be an object');

  const url = (file: unknown, key: string): string => {
    if (typeof file !== 'string' || file === '') throw new Error(`"${key}" needs a file name`);
    return new URL(file, base).href;
  };
  const files = new Map<AssetId, Pieces<string>>();
  const ignored: string[] = [];
  for (const [key, value] of Object.entries(assets)) {
    if (!(key in EMOJI)) {
      ignored.push(key);
      continue;
    }
    if (typeof value === 'object' && value !== null) {
      const { left, mid, right } = value as Record<string, unknown>;
      const m = url(mid, `${key}.mid`);
      files.set(key as AssetId, {
        left: left === undefined ? m : url(left, `${key}.left`),
        mid: m,
        right: right === undefined ? m : url(right, `${key}.right`),
      });
    } else {
      const m = url(value, key);
      files.set(key as AssetId, { left: m, mid: m, right: m });
    }
  }
  return { pixelated, files, ignored };
}

interface Picture {
  src: CanvasImageSource;
  /** Height / width. */
  aspect: number;
}

/** SVGs are rasterised once at this width; drawing a canvas is much cheaper than an SVG every frame. */
const SVG_RASTER_PX = 128;

let pixelated = false;
const pictures = new Map<AssetId, Pieces<Picture>>();
const byUrl = new Map<string, Promise<Picture>>();

/** Loads public/skins/<name>/skin.json and its images. Never throws: missing parts stay emojis. */
export async function loadSkin(name: string): Promise<void> {
  const base = new URL(`skins/${name}/`, document.baseURI).href;
  let skin: Skin;
  try {
    const res = await fetch(base + 'skin.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    skin = parseSkin(await res.json(), base);
  } catch (e) {
    console.warn(`Skin "${name}" not loaded, drawing emojis:`, e);
    return;
  }
  if (skin.ignored.length) console.warn(`Skin "${name}": unknown assets ignored:`, skin.ignored);
  pixelated = skin.pixelated;
  pictures.clear();
  await Promise.all(
    [...skin.files].map(async ([id, urls]) => {
      try {
        const [left, mid, right] = await Promise.all([urls.left, urls.mid, urls.right].map(loadPicture));
        pictures.set(id, { left, mid, right });
      } catch (e) {
        console.warn(`Asset ${id} not loaded, drawing ${EMOJI[id]}:`, e);
      }
    }),
  );
}

/** Assets currently drawn from images rather than emojis. */
export function loadedAssets(): AssetId[] {
  return [...pictures.keys()];
}

function loadPicture(url: string): Promise<Picture> {
  let p = byUrl.get(url);
  if (p) return p;
  p = (async () => {
    const img = new Image();
    img.src = url;
    await img.decode();
    // SVGs without width/height report 0: assume square.
    const w = img.naturalWidth || 1;
    const aspect = img.naturalHeight / w || 1;
    if (!/\.svg($|\?)/i.test(url)) return { src: img, aspect };
    const c = document.createElement('canvas');
    c.width = SVG_RASTER_PX;
    c.height = Math.round(SVG_RASTER_PX * aspect);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return { src: c, aspect };
  })();
  byUrl.set(url, p);
  // A failed load may succeed on the next skin load.
  p.catch(() => byUrl.delete(url));
  return p;
}

function drawPicture(g: CanvasRenderingContext2D, p: Picture, x: number, y: number, size: number): void {
  const h = size * p.aspect;
  const smooth = g.imageSmoothingEnabled;
  g.imageSmoothingEnabled = !pixelated;
  g.drawImage(p.src, x - size / 2, y - h / 2, size, h);
  g.imageSmoothingEnabled = smooth;
}

/** Draws an asset centred at (x, y), `size` world units wide (an emoji's glyph spans about the same). */
export function drawAsset(g: CanvasRenderingContext2D, id: AssetId, x: number, y: number, size: number): void {
  const p = pictures.get(id);
  if (p) drawPicture(g, p.mid, x, y, size);
  else drawEmoji(g, EMOJI[id], x, y, size / GLYPH_FILL);
}

/** Draws `tiles` tiles of `size` side by side centred at (x, y), with end caps if the skin has them. */
export function drawRow(g: CanvasRenderingContext2D, id: AssetId, x: number, y: number, tiles: number, size: number): void {
  const p = pictures.get(id);
  const x0 = x - ((tiles - 1) / 2) * size;
  for (let i = 0; i < tiles; i++) {
    const cx = x0 + i * size;
    if (!p) drawEmoji(g, EMOJI[id], cx, y, size / GLYPH_FILL);
    else drawPicture(g, tiles === 1 ? p.mid : i === 0 ? p.left : i === tiles - 1 ? p.right : p.mid, cx, y, size);
  }
}
