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
      text: `${roundedTotal.toLocaleString()} ${baseUnit}`,
      shortText: `${roundedTotal.toLocaleString()} ${baseUnit}`,
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
    return {
      fullPacks: 0,
      singles: 0,
      packUnit: pkg.unit,
      baseUnit,
      hasBulkPackaging: true,
      factor,
      text: `0 ${pkg.unit} (0 ${baseUnit})`,
      shortText: `0 ${pkg.unit}`,
    };
  }

  if (fullPacks === 0) {
    return {
      fullPacks: 0,
      singles: isNeg ? -singles : singles,
      packUnit: pkg.unit,
      baseUnit,
      hasBulkPackaging: true,
      factor,
      text: `${sign}${singles.toLocaleString()} ${baseUnit} (${sign}${singles} singles aside)`,
      shortText: `${sign}${singles} singles`,
    };
  }

  if (singles === 0) {
    return {
      fullPacks: isNeg ? -fullPacks : fullPacks,
      singles: 0,
      packUnit: pkg.unit,
      baseUnit,
      hasBulkPackaging: true,
      factor,
      text: `${sign}${fullPacks.toLocaleString()} ${pkg.unit} (${sign}${roundedAbs.toLocaleString()} ${baseUnit})`,
      shortText: `${sign}${fullPacks} ${pkg.unit}`,
    };
  }

  return {
    fullPacks: isNeg ? -fullPacks : fullPacks,
    singles: isNeg ? -singles : singles,
    packUnit: pkg.unit,
    baseUnit,
    hasBulkPackaging: true,
    factor,
    text: `${sign}${fullPacks.toLocaleString()} ${pkg.unit} + ${singles} singles (${sign}${roundedAbs.toLocaleString()} ${baseUnit})`,
    shortText: `${sign}${fullPacks} ${pkg.unit} + ${singles} singles`,
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
  const totalBaseUnits = (fullPacks * factor) + looseSingles;

  const costPerSingle = opts.bulkPackCost > 0 ? opts.bulkPackCost / factor : 0;
  const totalCost = (fullPacks * opts.bulkPackCost) + (looseSingles * costPerSingle);

  return {
    fullPacks,
    looseSingles,
    totalBaseUnits,
    costPerSingle,
    totalCost,
    isPartial: looseSingles > 0,
    summary: `${fullPacks} ${opts.packUnit}${looseSingles > 0 ? ` + ${looseSingles} Singles Aside` : ''} = ${totalBaseUnits} ${opts.baseUnit} Total`,
  };
}
