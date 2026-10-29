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
  const fullPacks = Math.floor(roundedTotal / factor);
  const singles = Math.round((roundedTotal % factor) * 1000) / 1000;

  if (roundedTotal <= 0) {
    return {
      fullPacks: 0,
      singles: 0,
      packUnit: pkg.unit,
      baseUnit,
      hasBulkPackaging: true,
      factor,
      text: `0 ${baseUnit}`,
      shortText: `0 ${pkg.unit}`,
    };
  }

  if (fullPacks === 0) {
    return {
      fullPacks: 0,
      singles,
      packUnit: pkg.unit,
      baseUnit,
      hasBulkPackaging: true,
      factor,
      text: `${singles.toLocaleString()} ${baseUnit} (Singles aside)`,
      shortText: `${singles} singles`,
    };
  }

  if (singles === 0) {
    return {
      fullPacks,
      singles: 0,
      packUnit: pkg.unit,
      baseUnit,
      hasBulkPackaging: true,
      factor,
      text: `${fullPacks.toLocaleString()} ${pkg.unit} (${roundedTotal.toLocaleString()} ${baseUnit})`,
      shortText: `${fullPacks} ${pkg.unit}`,
    };
  }

  return {
    fullPacks,
    singles,
    packUnit: pkg.unit,
    baseUnit,
    hasBulkPackaging: true,
    factor,
    text: `${fullPacks.toLocaleString()} ${pkg.unit} + ${singles} singles (${roundedTotal.toLocaleString()} ${baseUnit})`,
    shortText: `${fullPacks} ${pkg.unit} + ${singles} singles`,
  };
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
