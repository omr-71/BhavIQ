import type { PaymentMode } from './types';
import { roundCurrency } from './units';

export interface InvoiceLineDraft {
  productId: string;
  quantity: number;
  unitSellingPrice: number;
  discountAmount: number;
  taxRatePct: number;
  costPricePerBaseUnit: number | null;
  baseQuantityDeducted: number;
}

export interface InvoiceTotals {
  subtotal: number;
  lineDiscountTotal: number;
  invoiceDiscount: number;
  taxAmount: number;
  totalAmount: number;
  grossProfit: number | null;
  grossProfitComplete: boolean;
}

export function calculateInvoiceTotals(
  lines: InvoiceLineDraft[],
  invoiceDiscount = 0,
  taxMode: 'gst_inclusive' | 'gst_exclusive' | 'non_gst' = 'gst_inclusive'
): InvoiceTotals {
  let subtotal = 0;
  let lineDiscountTotal = 0;
  let taxAmount = 0;
  let grossProfitSum = 0;
  let allCostsKnown = lines.length > 0;

  for (const line of lines) {
    const grossLine = line.quantity * line.unitSellingPrice;
    const netBeforeTax = Math.max(0, grossLine - line.discountAmount);
    subtotal += grossLine;
    lineDiscountTotal += line.discountAmount;

    if (taxMode === 'gst_exclusive' && line.taxRatePct > 0) {
      taxAmount += netBeforeTax * (line.taxRatePct / 100);
    } else if (taxMode === 'gst_inclusive' && line.taxRatePct > 0) {
      const baseExcl = netBeforeTax / (1 + line.taxRatePct / 100);
      taxAmount += netBeforeTax - baseExcl;
    }

    if (line.costPricePerBaseUnit === null || !Number.isFinite(line.costPricePerBaseUnit)) {
      allCostsKnown = false;
    } else {
      const lineRevenueExclTax =
        taxMode === 'gst_exclusive'
          ? netBeforeTax
          : taxMode === 'gst_inclusive' && line.taxRatePct > 0
            ? netBeforeTax / (1 + line.taxRatePct / 100)
            : netBeforeTax;
      const lineCost = line.baseQuantityDeducted * line.costPricePerBaseUnit;
      grossProfitSum += lineRevenueExclTax - lineCost;
    }
  }

  const safeInvoiceDiscount = Math.max(0, roundCurrency(invoiceDiscount));
  const netBeforeInvoiceTax = Math.max(0, subtotal - lineDiscountTotal - safeInvoiceDiscount);
  const totalAmount =
    taxMode === 'gst_exclusive'
      ? roundCurrency(netBeforeInvoiceTax + taxAmount)
      : roundCurrency(netBeforeInvoiceTax);

  const grossProfit = allCostsKnown ? roundCurrency(grossProfitSum - safeInvoiceDiscount) : null;

  return {
    subtotal: roundCurrency(subtotal),
    lineDiscountTotal: roundCurrency(lineDiscountTotal),
    invoiceDiscount: safeInvoiceDiscount,
    taxAmount: roundCurrency(taxAmount),
    totalAmount,
    grossProfit,
    grossProfitComplete: allCostsKnown,
  };
}

export function validatePaymentSplit(params: {
  totalAmount: number;
  paymentMode: PaymentMode;
  cashPaid: number;
  upiPaid: number;
  creditAmount: number;
  hasCustomer: boolean;
}): { valid: boolean; paidAmount: number; creditAmount: number; error?: string } {
  const { totalAmount, paymentMode, cashPaid, upiPaid, creditAmount, hasCustomer } = params;

  if (totalAmount <= 0) {
    return { valid: false, paidAmount: 0, creditAmount: 0, error: 'Invoice total must be greater than zero' };
  }

  if (paymentMode === 'cash') {
    return { valid: true, paidAmount: roundCurrency(totalAmount), creditAmount: 0 };
  }

  if (paymentMode === 'upi') {
    return { valid: true, paidAmount: roundCurrency(totalAmount), creditAmount: 0 };
  }

  if (paymentMode === 'credit') {
    if (!hasCustomer) {
      return {
        valid: false,
        paidAmount: 0,
        creditAmount: 0,
        error: 'Select a customer from Khata before billing on credit',
      };
    }
    return { valid: true, paidAmount: 0, creditAmount: roundCurrency(totalAmount) };
  }

  // Split payment validation
  const sum = roundCurrency(Math.max(0, cashPaid) + Math.max(0, upiPaid) + Math.max(0, creditAmount));
  if (Math.abs(sum - roundCurrency(totalAmount)) > 0.02) {
    return {
      valid: false,
      paidAmount: 0,
      creditAmount: 0,
      error: `Split total (₹${sum.toFixed(2)}) must match invoice total (₹${totalAmount.toFixed(2)})`,
    };
  }
  if (creditAmount > 0 && !hasCustomer) {
    return {
      valid: false,
      paidAmount: 0,
      creditAmount: 0,
      error: 'Select a customer for the credit portion of a split payment',
    };
  }

  return {
    valid: true,
    paidAmount: roundCurrency(Math.max(0, cashPaid) + Math.max(0, upiPaid)),
    creditAmount: roundCurrency(Math.max(0, creditAmount)),
  };
}

export function formatINR(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) {
    return '—';
  }
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}
