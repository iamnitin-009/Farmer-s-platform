// server/deliveryPricing.js
// Authoritative Delivery Pricing Engine for DLV-001

import {
  MIN_DELIVERY_CHARGE,
  FREE_DELIVERY_THRESHOLD,
  DELIVERY_RULE_VERSION,
  PLATFORM_FEE,
  DISCOUNT,
} from './deliveryConstants.js';

export {
  MIN_DELIVERY_CHARGE,
  FREE_DELIVERY_THRESHOLD,
  DELIVERY_RULE_VERSION,
  PLATFORM_FEE,
  DISCOUNT,
};

/**
 * Fixed delivery pricing strategy for DLV-001 MVP.
 * Strict business rule:
 * productSubtotal > ₹2,000 -> FREE (₹0 delivery charge)
 * productSubtotal <= ₹2,000 -> ₹40 delivery charge
 */
export class FixedDeliveryStrategy {
  constructor(options = {}) {
    this.minDeliveryCharge = options.minDeliveryCharge ?? MIN_DELIVERY_CHARGE;
    this.freeDeliveryThreshold = options.freeDeliveryThreshold ?? FREE_DELIVERY_THRESHOLD;
    this.version = options.version ?? DELIVERY_RULE_VERSION;
    this.platformFee = options.platformFee ?? PLATFORM_FEE;
    this.discount = options.discount ?? DISCOUNT;
  }

  /**
   * Calculate delivery charges and net price breakdown.
   *
   * @param {Object} params
   * @param {Array} [params.allocations] - Current confirmed BFM-001 allocations
   * @param {number} [params.productSubtotal] - Precomputed product subtotal
   * @param {number} [params.actualDeliveredQuantity] - Precomputed total quantity in kg
   * @param {string} [params.lang='en'] - 'en' or 'hi'
   * @returns {Object} Pricing breakdown
   */
  calculate({
    allocations,
    productSubtotal,
    actualDeliveredQuantity,
    quantity,
    lang = 'en',
  } = {}) {
    let subtotal = 0;
    let deliveredQty = 0;
    const hasAllocations = Array.isArray(allocations);

    if (hasAllocations) {
      const activeAllocations = allocations.filter((a) => a && a.status !== 'REJECTED');

      for (const alloc of activeAllocations) {
        const q = parseFloat(alloc.allocatedQuantity ?? alloc.quantity ?? 0);
        const p = parseFloat(alloc.unitPrice ?? alloc.price ?? alloc.agreedPrice ?? 0);

        if (isNaN(q) || !isFinite(q) || q < 0) {
          throw new Error(`Invalid allocation quantity: ${alloc.allocatedQuantity ?? alloc.quantity}`);
        }
        if (isNaN(p) || !isFinite(p) || p < 0) {
          throw new Error(`Invalid allocation price: ${alloc.unitPrice ?? alloc.price}`);
        }

        const itemTotal = Math.round(q * p * 100) / 100;
        subtotal = Math.round((subtotal + itemTotal) * 100) / 100;
        deliveredQty = Math.round((deliveredQty + q) * 100) / 100;
      }
    } else {
      if (productSubtotal === undefined || productSubtotal === null) {
        throw new Error('Product subtotal is required');
      }
      const rawSubtotal = parseFloat(productSubtotal);
      if (isNaN(rawSubtotal) || !isFinite(rawSubtotal) || rawSubtotal < 0) {
        throw new Error(`Product subtotal must be a valid non-negative number: ${productSubtotal}`);
      }

      const rawQty = (actualDeliveredQuantity !== undefined ? actualDeliveredQuantity : quantity);
      if (rawQty !== undefined && rawQty !== null) {
        const parsedQty = parseFloat(rawQty);
        if (isNaN(parsedQty) || !isFinite(parsedQty) || parsedQty < 0) {
          throw new Error(`Quantity cannot be negative or invalid: ${rawQty}`);
        }
        deliveredQty = Math.round(parsedQty * 100) / 100;
      }

      subtotal = Math.round(rawSubtotal * 100) / 100;
    }

    // Zero or unallocated cases
    if (deliveredQty <= 0 && subtotal <= 0) {
      return {
        productSubtotal: 0,
        deliveryCharge: this.minDeliveryCharge,
        platformFee: this.platformFee,
        discount: this.discount,
        netPayable: this.minDeliveryCharge + this.platformFee - this.discount,
        actualDeliveredQuantity: 0,
        effectivePricePerKg: 'NOT_APPLICABLE',
        deliveryStatus: 'NOT_APPLICABLE',
        freeDeliveryEligible: false,
        amountNeededForFreeDelivery: Math.round((this.freeDeliveryThreshold + 0.01) * 100) / 100,
        deliveryRuleVersion: this.version,
        explanation: lang === 'hi' ? 'कोई सक्रिय आवंटन नहीं है।' : 'No active allocations.',
        calculatedAt: new Date().toISOString(),
      };
    }

    // Strict inequality business rule: subtotal > 2000 -> FREE, otherwise ₹40
    let deliveryCharge = 0;
    let deliveryStatus = 'CHARGED';
    let freeDeliveryEligible = false;
    let explanation = '';

    if (subtotal > this.freeDeliveryThreshold) {
      deliveryCharge = 0;
      deliveryStatus = 'FREE';
      freeDeliveryEligible = true;
      explanation = lang === 'hi'
        ? '₹2,000 से अधिक के ऑर्डर पर मुफ़्त डिलीवरी उपलब्ध है।'
        : 'Free delivery unlocked because your order value is above ₹2,000.';
    } else {
      deliveryCharge = this.minDeliveryCharge;
      deliveryStatus = 'CHARGED';
      freeDeliveryEligible = false;

      if (subtotal === this.freeDeliveryThreshold) {
        explanation = lang === 'hi'
          ? `₹${this.minDeliveryCharge} डिलीवरी शुल्क लागू होता है क्योंकि मुफ़्त डिलीवरी ₹2,000 से अधिक पर शुरू होती है।`
          : `₹${this.minDeliveryCharge} delivery charge applies because free delivery starts above ₹2,000.`;
      } else {
        explanation = lang === 'hi'
          ? `₹${this.minDeliveryCharge} डिलीवरी शुल्क लागू होता है क्योंकि ऑर्डर मूल्य ₹${subtotal.toLocaleString('en-IN')} है।`
          : `₹${this.minDeliveryCharge} delivery charge applies because your order value is ₹${subtotal.toLocaleString('en-IN')}.`;
      }
    }

    const netPayable = Math.round((subtotal + deliveryCharge + this.platformFee - this.discount) * 100) / 100;
    const effectivePricePerKg = deliveredQty > 0
      ? Math.round((netPayable / deliveredQty) * 100) / 100
      : 'NOT_APPLICABLE';

    const amountNeededForFreeDelivery = subtotal <= this.freeDeliveryThreshold
      ? Math.max(0, Math.round((this.freeDeliveryThreshold + 0.01 - subtotal) * 100) / 100)
      : 0;

    return {
      productSubtotal: subtotal,
      deliveryCharge,
      platformFee: this.platformFee,
      discount: this.discount,
      netPayable,
      actualDeliveredQuantity: deliveredQty,
      effectivePricePerKg,
      deliveryStatus,
      freeDeliveryEligible,
      amountNeededForFreeDelivery,
      deliveryRuleVersion: this.version,
      explanation,
      calculatedAt: new Date().toISOString(),
    };
  }
}

export const defaultDeliveryStrategy = new FixedDeliveryStrategy();

export function calculateDeliveryPricing(arg1, arg2, arg3) {
  if (typeof arg1 === 'object' && arg1 !== null && !Array.isArray(arg1) && arg1.productSubtotal === undefined && arg1.subtotal === undefined && arg1.allocations === undefined) {
    return defaultDeliveryStrategy.calculate(arg1);
  }
  if (typeof arg1 === 'object' && arg1 !== null) {
    return defaultDeliveryStrategy.calculate({
      allocations: arg1.allocations,
      productSubtotal: arg1.productSubtotal ?? arg1.subtotal,
      actualDeliveredQuantity: arg1.actualDeliveredQuantity ?? arg1.quantity,
      lang: arg1.lang,
      ...arg2,
    });
  }
  return defaultDeliveryStrategy.calculate({
    productSubtotal: arg1,
    actualDeliveredQuantity: arg2,
    ...(typeof arg3 === 'object' && arg3 !== null ? arg3 : { lang: arg3 }),
  });
}
