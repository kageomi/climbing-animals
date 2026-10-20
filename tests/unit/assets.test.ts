import { describe, expect, it } from 'vitest';
import { EMOJI, parseSkin } from '../../src/assets';
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

  it('rejects malformed manifests', () => {
    expect(() => parseSkin(null, BASE)).toThrow();
    expect(() => parseSkin({ pixelated: 'yes' }, BASE)).toThrow();
    expect(() => parseSkin({ assets: { flag: 3 } }, BASE)).toThrow();
    expect(() => parseSkin({ assets: { 'platform.log': { left: 'l.png' } } }, BASE)).toThrow();
  });
});

describe('asset IDs', () => {
  it('cover every material and wall the world can produce', () => {
    for (const mat of Object.keys(MATERIALS)) expect(EMOJI).toHaveProperty([`platform.${mat}`]);
    for (const zone of ZONES) expect(EMOJI).toHaveProperty([`wall.${zone.wall}`]);
  });
});
