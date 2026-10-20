import { describe, expect, it } from 'vitest';
import { DEFAULT_LOOK, EMOJI, parseSkin } from '../../src/assets';
import { MATERIALS, ZONES } from '../../src/world';

const BASE = 'https://example.test/skins/pixel/';

describe('parseSkin', () => {
  it('resolves file names against the skin folder', () => {
    const skin = parseSkin({ assets: { 'hazard.bee': 'bee.png', flag: '../shared/flag.svg' } }, BASE);
    expect(skin.files.get('hazard.bee')?.mid).toBe(BASE + 'bee.png');
    expect(skin.files.get('flag')?.mid).toBe('https://example.test/skins/shared/flag.svg');
    expect(skin.pixelated).toBe(false);
  });

  it('uses the middle piece for missing end caps', () => {
    const skin = parseSkin({ pixelated: true, assets: { 'platform.log': { left: 'l.png', mid: 'm.png' } } }, BASE);
    expect(skin.pixelated).toBe(true);
    expect(skin.files.get('platform.log')).toEqual({ left: BASE + 'l.png', mid: BASE + 'm.png', right: BASE + 'm.png' });
  });

  it('ignores unknown asset IDs instead of failing', () => {
    const skin = parseSkin({ assets: { 'platform.lava': 'lava.png', 'water.wave': 'wave.png' } }, BASE);
    expect(skin.ignored).toEqual(['platform.lava']);
    expect([...skin.files.keys()]).toEqual(['water.wave']);
  });

  it('reads lights, zone looks and water, keeping defaults for the rest', () => {
    const skin = parseSkin(
      {
        pixelsPerTile: 16,
        lights: { animal: { color: '#ffeeaa', radius: 3 }, 'platform.lotus': { color: '#ff88aa' }, glow: {} },
        zones: { pond: { sky: ['#000000', '#111111'], ambient: '#555555', backdrop: [{ src: 'far.png', parallax: 0.3 }] } },
        water: { reflection: true },
      },
      BASE,
    );
    expect(skin.pixelsPerTile).toBe(16);
    expect(skin.lights.animal).toEqual({ color: '#ffeeaa', radius: 3 });
    expect(skin.lights['platform.lotus']).toEqual({ color: '#ff88aa', radius: 2 });
    expect(skin.ignored).toEqual(['lights.glow']);
    expect(skin.zones.pond).toEqual({
      sky: ['#000000', '#111111'],
      ambient: '#555555',
      backdrop: [{ image: BASE + 'far.png', parallax: 0.3 }],
      fireflies: 0,
    });
    expect(skin.zones.forest).toEqual(DEFAULT_LOOK.zones.forest);
    expect(skin.water).toEqual({ color: DEFAULT_LOOK.water.color, reflection: true });
  });

  it('rejects malformed manifests', () => {
    expect(() => parseSkin(null, BASE)).toThrow();
    expect(() => parseSkin({ pixelated: 'yes' }, BASE)).toThrow();
    expect(() => parseSkin({ assets: { flag: 3 } }, BASE)).toThrow();
    expect(() => parseSkin({ assets: { 'platform.log': { left: 'l.png' } } }, BASE)).toThrow();
    expect(() => parseSkin({ zones: { pond: { sky: '#000' } } }, BASE)).toThrow();
    expect(() => parseSkin({ lights: { animal: { radius: 'big' } } }, BASE)).toThrow();
  });
});

describe('asset IDs', () => {
  it('cover every material and wall the world can produce', () => {
    for (const mat of Object.keys(MATERIALS)) expect(EMOJI).toHaveProperty([`platform.${mat}`]);
    for (const zone of ZONES) expect(EMOJI).toHaveProperty([`wall.${zone.id}`]);
  });
});
