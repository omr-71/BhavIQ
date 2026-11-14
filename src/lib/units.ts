import type { BaseUnit, ProductUnit } from './types';

export const STANDARD_UNITS: BaseUnit[] = [
  'Piece',
  'Packet',
  'Box',
  'Carton',
  'Gram',
  'Kilogram',
  'Millilitre',
  'Litre',
];

const METRIC_CONVERSIONS: Record<string, Record<string, number>> = {
  Kilogram: { Kilogram: 1, Gram: 0.001 },
  Gram: { Gram: 1, Kilogram: 1000 },
  Litre: { Litre: 1, Millilitre: 0.001 },
  Millilitre: { Millilitre: 1, Litre: 1000 },
};

/**
 * Converts a quantity expressed in `unitName` into the product's `baseUnit` quantity.
 * Checks explicit `productUnits` first, then standard metric conversions.
 */
export function convertToBaseQuantity(
  quantity: number,
  unitName: string,
  baseUnit: BaseUnit,
  productUnits: ProductUnit[] = []
): number {
  if (!Number.isFinite(quantity) || quantity < 0) {
    throw new Error('Quantity must be a non-negative finite number');
  }
  if (unitName === baseUnit) {
    return roundQty(quantity);
  }
  const custom = productUnits.find(
    (u) => u.unitName.toLowerCase() === unitName.toLowerCase()
  );
  if (custom) {
    if (!Number.isFinite(custom.conversionToBase) || custom.conversionToBase <= 0) {
      throw new Error(`Invalid conversion factor for unit ${unitName}`);
    }
    return roundQty(quantity * custom.conversionToBase);
  }
  const metricMap = METRIC_CONVERSIONS[baseUnit];
  if (metricMap && metricMap[unitName] !== undefined) {
    return roundQty(quantity * metricMap[unitName]);
  }
  throw new Error(`Unsupported unit conversion from "${unitName}" to "${baseUnit}"`);
}

/**
 * Given a unit's conversion factor to base, calculates cost or selling price per base unit.
 */
export function convertRateToBaseUnit(
  ratePerUnit: number,
  unitName: string,
  baseUnit: BaseUnit,
  productUnits: ProductUnit[] = []
): number {
  if (!Number.isFinite(ratePerUnit) || ratePerUnit < 0) {
    throw new Error('Rate must be a non-negative finite number');
  }
  const factor = convertToBaseQuantity(1, unitName, baseUnit, productUnits);
  if (factor <= 0) {
    throw new Error('Conversion factor must be positive');
  }
  return roundCurrency(ratePerUnit / factor);
}

/**
 * Formats base stock cleanly, optionally showing secondary pack breakdown (e.g., "24 Packet (2 Carton)").
 */
export function formatStockDisplay(
  baseStock: number,
  baseUnit: BaseUnit,
  productUnits: ProductUnit[] = []
): string {
  const rounded = roundQty(baseStock);
  const largestPack = productUnits
    .filter((u) => u.conversionToBase > 1)
    .sort((a, b) => b.conversionToBase - a.conversionToBase)[0];

  if (!largestPack || rounded < largestPack.conversionToBase) {
    return `${rounded} ${baseUnit}`;
  }

  const wholePacks = Math.floor(rounded / largestPack.conversionToBase);
  const remainder = roundQty(rounded - wholePacks * largestPack.conversionToBase);
  if (remainder === 0) {
    return `${rounded} ${baseUnit} (${wholePacks} ${largestPack.unitName})`;
  }
  return `${rounded} ${baseUnit} (${wholePacks} ${largestPack.unitName} + ${remainder} ${baseUnit})`;
}

export function roundQty(val: number): number {
  return Math.round(val * 10000) / 10000;
}

export function roundCurrency(val: number): number {
  return Math.round(val * 100) / 100;
}
