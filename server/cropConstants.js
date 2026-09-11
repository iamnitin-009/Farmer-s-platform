// server/cropConstants.js
// Server canonical product, variety, pricing, and threshold definitions for CROP-001 MVP scope.

export const CROP_KEYS = ['rice', 'wheat', 'chana_dal', 'toor_dal'];

export const CROP_VARIETIES = {
  rice: ['Basmati', 'Sona Masoori', 'Regular'],
  wheat: ['Sharbati', 'Lokwan', 'Regular'],
  chana_dal: ['Desi', 'Kabuli', 'Regular'],
  toor_dal: ['Desi', 'Fatka', 'Regular'],
};

export const CROP_BASE_PRICES = {
  rice: 35,
  wheat: 25,
  chana_dal: 65,
  toor_dal: 110,
};

export const PICKUP_THRESHOLDS = {
  rice: 100,
  wheat: 100,
  chana_dal: 80,
  toor_dal: 80,
};

export const CROP_7DAY_BASELINE_DEMAND = {
  wheat: 1200,
  rice: 1000,
  chana_dal: 500,
  toor_dal: 400,
};

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
};

export function normalizeCropKey(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const cleaned = raw.trim().toLowerCase().replace(/-/g, '_');
  if (CROP_KEYS.includes(cleaned)) return cleaned;
  if (CROP_ALIASES[cleaned]) return CROP_ALIASES[cleaned];
  const spaced = cleaned.replace(/_/g, ' ');
  if (CROP_ALIASES[spaced]) return CROP_ALIASES[spaced];
  return null;
}

export function isValidCrop(crop) {
  return Boolean(normalizeCropKey(crop));
}

export function getCropVarieties(crop) {
  const norm = normalizeCropKey(crop);
  return norm && CROP_VARIETIES[norm] ? [...CROP_VARIETIES[norm]] : [];
}

export function normalizeVariety(crop, variety) {
  if (!variety || typeof variety !== 'string') return null;
  const valid = getCropVarieties(crop);
  if (valid.length === 0) return variety.trim();
  const match = valid.find((v) => v.toLowerCase() === variety.trim().toLowerCase());
  return match || variety.trim();
}
