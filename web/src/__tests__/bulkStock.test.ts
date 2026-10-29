import { describe, it, expect } from 'vitest';
import {
  getSingularForm,
  getPluralForm,
  formatUnitCount,
  formatUnitCountWords,
  formatBulkStock,
  formatBulkReorder,
} from '../bulkStock';

describe('bulkStock singular, plural, and zero grammar rules', () => {
  it('correctly derives singular form from singular or plural', () => {
    expect(getSingularForm('Box')).toBe('Box');
    expect(getSingularForm('Boxes')).toBe('Box');
    expect(getSingularForm('boxes')).toBe('box');
    expect(getSingularForm('Cartons')).toBe('Carton');
    expect(getSingularForm('carton')).toBe('carton');
    expect(getSingularForm('Bales')).toBe('Bale');
    expect(getSingularForm('Crates')).toBe('Crate');
    expect(getSingularForm('singles')).toBe('single');
    expect(getSingularForm('Pieces')).toBe('Piece');
    expect(getSingularForm('units')).toBe('unit');
    expect(getSingularForm('Bottles')).toBe('Bottle');
  });

  it('correctly derives plural form from singular or plural', () => {
    expect(getPluralForm('Box')).toBe('Boxes');
    expect(getPluralForm('box')).toBe('boxes');
    expect(getPluralForm('Boxes')).toBe('Boxes');
    expect(getPluralForm('Carton')).toBe('Cartons');
    expect(getPluralForm('cartons')).toBe('cartons');
    expect(getPluralForm('Bale')).toBe('Bales');
    expect(getPluralForm('Crate')).toBe('Crates');
    expect(getPluralForm('single')).toBe('singles');
    expect(getPluralForm('Piece')).toBe('Pieces');
    expect(getPluralForm('unit')).toBe('units');
  });

  it('formats unit counts with 1 singular, 0 plural, and >1 plural', () => {
    // Singular: 1
    expect(formatUnitCount(1, 'Box')).toBe('1 Box');
    expect(formatUnitCount(1, 'Boxes')).toBe('1 Box');
    expect(formatUnitCount(1, 'Carton')).toBe('1 Carton');
    expect(formatUnitCount(1, 'single')).toBe('1 single');
    expect(formatUnitCount(1, 'Piece')).toBe('1 Piece');

    // Plural: 2 or more
    expect(formatUnitCount(2, 'Box')).toBe('2 Boxes');
    expect(formatUnitCount(5, 'Carton')).toBe('5 Cartons');
    expect(formatUnitCount(3, 'single')).toBe('3 singles');

    // Plural: 0
    expect(formatUnitCount(0, 'Box')).toBe('0 Boxes');
    expect(formatUnitCount(0, 'Boxes')).toBe('0 Boxes');
    expect(formatUnitCount(0, 'Carton')).toBe('0 Cartons');
    expect(formatUnitCount(0, 'single')).toBe('0 singles');
    expect(formatUnitCount(0, 'Piece')).toBe('0 Pieces');
  });

  it('supports word representation for zero (zero boxes)', () => {
    expect(formatUnitCountWords(0, 'Box')).toBe('zero boxes');
    expect(formatUnitCountWords(1, 'Box')).toBe('1 box');
    expect(formatUnitCountWords(2, 'Box')).toBe('2 boxes');
  });

  it('formats bulk inventory stock correctly across zero, singular, and plural', () => {
    const pkg = [{ unit: 'Box', factor: 12 }];

    // Zero stock
    const zeroStock = formatBulkStock(0, pkg, 'Piece');
    expect(zeroStock.text).toBe('0 Boxes (0 Pieces)');
    expect(zeroStock.shortText).toBe('0 Boxes');

    // Exactly 1 full box, 0 singles
    const oneBox = formatBulkStock(12, pkg, 'Piece');
    expect(oneBox.text).toBe('1 Box (12 Pieces)');
    expect(oneBox.shortText).toBe('1 Box');

    // 2 full boxes, 0 singles
    const twoBoxes = formatBulkStock(24, pkg, 'Piece');
    expect(twoBoxes.text).toBe('2 Boxes (24 Pieces)');
    expect(twoBoxes.shortText).toBe('2 Boxes');

    // 1 full box, 1 single aside
    const oneBoxOneSingle = formatBulkStock(13, pkg, 'Piece');
    expect(oneBoxOneSingle.text).toBe('1 Box + 1 single (13 Pieces)');
    expect(oneBoxOneSingle.shortText).toBe('1 Box + 1 single');

    // 2 full boxes, 3 singles aside
    const twoBoxesThreeSingles = formatBulkStock(27, pkg, 'Piece');
    expect(twoBoxesThreeSingles.text).toBe('2 Boxes + 3 singles (27 Pieces)');
    expect(twoBoxesThreeSingles.shortText).toBe('2 Boxes + 3 singles');

    // Only 1 single aside (0 full boxes)
    const oneSingleOnly = formatBulkStock(1, pkg, 'Piece');
    expect(oneSingleOnly.text).toBe('1 Piece (1 single aside)');
    expect(oneSingleOnly.shortText).toBe('1 single');

    // 5 singles aside (0 full boxes)
    const fiveSinglesOnly = formatBulkStock(5, pkg, 'Piece');
    expect(fiveSinglesOnly.text).toBe('5 Pieces (5 singles aside)');
    expect(fiveSinglesOnly.shortText).toBe('5 singles');
  });
});
