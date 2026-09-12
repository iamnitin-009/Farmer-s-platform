// src/utils/cropConstants.js
// Canonical product, variety, pricing, and threshold definitions for CROP-001 MVP scope.

export const CROP_KEYS = ['rice', 'wheat', 'chana_dal', 'toor_dal']

export const CROP_CONFIG = {
  rice: {
    key: 'rice',
    name: 'Rice',
    nameHi: 'चावल',
    basePrice: 35,
    pickupThreshold: 100,
    baselineDemand7Day: 1000,
    varieties: [
      { id: 'basmati', slug: 'basmati', name: 'Basmati', nameHi: 'बासमती', multiplier: 1.35 },
      { id: 'basmati_1121', slug: 'basmati_1121', name: '1121 Basmati', nameHi: '1121 बासमती', multiplier: 1.50 },
      { id: 'sona_masoori', slug: 'sona_masoori', name: 'Sona Masoori', nameHi: 'सोना मसूरी', multiplier: 1.08 },
      { id: 'pr_14', slug: 'pr_14', name: 'PR-14', nameHi: 'पीआर-14', multiplier: 1.06 },
      { id: 'regular', slug: 'regular', name: 'Regular', nameHi: 'सामान्य', multiplier: 1.00 },
    ],
  },
  wheat: {
    key: 'wheat',
    name: 'Wheat',
    nameHi: 'गेहूं',
    basePrice: 25,
    pickupThreshold: 100,
    baselineDemand7Day: 1200,
    varieties: [
      { id: 'sharbati', slug: 'sharbati', name: 'Sharbati', nameHi: 'शरबती', multiplier: 1.20 },
      { id: 'lokwan', slug: 'lokwan', name: 'Lokwan', nameHi: 'लोकवन', multiplier: 1.10 },
      { id: 'dbw_187', slug: 'dbw_187', name: 'DBW 187', nameHi: 'डीबीडब्ल्यू 187', multiplier: 1.06 },
      { id: 'hd_2967', slug: 'hd_2967', name: 'HD 2967', nameHi: 'एचडी 2967', multiplier: 1.05 },
      { id: 'regular', slug: 'regular', name: 'Regular', nameHi: 'सामान्य', multiplier: 1.00 },
    ],
  },
  chana_dal: {
    key: 'chana_dal',
    name: 'Chana Dal',
    nameHi: 'चना दाल',
    basePrice: 65,
    pickupThreshold: 80,
    baselineDemand7Day: 500,
    varieties: [
      { id: 'kabuli', slug: 'kabuli', name: 'Kabuli', nameHi: 'काबुली', multiplier: 1.20 },
      { id: 'desi', slug: 'desi', name: 'Desi', nameHi: 'देसी', multiplier: 1.08 },
      { id: 'regular', slug: 'regular', name: 'Regular', nameHi: 'सामान्य', multiplier: 1.00 },
    ],
  },
  toor_dal: {
    key: 'toor_dal',
    name: 'Toor Dal',
    nameHi: 'तूर दाल',
    basePrice: 110,
    pickupThreshold: 80,
    baselineDemand7Day: 400,
    varieties: [
      { id: 'asha', slug: 'asha', name: 'Asha', nameHi: 'आशा', multiplier: 1.12 },
      { id: 'maruti', slug: 'maruti', name: 'Maruti', nameHi: 'मारुति', multiplier: 1.12 },
      { id: 'pusa_2001', slug: 'pusa_2001', name: 'Pusa 2001', nameHi: 'पूसा 2001', multiplier: 1.10 },
      { id: 'desi', slug: 'desi', name: 'Desi / Local', nameHi: 'देसी / स्थानीय', multiplier: 1.06 },
      { id: 'fatka', slug: 'fatka', name: 'Fatka', nameHi: 'फटका', multiplier: 1.08 },
      { id: 'regular', slug: 'regular', name: 'Regular', nameHi: 'सामान्य', multiplier: 1.00 },
    ],
  },
}

export const CROP_VARIETIES = {
  rice: CROP_CONFIG.rice.varieties.map((v) => v.name),
  wheat: CROP_CONFIG.wheat.varieties.map((v) => v.name),
  chana_dal: CROP_CONFIG.chana_dal.varieties.map((v) => v.name),
  toor_dal: CROP_CONFIG.toor_dal.varieties.map((v) => v.name),
}

export const VARIETY_ALIASES = {
  rice: {
    '1121': 'basmati_1121',
    '1121 basmati': 'basmati_1121',
    'basmati 1121': 'basmati_1121',
    'basmati_1121': 'basmati_1121',
    'pr14': 'pr_14',
    'pr 14': 'pr_14',
    'pr-14': 'pr_14',
    'sona': 'sona_masoori',
    'sonamasoori': 'sona_masoori',
    'sona masoori': 'sona_masoori',
    'sona_masoori': 'sona_masoori',
  },
  wheat: {
    'dbw187': 'dbw_187',
    'dbw 187': 'dbw_187',
    'dbw_187': 'dbw_187',
    'hd2967': 'hd_2967',
    'hd 2967': 'hd_2967',
    'hd_2967': 'hd_2967',
  },
  toor_dal: {
    'pusa2001': 'pusa_2001',
    'pusa 2001': 'pusa_2001',
    'pusa_2001': 'pusa_2001',
    'desi / local': 'desi',
    'desi/local': 'desi',
    'local': 'desi',
    'desi': 'desi',
  },
}

export const CROP_ICONS = {
  rice: '🍚',
  wheat: '🌾',
  chana_dal: '🧆',
  toor_dal: '🥣',
}

// Mandi MSP / Wholesale baseline benchmark rates (₹/kg)
export const CROP_BASE_PRICES = {
  rice: CROP_CONFIG.rice.basePrice,
  wheat: CROP_CONFIG.wheat.basePrice,
  chana_dal: CROP_CONFIG.chana_dal.basePrice,
  toor_dal: CROP_CONFIG.toor_dal.basePrice,
}

// Logistics Hub vs Direct Farm/Home pickup thresholds (kg)
export const PICKUP_THRESHOLDS = {
  rice: CROP_CONFIG.rice.pickupThreshold,
  wheat: CROP_CONFIG.wheat.pickupThreshold,
  chana_dal: CROP_CONFIG.chana_dal.pickupThreshold,
  toor_dal: CROP_CONFIG.toor_dal.pickupThreshold,
}

// 7-day regional hub baseline demand benchmarks (kg)
export const CROP_7DAY_BASELINE_DEMAND = {
  wheat: CROP_CONFIG.wheat.baselineDemand7Day,
  rice: CROP_CONFIG.rice.baselineDemand7Day,
  chana_dal: CROP_CONFIG.chana_dal.baselineDemand7Day,
  toor_dal: CROP_CONFIG.toor_dal.baselineDemand7Day,
}

// Crop aliases for flexible normalization (Hindi / regional / synonyms)
export const CROP_ALIASES = {
  rice: 'rice',
  chawal: 'rice',
  paddy: 'rice',
  'चावल': 'rice',
  wheat: 'wheat',
  gehu: 'wheat',
  'गेहूं': 'wheat',
  'गेहू': 'wheat',
  chana_dal: 'chana_dal',
  'chana dal': 'chana_dal',
  chanadal: 'chana_dal',
  chana: 'chana_dal',
  channa: 'chana_dal',
  'चना': 'chana_dal',
  'चना दाल': 'chana_dal',
  toor_dal: 'toor_dal',
  'toor dal': 'toor_dal',
  toordal: 'toor_dal',
  toor: 'toor_dal',
  tur: 'toor_dal',
  arhar: 'toor_dal',
  'arhar dal': 'toor_dal',
  'तुअर': 'toor_dal',
  'तूर दाल': 'toor_dal',
  'अरहर': 'toor_dal',
}

export function normalizeCropKey(raw) {
  if (!raw || typeof raw !== 'string') return null
  const cleaned = raw.trim().toLowerCase().replace(/-/g, '_')
  if (CROP_KEYS.includes(cleaned)) return cleaned
  if (CROP_ALIASES[cleaned]) return CROP_ALIASES[cleaned]
  const spaced = cleaned.replace(/_/g, ' ')
  if (CROP_ALIASES[spaced]) return CROP_ALIASES[spaced]
  return null
}

export function isValidCrop(crop) {
  return Boolean(normalizeCropKey(crop))
}

export function getCropConfig(crop) {
  const norm = normalizeCropKey(crop)
  return norm ? CROP_CONFIG[norm] || null : null
}

export function getCropVarieties(crop) {
  const norm = normalizeCropKey(crop)
  return norm && CROP_VARIETIES[norm] ? [...CROP_VARIETIES[norm]] : []
}

export function getCropVarietyObjects(crop) {
  const norm = normalizeCropKey(crop)
  return norm && CROP_CONFIG[norm] ? [...CROP_CONFIG[norm].varieties] : []
}

export function getVarietyConfig(crop, variety) {
  const normCrop = normalizeCropKey(crop)
  if (!normCrop || !CROP_CONFIG[normCrop]) return null
  if (!variety || typeof variety !== 'string') {
    return CROP_CONFIG[normCrop].varieties.find((v) => v.id === 'regular') || null
  }

  const clean = variety.trim().toLowerCase().replace(/\s+/g, ' ')
  const slugClean = clean.replace(/[-\s]/g, '_')

  const aliasTarget = VARIETY_ALIASES[normCrop]?.[clean] || VARIETY_ALIASES[normCrop]?.[slugClean]

  const varieties = CROP_CONFIG[normCrop].varieties
  const found = varieties.find(
    (v) =>
      v.id.toLowerCase() === clean ||
      v.slug.toLowerCase() === clean ||
      v.name.toLowerCase() === clean ||
      v.id.toLowerCase() === slugClean ||
      v.slug.toLowerCase() === slugClean ||
      (aliasTarget && (v.id === aliasTarget || v.slug === aliasTarget))
  )

  return found || varieties.find((v) => v.id === 'regular') || null
}

export function getVarietyMultiplier(crop, variety) {
  const cfg = getVarietyConfig(crop, variety)
  return cfg ? cfg.multiplier : 1.00
}

export function normalizeVariety(crop, variety) {
  const normCrop = normalizeCropKey(crop)
  if (!normCrop) return 'Regular'
  const cfg = getVarietyConfig(normCrop, variety)
  return cfg ? cfg.name : 'Regular'
}
