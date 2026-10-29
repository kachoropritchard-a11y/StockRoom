/**
 * Standard Bulk Packaging & Singular / Plural English Grammar Utility.
 * Formats inventory quantities with bulk units first and single units second.
 *
 * Rules:
 *  - count === 1: singular form (e.g. "1 Box", "1 Carton", "1 single", "1 piece")
 *  - count === 0: plural form (e.g. "0 Boxes", "zero boxes", "0 Cartons", "0 singles")
 *  - count >= 2 or negative: plural form (e.g. "2 Boxes", "5 Cartons", "2 singles")
 */

export function preserveCase(original: string, target: string): string {
  if (!original) return target;
  if (original === original.toUpperCase()) return target.toUpperCase();
  if (original[0] === original[0].toUpperCase()) {
    return target.charAt(0).toUpperCase() + target.slice(1);
  }
  return target.toLowerCase();
}

/**
 * Normalizes any noun (singular or plural) into its singular form.
 */
export function getSingularForm(word: string): string {
  if (!word) return '';
  const trimmed = word.trim();
  const lower = trimmed.toLowerCase();

  // Known irregulars / special plurals ending in -es / -ies / -ves
  if (lower === 'boxes') return preserveCase(trimmed, 'box');
  if (lower === 'inches') return preserveCase(trimmed, 'inch');
  if (lower === 'dishes') return preserveCase(trimmed, 'dish');
  if (lower === 'glasses') return preserveCase(trimmed, 'glass');
  if (lower === 'watches') return preserveCase(trimmed, 'watch');
  if (lower === 'batches') return preserveCase(trimmed, 'batch');
  if (lower === 'pantries') return preserveCase(trimmed, 'pantry');
  if (lower === 'categories') return preserveCase(trimmed, 'category');
  if (lower === 'shelves') return preserveCase(trimmed, 'shelf');
  if (lower === 'loaves') return preserveCase(trimmed, 'loaf');
  if (lower === 'knives') return preserveCase(trimmed, 'knife');
  if (lower === 'cases') return preserveCase(trimmed, 'case');
  if (lower === 'crates') return preserveCase(trimmed, 'crate');
  if (lower === 'bales') return preserveCase(trimmed, 'bale');
  if (lower === 'cartons') return preserveCase(trimmed, 'carton');
  if (lower === 'packs') return preserveCase(trimmed, 'pack');
  if (lower === 'packages') return preserveCase(trimmed, 'package');
  if (lower === 'pieces') return preserveCase(trimmed, 'piece');
  if (lower === 'units') return preserveCase(trimmed, 'unit');
  if (lower === 'singles') return preserveCase(trimmed, 'single');
  if (lower === 'bottles') return preserveCase(trimmed, 'bottle');

  // Words ending in -boxes, -watches, -dishes, -glasses
  if (lower.endsWith('boxes')) return trimmed.slice(0, -2);
  if (lower.endsWith('watches') || lower.endsWith('dishes') || lower.endsWith('inches')) return trimmed.slice(0, -2);
  if (lower.endsWith('glasses')) return trimmed.slice(0, -2);

  // Consonant + ies (e.g. berries -> berry)
  if (lower.endsWith('ies') && lower.length > 3) {
    const isUpper = trimmed === trimmed.toUpperCase();
    return trimmed.slice(0, -3) + (isUpper ? 'Y' : 'y');
  }

  // -ves (e.g. shelves -> shelf)
  if (lower.endsWith('ves') && lower.length > 3) {
    const isUpper = trimmed === trimmed.toUpperCase();
    return trimmed.slice(0, -3) + (isUpper ? 'F' : 'f');
  }

  // Regular -s ending (excluding words ending in -ss like 'glass' or -us like 'status')
  if (lower.endsWith('s') && !lower.endsWith('ss') && !lower.endsWith('us') && lower.length > 1) {
    return trimmed.slice(0, -1);
  }

  return trimmed;
}

/**
 * Returns the grammatically correct plural form of a noun.
 */
export function getPluralForm(word: string): string {
  if (!word) return '';
  const singular = getSingularForm(word);
  const lower = singular.toLowerCase();

  // Known irregulars
  if (lower === 'box') return preserveCase(singular, 'boxes');
  if (lower === 'inch') return preserveCase(singular, 'inches');
  if (lower === 'dish') return preserveCase(singular, 'dishes');
  if (lower === 'glass') return preserveCase(singular, 'glasses');
  if (lower === 'watch') return preserveCase(singular, 'watches');
  if (lower === 'batch') return preserveCase(singular, 'batches');
  if (lower === 'shelf') return preserveCase(singular, 'shelves');
  if (lower === 'loaf') return preserveCase(singular, 'loaves');
  if (lower === 'knife') return preserveCase(singular, 'knives');
  if (lower === 'pantry') return preserveCase(singular, 'pantries');
  if (lower === 'category') return preserveCase(singular, 'categories');

  // Words ending in s, ss, sh, ch, x, z
  if (
    lower.endsWith('s') ||
    lower.endsWith('sh') ||
    lower.endsWith('ch') ||
    lower.endsWith('x') ||
    lower.endsWith('z')
  ) {
    const isUpper = singular === singular.toUpperCase();
    return singular + (isUpper ? 'ES' : 'es');
  }

  // Consonant + y -> ies
  if (lower.endsWith('y') && lower.length > 1 && !'aeiou'.includes(lower[lower.length - 2])) {
    const isUpper = singular === singular.toUpperCase();
    return singular.slice(0, -1) + (isUpper ? 'IES' : 'ies');
  }

  // Words ending in f / fe -> ves
  if (lower.endsWith('fe')) {
    const isUpper = singular === singular.toUpperCase();
    return singular.slice(0, -2) + (isUpper ? 'VES' : 'ves');
  }
  if (lower.endsWith('f') && lower !== 'roof' && lower !== 'cliff') {
    const isUpper = singular === singular.toUpperCase();
    return singular.slice(0, -1) + (isUpper ? 'VES' : 'ves');
  }

  // Default: +s
  const isUpper = singular === singular.toUpperCase();
  return singular + (isUpper ? 'S' : 's');
}

/**
 * Formats a count with its noun obeying singular, plural, and zero rules.
 *  - count === 1: "1 Box", "1 Carton", "1 single", "1 piece"
 *  - count === 0: "0 Boxes", "0 Cartons", "0 singles", "0 pieces"
 *  - count >= 2 or negative: "2 Boxes", "5 Cartons", "3 singles"
 */
export function formatUnitCount(count: number, unitLabel: string): string {
  const rounded = Math.round(count * 1000) / 1000;
  const abs = Math.abs(rounded);
  const formattedNum = rounded.toLocaleString();

  if (abs === 1) {
    return `${formattedNum} ${getSingularForm(unitLabel)}`;
  }
  return `${formattedNum} ${getPluralForm(unitLabel)}`;
}

/**
 * Returns written word form for zero or singular (e.g. "zero boxes", "1 box", "2 boxes")
 */
export function formatUnitCountWords(count: number, unitLabel: string): string {
  const rounded = Math.round(count * 1000) / 1000;
  if (rounded === 0) {
    return `zero ${getPluralForm(unitLabel).toLowerCase()}`;
  }
  if (rounded === 1) {
    return `1 ${getSingularForm(unitLabel).toLowerCase()}`;
  }
  return `${rounded.toLocaleString()} ${getPluralForm(unitLabel).toLowerCase()}`;
}

export interface BulkStockBreakdown {
  fullPacks: number;
  singles: number;
  packUnit?: string;
  baseUnit: string;
  hasBulkPackaging: boolean;
  factor: number;
  text: string;
  shortText: string;
}

/**
 * Standardized bulk stock representation.
 * Always formats as Bulk First, Single Units Second with accurate plural/singular grammar.
 */
export function formatBulkStock(
  totalStock: number,
  packagings?: { unit: string; factor: number }[],
  baseUnit = 'units'
): BulkStockBreakdown {
  const roundedTotal = Math.round(totalStock * 1000) / 1000;
  if (!packagings || packagings.length === 0 || !packagings[0].factor || packagings[0].factor <= 1) {
    return {
      fullPacks: 0,
      singles: roundedTotal,
      baseUnit,
      hasBulkPackaging: false,
      factor: 1,
      text: formatUnitCount(roundedTotal, baseUnit),
      shortText: formatUnitCount(roundedTotal, baseUnit),
    };
  }

  const pkg = packagings[0];
  const factor = pkg.factor;
  const isNeg = roundedTotal < 0;
  const roundedAbs = Math.abs(roundedTotal);
  const fullPacks = Math.floor(roundedAbs / factor);
  const singles = Math.round((roundedAbs % factor) * 1000) / 1000;
  const sign = isNeg ? '-' : '';

  if (roundedTotal === 0) {
    const pluralPack = getPluralForm(pkg.unit);
    const pluralBase = getPluralForm(baseUnit);
    return {
      fullPacks: 0,
      singles: 0,
      packUnit: pkg.unit,
      baseUnit,
      hasBulkPackaging: true,
      factor,
      text: `0 ${pluralPack} (0 ${pluralBase})`,
      shortText: `0 ${pluralPack}`,
    };
  }

  if (fullPacks === 0) {
    const singleCount = isNeg ? -singles : singles;
    const singleLabel = formatUnitCount(singles, 'single');
    const baseLabel = formatUnitCount(singles, baseUnit);
    return {
      fullPacks: 0,
      singles: singleCount,
      packUnit: pkg.unit,
      baseUnit,
      hasBulkPackaging: true,
      factor,
      text: `${sign}${baseLabel} (${sign}${singleLabel} aside)`,
      shortText: `${sign}${singleLabel}`,
    };
  }

  if (singles === 0) {
    const packCount = isNeg ? -fullPacks : fullPacks;
    const packLabel = formatUnitCount(fullPacks, pkg.unit);
    const baseLabel = formatUnitCount(roundedAbs, baseUnit);
    return {
      fullPacks: packCount,
      singles: 0,
      packUnit: pkg.unit,
      baseUnit,
      hasBulkPackaging: true,
      factor,
      text: `${sign}${packLabel} (${sign}${baseLabel})`,
      shortText: `${sign}${packLabel}`,
    };
  }

  const packCount = isNeg ? -fullPacks : fullPacks;
  const packLabel = formatUnitCount(fullPacks, pkg.unit);
  const singleLabel = formatUnitCount(singles, 'single');
  const baseLabel = formatUnitCount(roundedAbs, baseUnit);

  return {
    fullPacks: packCount,
    singles: isNeg ? -singles : singles,
    packUnit: pkg.unit,
    baseUnit,
    hasBulkPackaging: true,
    factor,
    text: `${sign}${packLabel} + ${singleLabel} (${sign}${baseLabel})`,
    shortText: `${sign}${packLabel} + ${singleLabel}`,
  };
}

export function formatBulkReorder(
  reorderLevel: number,
  packagings?: { unit: string; factor: number }[],
  baseUnit = 'units'
): string {
  if (reorderLevel <= 0) return `0 (No Reorder Threshold)`;
  const b = formatBulkStock(reorderLevel, packagings, baseUnit);
  return b.text;
}

export function computeIntakeBreakdown(opts: {
  fullPacks: number;
  looseSingles: number;
  factor: number;
  bulkPackCost: number;
  packUnit: string;
  baseUnit: string;
}) {
  const factor = Math.max(1, opts.factor);
  const fullPacks = Math.max(0, Math.floor(opts.fullPacks));
  const looseSingles = Math.max(0, opts.looseSingles);
  const totalBaseUnits = fullPacks * factor + looseSingles;

  const costPerSingle = opts.bulkPackCost > 0 ? opts.bulkPackCost / factor : 0;
  const totalCost = fullPacks * opts.bulkPackCost + looseSingles * costPerSingle;

  const packFormatted = formatUnitCount(fullPacks, opts.packUnit);
  const looseFormatted = looseSingles > 0 ? ` + ${formatUnitCount(looseSingles, 'Single')} Aside` : '';
  const totalFormatted = formatUnitCount(totalBaseUnits, opts.baseUnit);

  return {
    fullPacks,
    looseSingles,
    totalBaseUnits,
    costPerSingle,
    totalCost,
    isPartial: looseSingles > 0,
    summary: `${packFormatted}${looseFormatted} = ${totalFormatted} Total`,
  };
}
