// src/utils/pickupDecision.js
// Deterministic Smart Pickup Decision Engine for SIH 2026

/**
 * Predefined MVP Pickup Thresholds (in kg) for supported crops.
 * If quantity <= threshold: HUB PICKUP (Consolidated local aggregation)
 * If quantity >  threshold: HOME/FARM PICKUP (Direct farmgate bulk logistics)
 */
export const PICKUP_THRESHOLDS = {
  wheat: 100,   // <= 100 kg -> HUB, > 100 kg -> HOME
  rice: 100,    // <= 100 kg -> HUB, > 100 kg -> HOME
  potato: 75,   // <= 75 kg  -> HUB, > 75 kg  -> HOME
  onion: 75,    // <= 75 kg  -> HUB, > 75 kg  -> HOME
  tomato: 30,   // <= 30 kg  -> HUB, > 30 kg  -> HOME
  fruits: 30,   // <= 30 kg  -> HUB, > 30 kg  -> HOME
}

/**
 * Evaluates the smart pickup collection decision based on crop and quantity.
 *
 * @param {string} crop - Crop identifier (e.g. 'Wheat', 'Tomato')
 * @param {number|string} quantity - Lot quantity in kg
 * @param {string} [lang='en'] - Language for reason string ('en' | 'hi')
 * @returns {{
 *   method: 'HUB' | 'HOME' | null,
 *   thresholdKg: number | null,
 *   quantityKg: number,
 *   reason: string,
 *   label: string | null,
 *   icon: string | null,
 * }}
 */
export function getPickupDecision(crop, quantity, lang = 'en') {
  const qty = typeof quantity === 'number' ? quantity : parseFloat(quantity)
  const validQty = !isNaN(qty) && qty > 0 ? qty : 0

  if (!crop || typeof crop !== 'string') {
    return {
      method: null,
      thresholdKg: null,
      quantityKg: validQty,
      reason: lang === 'hi' ? 'अमान्य या अनिर्दिष्ट फसल।' : 'Invalid or unspecified crop.',
      label: null,
      icon: null,
    }
  }

  const cropKey = crop.toLowerCase().trim()
  const threshold = PICKUP_THRESHOLDS[cropKey]

  // If crop is unknown or unsupported, return safe invalid/unsupported result (no silent default)
  if (threshold === undefined) {
    return {
      method: null,
      thresholdKg: null,
      quantityKg: validQty,
      reason: lang === 'hi' ? 'असमर्थित फसल: इस फसल के लिए पिकअप नियम उपलब्ध नहीं है।' : 'Unsupported crop: pickup rules are not defined for this crop.',
      label: null,
      icon: null,
    }
  }

  if (validQty <= 0) {
    return {
      method: null,
      thresholdKg: threshold,
      quantityKg: 0,
      reason: lang === 'hi' ? 'पिकअप मूल्यांकन के लिए वैध मात्रा दर्ज करें।' : 'Please enter a valid quantity greater than 0 kg for pickup evaluation.',
      label: null,
      icon: null,
    }
  }

  // Exact boundary rule:
  // quantity <= threshold -> HUB
  // quantity >  threshold -> HOME
  const isHub = validQty <= threshold
  const method = isHub ? 'HUB' : 'HOME'

  let reason = ''
  if (lang === 'hi') {
    reason = isHub
      ? `मात्रा (${validQty} किग्रा) हब संग्रह सीमा (${threshold} किग्रा) के भीतर है, इसलिए स्थानीय हब संग्रह अनुशंसित है।`
      : `मात्रा (${validQty} किग्रा) हब संग्रह सीमा (${threshold} किग्रा) से अधिक है, इसलिए सीधा खेत से संग्रह (फार्म पिकअप) अनुशंसित है।`
  } else {
    reason = isHub
      ? `Quantity (${validQty} kg) is within the hub pickup threshold (${threshold} kg), so hub drop-off/collection is recommended.`
      : `Quantity (${validQty} kg) exceeds the hub pickup threshold (${threshold} kg), so direct farmgate pickup is recommended.`
  }

  return {
    method,
    thresholdKg: threshold,
    quantityKg: validQty,
    reason,
    label: isHub ? (lang === 'hi' ? 'हब पिकअप' : 'Hub Pickup') : (lang === 'hi' ? 'फार्म पिकअप' : 'Home/Farm Pickup'),
    icon: isHub ? '🚚' : '🚜',
  }
}
