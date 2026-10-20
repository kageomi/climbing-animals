import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS script without types
import { outdated, renderAll } from '../../scripts/pixel-art.mjs';

const skin = JSON.parse(readFileSync('public/skins/pixel/skin.json', 'utf8'));

describe('pixel skin', () => {
  it('has PNGs matching their sources (run npm run art)', () => {
    expect(outdated()).toEqual([]);
  });

  it('only references files that exist', () => {
    const files = new Set(Object.keys(renderAll()));
    const refs: string[] = [];
    for (const v of Object.values(skin.assets)) refs.push(...(typeof v === 'string' ? [v] : Object.values(v as object)));
    for (const z of Object.values(skin.zones) as { backdrop?: { src: string }[] }[]) refs.push(...(z.backdrop ?? []).map((b) => b.src));
    expect(refs.filter((r) => !files.has(r))).toEqual([]);
  });
});
