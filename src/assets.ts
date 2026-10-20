import { drawEmoji, GLYPH_FILL, pixelSprite } from './emoji';
import type { MaterialId, ZoneId } from './world';

/**
 * Everything the stage is drawn with. The game only knows these IDs; a skin
 * (public/skins/<name>/skin.json) maps them to image files. Anything a skin
 * leaves out, or that fails to load, is drawn as its emoji instead.
 */
export type AssetId =
  | `platform.${MaterialId}`
  | `wall.${ZoneId}`
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
  'wall.pond': '🌾',
  'wall.forest': '🌲',
  'wall.mountain': '🪨',
  'wall.sky': '☁️',
  'hazard.bee': '🐝',
  'hazard.cactus': '🌵',
  flag: '🚩',
  'flag.reached': '🏁',
  'water.wave': '🌊',
};

/** Things that can glow: the animals, fireflies and any stage asset. */
export type LightSource = 'animal' | 'firefly' | AssetId;

export interface Light {
  color: string;
  /** In tiles. */
  radius: number;
}

export interface Layer<I> {
  image: I;
  /** 0 = fixed to the screen, 1 = moves with the world. */
  parallax: number;
}

export interface ZoneLook<I> {
  sky: [string, string];
  /** Light level away from any light; omitted = no lighting (full brightness). */
  ambient?: string;
  /** Backdrop images behind the stage, back to front; each repeats in both directions. */
  backdrop: Layer<I>[];
  /** Fireflies per 10 m of height. */
  fireflies: number;
}

export interface Look<I> {
  /** Pixel art: scale images with nearest-neighbour instead of smoothing. */
  pixelated: boolean;
  /**
   * > 0: the whole scene is drawn into a low-resolution buffer with this many
   * pixels per tile and scaled up, so everything shares one pixel grid.
   */
  pixelsPerTile: number;
  lights: Partial<Record<LightSource, Light>>;
  zones: Record<ZoneId, ZoneLook<I>>;
  water: {
    color: string;
    /** Mirror the scene above in the water (pixel mode only). */
    reflection: boolean;
  };
}

/** Skin as parsed from skin.json: images are still URLs. */
export interface Skin extends Look<string> {
  /** Absolute image URLs per asset. */
  files: Map<AssetId, Pieces<string>>;
  /** Keys in the manifest that aren't known IDs (typos, removed assets). */
  ignored: string[];
}

/** Images for one asset. Rows (platforms) use left/right as end caps; single sprites only `mid`. */
interface Pieces<T> {
  left: T;
  mid: T;
  right: T;
}

export interface Picture {
  src: CanvasImageSource;
  /** Natural size in pixels. */
  w: number;
  h: number;
}

export const DEFAULT_SKIN = 'default';

const plainZone = (sky: [string, string]): ZoneLook<never> => ({ sky, backdrop: [], fireflies: 0 });

/** The emoji look: what a skin starts from. */
export const DEFAULT_LOOK: Look<never> = {
  pixelated: false,
  pixelsPerTile: 0,
  lights: {},
  zones: {
    pond: plainZone(['#7ec8e3', '#bfe6c9']),
    forest: plainZone(['#6fb98f', '#cde8b0']),
    mountain: plainZone(['#8aa4c8', '#e3e8f0']),
    sky: plainZone(['#1d2b64', '#6a7fd0']),
  },
  water: { color: 'rgba(40, 120, 200, 0.55)', reflection: false },
};

const ZONE_IDS = Object.keys(DEFAULT_LOOK.zones) as ZoneId[];

type Json = Record<string, unknown>;

function object(v: unknown, what: string): Json {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error(`${what} must be an object`);
  return v as Json;
}

function typed<T>(v: unknown, type: 'string' | 'number' | 'boolean', what: string, fallback: T): T {
  if (v === undefined) return fallback;
  if (typeof v !== type) throw new Error(`${what} must be a ${type}`);
  return v as T;
}

/**
 * Validates a skin.json and resolves its file names against `base` (the skin's
 * folder URL). Everything is optional; see DEFAULT_LOOK and docs/GAME_DESIGN.md.
 * An asset is a file name, or `{ "left"?, "mid", "right"? }` for rows with end caps.
 */
export function parseSkin(json: unknown, base: string): Skin {
  const root = object(json, 'skin.json');
  const ignored: string[] = [];
  const url = (file: unknown, what: string): string => {
    if (typeof file !== 'string' || file === '') throw new Error(`${what} needs a file name`);
    return new URL(file, base).href;
  };

  const files = new Map<AssetId, Pieces<string>>();
  for (const [key, value] of Object.entries(object(root.assets ?? {}, '"assets"'))) {
    if (!(key in EMOJI)) {
      ignored.push(key);
      continue;
    }
    if (typeof value === 'object' && value !== null) {
      const { left, mid, right } = value as Json;
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

  const lights: Partial<Record<LightSource, Light>> = {};
  for (const [key, value] of Object.entries(object(root.lights ?? {}, '"lights"'))) {
    if (key !== 'animal' && key !== 'firefly' && !(key in EMOJI)) {
      ignored.push(`lights.${key}`);
      continue;
    }
    const l = object(value, `lights.${key}`);
    lights[key as LightSource] = {
      color: typed(l.color, 'string', `lights.${key}.color`, '#ffffff'),
      radius: typed(l.radius, 'number', `lights.${key}.radius`, 2),
    };
  }

  const zones = { ...DEFAULT_LOOK.zones } as Record<ZoneId, ZoneLook<string>>;
  for (const [key, value] of Object.entries(object(root.zones ?? {}, '"zones"'))) {
    if (!ZONE_IDS.includes(key as ZoneId)) {
      ignored.push(`zones.${key}`);
      continue;
    }
    const z = object(value, `zones.${key}`);
    const sky = z.sky ?? zones[key as ZoneId].sky;
    if (!Array.isArray(sky) || sky.length !== 2 || sky.some((c) => typeof c !== 'string')) {
      throw new Error(`zones.${key}.sky must be two colours`);
    }
    const backdrop = z.backdrop ?? [];
    if (!Array.isArray(backdrop)) throw new Error(`zones.${key}.backdrop must be a list`);
    zones[key as ZoneId] = {
      sky: sky as [string, string],
      ambient: typed<string | undefined>(z.ambient, 'string', `zones.${key}.ambient`, undefined),
      backdrop: backdrop.map((b, i) => {
        const layer = object(b, `zones.${key}.backdrop[${i}]`);
        return {
          image: url(layer.src, `zones.${key}.backdrop[${i}].src`),
          parallax: typed(layer.parallax, 'number', `zones.${key}.backdrop[${i}].parallax`, 0.5),
        };
      }),
      fireflies: typed(z.fireflies, 'number', `zones.${key}.fireflies`, 0),
    };
  }

  const water = object(root.water ?? {}, '"water"');
  return {
    pixelated: typed(root.pixelated, 'boolean', '"pixelated"', false),
    pixelsPerTile: typed(root.pixelsPerTile, 'number', '"pixelsPerTile"', 0),
    lights,
    zones,
    water: {
      color: typed(water.color, 'string', 'water.color', DEFAULT_LOOK.water.color),
      reflection: typed(water.reflection, 'boolean', 'water.reflection', false),
    },
    files,
    ignored,
  };
}

/** SVGs are rasterised once at this width; drawing a canvas is much cheaper than an SVG every frame. */
const SVG_RASTER_PX = 128;

let look: Look<Picture> = DEFAULT_LOOK;
const pictures = new Map<AssetId, Pieces<Picture>>();
const byUrl = new Map<string, Promise<Picture>>();

/** How the current skin wants the scene drawn. */
export function currentLook(): Look<Picture> {
  return look;
}

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
  if (skin.ignored.length) console.warn(`Skin "${name}": unknown keys ignored:`, skin.ignored);

  const zones = {} as Record<ZoneId, ZoneLook<Picture>>;
  for (const id of ZONE_IDS) {
    const z = skin.zones[id];
    const layers = await Promise.all(
      z.backdrop.map((l) =>
        loadPicture(l.image).then(
          (image) => ({ image, parallax: l.parallax }),
          (e) => console.warn(`Backdrop ${l.image} not loaded:`, e),
        ),
      ),
    );
    zones[id] = { ...z, backdrop: layers.filter((l): l is Layer<Picture> => !!l) };
  }

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
  const { files: _files, ignored: _ignored, ...rest } = skin;
  look = { ...rest, zones };
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
    const h = img.naturalHeight || w;
    if (!/\.svg($|\?)/i.test(url)) return { src: img, w, h };
    const c = document.createElement('canvas');
    c.width = SVG_RASTER_PX;
    c.height = Math.round((SVG_RASTER_PX * h) / w);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return { src: c, w, h };
  })();
  byUrl.set(url, p);
  // A failed load may succeed on the next skin load.
  p.catch(() => byUrl.delete(url));
  return p;
}

function drawPicture(g: CanvasRenderingContext2D, p: Picture, x: number, y: number, size: number, flip: boolean): void {
  const h = (size * p.h) / p.w;
  const smooth = g.imageSmoothingEnabled;
  g.imageSmoothingEnabled = !look.pixelated;
  if (flip) {
    g.save();
    g.translate(x, y);
    g.scale(-1, 1);
    g.drawImage(p.src, -size / 2, -h / 2, size, h);
    g.restore();
  } else {
    g.drawImage(p.src, x - size / 2, y - h / 2, size, h);
  }
  g.imageSmoothingEnabled = smooth;
}

function drawFallback(g: CanvasRenderingContext2D, id: AssetId, x: number, y: number, size: number): void {
  const s = size / GLYPH_FILL;
  if (look.pixelsPerTile <= 0) return drawEmoji(g, EMOJI[id], x, y, s);
  // Keep emojis on the pixel grid too, at the same pixel density as the art.
  const smooth = g.imageSmoothingEnabled;
  g.imageSmoothingEnabled = false;
  g.drawImage(pixelSprite(EMOJI[id], Math.round((s * look.pixelsPerTile) / size)), x - s / 2, y - s / 2, s, s);
  g.imageSmoothingEnabled = smooth;
}

/** Draws an asset centred at (x, y), `size` world units wide (an emoji's glyph spans about the same). */
export function drawAsset(g: CanvasRenderingContext2D, id: AssetId, x: number, y: number, size: number, flip = false): void {
  const p = pictures.get(id);
  if (p) drawPicture(g, p.mid, x, y, size, flip);
  else drawFallback(g, id, x, y, size);
}

/** Draws `tiles` tiles of `size` side by side centred at (x, y), with end caps if the skin has them. */
export function drawRow(g: CanvasRenderingContext2D, id: AssetId, x: number, y: number, tiles: number, size: number): void {
  const p = pictures.get(id);
  const x0 = x - ((tiles - 1) / 2) * size;
  for (let i = 0; i < tiles; i++) {
    const cx = x0 + i * size;
    if (!p) drawFallback(g, id, cx, y, size);
    else drawPicture(g, tiles === 1 ? p.mid : i === 0 ? p.left : i === tiles - 1 ? p.right : p.mid, cx, y, size, false);
  }
}
