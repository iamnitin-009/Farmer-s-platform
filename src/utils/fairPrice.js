// src/utils/fairPrice.js
// Deterministic Fair Price Suggestion Engine for SIH 2026

import { CROP_BASE_PRICES, normalizeCropKey } from './cropConstants.js'

export { CROP_BASE_PRICES }

/**
 * Quality Grade Multipliers based on deterministic AI quality check.
 * Grade A (90-100 score): +20% premium for uniform, defect-free harvest.
 * Grade B (75-89 score):  100% standard commercial market rate.
 * Grade C (0-74 score):   -20% discount for fair/processing grade.
 * Unassessed:             100% standard baseline.
 */
export const GRADE_MULTIPLIERS = {
  A: 1.20,
  B: 1.00,
  C: 0.80,
  default: 1.00,
}

/**
 * Bulk volume tier adjustment multipliers.
 * Wholesale mandi economics: larger batches have transport and aggregation economies of scale.
 */
export const QUANTITY_TIERS = [
  { min: 2000, multiplier: 0.92, labelEn: 'large wholesale batch (2000+ kg)', labelHi: 'बड़ा थोक लॉट (2000+ किग्रा)' },
  { min: 500,  multiplier: 0.96, labelEn: 'medium wholesale lot (500-1999 kg)', labelHi: 'मध्यम थोक लॉट (500-1999 किग्रा)' },
  { min: 100,  multiplier: 1.00, labelEn: 'standard commercial lot (100-499 kg)', labelHi: 'मानक वाणिज्यिक लॉट (100-499 किग्रा)' },
  { min: 0,    multiplier: 1.05, labelEn: 'small retail lot (< 100 kg)', labelHi: 'छोटा खुदरा लॉट (< 100 किग्रा)' },
]

/**
 * Computes AI suggested fair price per kg deterministically.
 *
 * @param {Object} params
 * @param {string} params.crop - Crop identifier (e.g. 'wheat', 'tomato')
 * @param {number|string} [params.quantity] - Produce quantity in kg
 * @param {'A'|'B'|'C'|string|null} [params.grade] - AI Quality Grade if inspected
 * @param {string} [params.lang='en'] - Output language for explanation ('en' | 'hi')
 * @returns {{
 *   suggestedPrice: number,
 *   minPrice: number,
 *   maxPrice: number,
 *   crop: string,
 *   grade: string|null,
 *   explanation: string,
 *   basePrice: number,
 *   gradeMultiplier: number,
 *   volumeMultiplier: number,
 * } | null}
 */
export function calculateFairPrice({ crop, quantity, grade, lang = 'en' } = {}) {
  if (!crop || typeof crop !== 'string') return null
  const cropKey = normalizeCropKey(crop) || crop.toLowerCase().trim()
  const basePrice = CROP_BASE_PRICES[cropKey] || 35

  // 1. Grade Multiplier
  const gradeKey = grade ? String(grade).toUpperCase().trim() : null
  const gradeMultiplier = (gradeKey && GRADE_MULTIPLIERS[gradeKey]) ? GRADE_MULTIPLIERS[gradeKey] : GRADE_MULTIPLIERS.default

  // 2. Quantity Volume Multiplier
  const qtyNum = typeof quantity === 'number' ? quantity : parseFloat(quantity)
  const validQty = !isNaN(qtyNum) && qtyNum > 0 ? qtyNum : 100
  const tier = QUANTITY_TIERS.find((t) => validQty >= t.min) || QUANTITY_TIERS[2]
  const volumeMultiplier = tier.multiplier

  // 3. Exact deterministic calculation
  const rawPrice = basePrice * gradeMultiplier * volumeMultiplier
  const suggestedPrice = Math.round(rawPrice)
  const minPrice = Math.max(1, Math.round(suggestedPrice * 0.92))
  const maxPrice = Math.round(suggestedPrice * 1.08)

  // 4. Generate transparent explanation
  let explanation = ''
  if (lang === 'hi') {
    const gradeText = gradeKey === 'A' ? 'ग्रेड A (+20% प्रीमियम)' : gradeKey === 'B' ? 'ग्रेड B (मानक दर)' : gradeKey === 'C' ? 'ग्रेड C (-20% छूट)' : 'बिना AI ग्रेड (मानक दर)'
    explanation = `आधार दर ₹${basePrice}/किग्रा, ${gradeText} और ${tier.labelHi} के आधार पर उचित मूल्य निर्धारित किया गया है।`
  } else {
    const gradeText = gradeKey === 'A' ? 'Grade A (+20% premium)' : gradeKey === 'B' ? 'Grade B (standard rate)' : gradeKey === 'C' ? 'Grade C (-20% discount)' : 'uninspected baseline'
    explanation = `Calculated from ${cropKey} base rate (₹${basePrice}/kg), ${gradeText}, and ${tier.labelEn}.`
  }

  return {
    suggestedPrice,
    minPrice,
    maxPrice,
    crop: cropKey,
    grade: gradeKey,
    explanation,
    basePrice,
    gradeMultiplier,
    volumeMultiplier,
  }
}
