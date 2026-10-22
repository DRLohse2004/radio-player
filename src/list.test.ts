import { describe, expect, it } from 'vitest';
import { moveTo } from './list';

const ids = (list: { id: string }[]) => list.map((x) => x.id).join('');
const abc = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

describe('moveTo', () => {
  it('verschiebt nach vorn, nach hinten und ans Ende', () => {
    expect(ids(moveTo(abc, 'c', 0))).toBe('cab');
    expect(ids(moveTo(abc, 'a', 2))).toBe('bac');
    expect(ids(moveTo(abc, 'a', 3))).toBe('bca');
  });

  it('lässt die Liste bei ungültigen Angaben unverändert', () => {
    expect(moveTo(abc, 'x', 0)).toBe(abc);
    expect(moveTo(abc, 'a', -1)).toBe(abc);
    expect(moveTo(abc, 'a', 4)).toBe(abc);
    expect(moveTo(abc, 'a', NaN)).toBe(abc);
  });
});
