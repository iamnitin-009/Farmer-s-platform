// server/fairPrice.js
// Authoritative Server-side Deterministic Fair Price Engine for SIH 2026

import {
  CROP_BASE_PRICES,
  normalizeCropKey,
  getVarietyConfig,
  getVarietyMultiplier,
  normalizeVariety,
} from './cropConstants.js'

export { CROP_BASE_PRICES }

export const GRADE_MULTIPLIERS = {
  A: 1.20,
  B: 1.00,
  C: 0.80,
  default: 1.00,
}

export const QUANTITY_TIERS = [
  { min: 2000, multiplier: 0.92, labelEn: 'large wholesale batch (2000+ kg)', labelHi: 'बड़ा थोक लॉट (2000+ किग्रा)' },
  { min: 500,  multiplier: 0.96, labelEn: 'medium wholesale lot (500-1999 kg)', labelHi: 'मध्यम थोक लॉट (500-1999 किग्रा)' },
  { min: 100,  multiplier: 1.00, labelEn: 'standard commercial lot (100-499 kg)', labelHi: 'मानक वाणिज्यिक लॉट (100-499 किग्रा)' },
  { min: 0,    multiplier: 1.05, labelEn: 'small retail lot (< 100 kg)', labelHi: 'छोटा खुदरा लॉट (< 100 किग्रा)' },
]

/**
 * Computes AI suggested fair price per kg deterministically based on:
 * Base Price × Variety Adjustment × Quality Grade Multiplier × Volume Tier Multiplier.
 *
 * @param {Object} params
 * @param {string} params.crop
 * @param {string} [params.variety]
 * @param {number|string} [params.quantity]
 * @param {'A'|'B'|'C'|string|null} [params.grade]
 * @param {string} [params.lang='en']
 * @returns {{
 *   suggestedPrice: number,
 *   minPrice: number,
 *   maxPrice: number,
 *   crop: string,
 *   variety: string,
 *   varietySlug: string,
 *   grade: string|null,
 *   explanation: string,
 *   basePrice: number,
 *   varietyMultiplier: number,
 *   gradeMultiplier: number,
 *   volumeMultiplier: number,
 * } | null}
 */
export function calculateFairPrice({ crop, variety, quantity, grade, lang = 'en' } = {}) {
  if (!crop || typeof crop !== 'string') return null
  const cropKey = normalizeCropKey(crop) || crop.toLowerCase().trim()
  const basePrice = CROP_BASE_PRICES[cropKey] || 35

  // 1. Variety Adjustment Multiplier
  const varietyConfig = getVarietyConfig(cropKey, variety)
  const varietyMultiplier = varietyConfig ? varietyConfig.multiplier : 1.00
  const varietyName = varietyConfig ? varietyConfig.name : (variety ? String(variety).trim() : 'Regular')
  const varietySlug = varietyConfig ? varietyConfig.id : 'regular'

  // 2. Grade Multiplier
  const gradeKey = grade ? String(grade).toUpperCase().trim() : null
  const gradeMultiplier = (gradeKey && GRADE_MULTIPLIERS[gradeKey]) ? GRADE_MULTIPLIERS[gradeKey] : GRADE_MULTIPLIERS.default

  // 3. Quantity Volume Multiplier
  const qtyNum = typeof quantity === 'number' ? quantity : parseFloat(quantity)
  const validQty = !isNaN(qtyNum) && qtyNum > 0 ? qtyNum : 100
  const tier = QUANTITY_TIERS.find((t) => validQty >= t.min) || QUANTITY_TIERS[2]
  const volumeMultiplier = tier.multiplier

  // 4. Exact deterministic calculation
  // Suggested Price = Base Fair Price × Variety Adjustment × Quality Adjustment × Volume Multiplier
  const rawPrice = basePrice * varietyMultiplier * gradeMultiplier * volumeMultiplier
  const validRaw = !isNaN(rawPrice) && rawPrice > 0 ? rawPrice : basePrice
  const suggestedPrice = Math.max(1, Math.round(validRaw))
  const minPrice = Math.max(1, Math.round(suggestedPrice * 0.92))
  const maxPrice = Math.round(suggestedPrice * 1.08)

  // 5. Generate transparent explanation
  let explanation = ''
  if (lang === 'hi') {
    const varietyText = varietyMultiplier !== 1.00
      ? `${varietyConfig?.nameHi || varietyName} किस्म (${varietyMultiplier > 1 ? '+' : ''}${Math.round((varietyMultiplier - 1) * 100)}% समायोजन), `
      : ''
    const gradeText = gradeKey === 'A'
      ? 'ग्रेड A (+20% प्रीमियम)'
      : gradeKey === 'B'
        ? 'ग्रेड B (मानक दर)'
        : gradeKey === 'C'
          ? 'ग्रेड C (-20% छूट)'
          : 'बिना AI ग्रेड (मानक दर)'
    explanation = `आधार दर ₹${basePrice}/किग्रा, ${varietyText}${gradeText} और ${tier.labelHi} के आधार पर उचित मूल्य निर्धारित किया गया है।`
  } else {
    const varietyText = varietyMultiplier !== 1.00
      ? `${varietyName} variety (${varietyMultiplier > 1 ? '+' : ''}${Math.round((varietyMultiplier - 1) * 100)}% adjustment), `
      : ''
    const gradeText = gradeKey === 'A'
      ? 'Grade A (+20% premium)'
      : gradeKey === 'B'
        ? 'Grade B (standard rate)'
        : gradeKey === 'C'
          ? 'Grade C (-20% discount)'
          : 'uninspected baseline'
    explanation = `Calculated from ${cropKey} base rate (₹${basePrice}/kg), ${varietyText}${gradeText}, and ${tier.labelEn}.`
  }

  return {
    suggestedPrice,
    minPrice,
    maxPrice,
    crop: cropKey,
    variety: varietyName,
    varietySlug,
    grade: gradeKey,
    explanation,
    basePrice,
    varietyMultiplier,
    gradeMultiplier,
    volumeMultiplier,
  }
}
