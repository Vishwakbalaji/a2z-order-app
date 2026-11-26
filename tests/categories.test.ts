import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { AppDB, useDb } from '../src/db/db';
import * as S from '../src/state/store';
import { LATEST_BUNDLED_VERSION } from '../src/data/bundled';
import { BUNDLED_VERSION } from '../src/data/bundledVersion';
import { niceLabel } from '../src/lib/categories';
import { search } from '../src/lib/search';

describe('categories from the price sheet', () => {
  it('BUNDLED_VERSION matches the bundled datasets', () => expect(BUNDLED_VERSION).toBe(LATEST_BUNDLED_VERSION));

  it('sections, then the price sheet brand headings in price-sheet order; every product in exactly one place', async () => {
    useDb(new AppDB('cats-1'));
    await S.init();
    const s = S.getState();
    expect(s.departments).toEqual(['WATER', 'SODA', 'SPORTS DRINKS', 'JUICES', 'SHOPPING BAGS', 'ENERGY ENHANCER / DRINKS', 'MILK']);
    expect(s.subsByDept.get('SODA')!.slice(0, 4)).toEqual(['Coke / Fanta / Sprite & Flavors', 'Pepsi / Dew / Dr Pepper', 'Ginger Ale / 7UP / A&W', 'Sunkist / Crush']);
    expect(s.subsByDept.get('SPORTS DRINKS')).toEqual(['Gatorade', 'Powerade', 'Electrolit', 'Vitamin Water', 'BodyArmor']);
    expect(s.subsByDept.get('SODA')).toContain('Schweppes');
    const byCat = (cat: string) => s.browseIds.filter((id) => s.subOf.get(id) === cat).map((id) => s.productById.get(id)!.category);
    expect(new Set(byCat('Coke / Fanta / Sprite & Flavors'))).toEqual(new Set(['Coke', 'Sprite', 'Fanta']));
    expect(new Set(byCat('Ginger Ale / 7UP / A&W'))).toEqual(new Set(['Canada Dry', '7UP', 'AW']));
    for (const id of s.browseIds) expect(s.subOf.get(id), id).toBeTruthy();
    // the list is ordered section by section, heading by heading (no heading appears twice)
    const seen: string[] = [];
    for (const id of s.browseIds) {
      const k = `${s.productById.get(id)!.department}|${s.subOf.get(id)}`;
      if (seen[seen.length - 1] !== k) {
        expect(seen, k).not.toContain(k);
        seen.push(k);
      }
    }
    // searching by name inside a category and across all
    const soda = s.browseIds.filter((id) => s.productById.get(id)!.department === 'SODA');
    expect(search('pepsi 2l', soda, s.index).length).toBeGreaterThan(0);
    expect(search('gatorade', soda, s.index)).toHaveLength(0);
    expect(search('gatorade 28', s.browseIds, s.index).length).toBe(12); // the 12 Gatorade 28 oz flavors
  });

  it('labels read well', () => {
    expect(niceLabel('COKE / FANTA / SPRITE & FLAVORS')).toBe('Coke / Fanta / Sprite & Flavors');
    expect(niceLabel('GINGER ALE / 7UP / A&W')).toBe('Ginger Ale / 7UP / A&W');
    expect(niceLabel('D&G')).toBe('D&G');
    expect(niceLabel('Topo Chico')).toBe('Topo Chico');
  });
});
