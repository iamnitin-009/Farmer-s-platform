// scratch/test_demand_prediction_e2e.mjs
// Comprehensive End-to-End Verification for AI Demand Prediction (SIH 2026 MVP)

import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// Mock browser localStorage and window environment for Node.js
const mockStorage = new Map()
globalThis.window = {
  location: {
    origin: 'http://localhost:5173',
  },
  localStorage: {
    getItem: (k) => (mockStorage.has(k) ? mockStorage.get(k) : null),
    setItem: (k, v) => mockStorage.set(k, String(v)),
    removeItem: (k) => mockStorage.delete(k),
    clear: () => mockStorage.clear(),
  },
}
globalThis.localStorage = globalThis.window.localStorage

const dpPath = pathToFileURL(path.resolve(process.cwd(), 'src/utils/demandPrediction.js')).href
const tlPath = pathToFileURL(path.resolve(process.cwd(), 'src/translations.js')).href

const {
  SUPPORTED_CROPS,
  CROP_BASELINE_DEMAND,
  normalizeCropKey,
  predictCropDemand,
  predictAllCropsDemand,
  getTopDemandedCrops,
  getDemandBadgeStyle,
  BUYER_ORDERS_STORAGE_KEY,
  FARMER_LISTINGS_STORAGE_KEY,
} = await import(dpPath)

const tlModule = await import(tlPath)
const translations = tlModule.default || tlModule.translations

console.log('🧪 Starting AI Demand Prediction E2E Test Suite...\n')

// -------------------------------------------------------------
// Test 1: Supported Crops Enumeration & Normalization
// -------------------------------------------------------------
console.log('Test 1: All 6 supported crops and aliases')
assert.equal(SUPPORTED_CROPS.length, 6, 'Must support exactly 6 crops')
const expectedCrops = ['Wheat', 'Rice', 'Potato', 'Onion', 'Tomato', 'Fruits']
for (const crop of expectedCrops) {
  assert.ok(SUPPORTED_CROPS.includes(crop), `SUPPORTED_CROPS must include ${crop}`)
  assert.ok(normalizeCropKey(crop), `normalizeCropKey must resolve ${crop}`)
}
// Hindi and alias checks
assert.equal(normalizeCropKey('गेहूं'), 'wheat')
assert.equal(normalizeCropKey('chawal'), 'rice')
assert.equal(normalizeCropKey('aloo'), 'potato')
assert.equal(normalizeCropKey('pyaz'), 'onion')
assert.equal(normalizeCropKey('tamatar'), 'tomato')
assert.equal(normalizeCropKey('fruits'), 'fruits')
assert.equal(normalizeCropKey('UnknownCropXYZ'), null)
console.log('  ✓ Passed: All 6 crops and multilingual aliases correctly normalized')

// -------------------------------------------------------------
// Test 2: Increasing Demand (High Demand Trend)
// -------------------------------------------------------------
console.log('\nTest 2: Increasing demand calculation')
const increasingOrders = [
  { crop: 'Tomato', quantityKg: 100, createdAt: '2026-09-01T10:00:00Z' },
  { crop: 'Tomato', quantityKg: 100, createdAt: '2026-09-02T10:00:00Z' },
  { crop: 'Tomato', quantityKg: 200, createdAt: '2026-09-03T10:00:00Z' },
  { crop: 'Tomato', quantityKg: 250, createdAt: '2026-09-04T10:00:00Z' },
]
const incrRes = predictCropDemand({ crop: 'Tomato', orders: increasingOrders, lang: 'en' })
assert.equal(incrRes.crop, 'Tomato')
assert.equal(incrRes.cropKey, 'tomato')
assert.equal(incrRes.historicalDemandKg, 650)
assert.equal(incrRes.hasEnoughData, true)
assert.ok(incrRes.trendPercent > 50, `Trend should be strongly positive, got ${incrRes.trendPercent}%`)
assert.equal(incrRes.demandLevel, 'HIGH', 'Rapidly growing orders must classify as HIGH demand')
assert.ok(incrRes.predictedDemandKg >= 240, 'Predicted demand should reflect recent high volume')
assert.ok(incrRes.confidence >= 80, `Confidence should be >= 80%, got ${incrRes.confidence}%`)
assert.match(incrRes.explanation, /increasing rapidly/i)
assert.match(incrRes.recommendation, /High demand/i)
console.log('  ✓ Passed: Increasing demand correctly detected as HIGH with trend +' + incrRes.trendPercent + '%')

// -------------------------------------------------------------
// Test 3: Decreasing Demand (Low Demand Trend)
// -------------------------------------------------------------
console.log('\nTest 3: Decreasing demand calculation')
const decreasingOrders = [
  { crop: 'Tomato', quantityKg: 250, createdAt: '2026-09-01T10:00:00Z' },
  { crop: 'Tomato', quantityKg: 200, createdAt: '2026-09-02T10:00:00Z' },
  { crop: 'Tomato', quantityKg: 80, createdAt: '2026-09-03T10:00:00Z' },
  { crop: 'Tomato', quantityKg: 50, createdAt: '2026-09-04T10:00:00Z' },
]
const decrRes = predictCropDemand({ crop: 'Tomato', orders: decreasingOrders, lang: 'en' })
assert.equal(decrRes.historicalDemandKg, 580)
assert.ok(decrRes.trendPercent < -30, `Trend should be negative, got ${decrRes.trendPercent}%`)
assert.equal(decrRes.demandLevel, 'LOW', 'Sharply dropping orders must classify as LOW demand')
assert.ok(decrRes.predictedDemandKg < 80, 'Predicted demand should adjust downwards')
assert.match(decrRes.explanation, /slowed down/i)
assert.match(decrRes.recommendation, /Low demand/i)
console.log('  ✓ Passed: Decreasing demand correctly detected as LOW with trend ' + decrRes.trendPercent + '%')

// -------------------------------------------------------------
// Test 4: Stable Demand (Medium Demand)
// -------------------------------------------------------------
console.log('\nTest 4: Stable demand calculation')
const stableOrders = [
  { crop: 'Wheat', quantityKg: 100, createdAt: '2026-09-01T10:00:00Z' },
  { crop: 'Wheat', quantityKg: 100, createdAt: '2026-09-02T10:00:00Z' },
  { crop: 'Wheat', quantityKg: 100, createdAt: '2026-09-03T10:00:00Z' },
  { crop: 'Wheat', quantityKg: 100, createdAt: '2026-09-04T10:00:00Z' },
]
const stableRes = predictCropDemand({ crop: 'Wheat', orders: stableOrders, lang: 'en' })
assert.equal(stableRes.trendPercent, 0, 'Stable uniform orders must have 0% trend')
assert.equal(stableRes.demandLevel, 'MEDIUM', 'Consistent normal orders must be MEDIUM demand')
assert.equal(stableRes.predictedDemandKg, 100)
assert.match(stableRes.explanation, /stable/i)
console.log('  ✓ Passed: Stable demand correctly predicted at 100 kg with MEDIUM level')

// -------------------------------------------------------------
// Test 5: High / Medium / Low Threshold Boundary Tests
// -------------------------------------------------------------
console.log('\nTest 5: Boundary threshold classification rules')
// Ratio >= 1.5 -> HIGH
const ordersHigh = [
  { crop: 'Potato', quantityKg: 100, createdAt: '2026-09-01T10:00:00Z' },
  { crop: 'Potato', quantityKg: 100, createdAt: '2026-09-02T10:00:00Z' },
  { crop: 'Potato', quantityKg: 200, createdAt: '2026-09-03T10:00:00Z' },
  { crop: 'Potato', quantityKg: 250, createdAt: '2026-09-04T10:00:00Z' },
]
assert.equal(predictCropDemand({ crop: 'Potato', orders: ordersHigh }).demandLevel, 'HIGH')

// Ratio between 0.8 and 1.5 -> MEDIUM
const ordersMedium = [
  { crop: 'Potato', quantityKg: 100, createdAt: '2026-09-01T10:00:00Z' },
  { crop: 'Potato', quantityKg: 100, createdAt: '2026-09-02T10:00:00Z' },
]
assert.equal(predictCropDemand({ crop: 'Potato', orders: ordersMedium }).demandLevel, 'MEDIUM')

// Ratio < 0.8 -> LOW
const ordersLow = [
  { crop: 'Potato', quantityKg: 300, createdAt: '2026-09-01T10:00:00Z' },
  { crop: 'Potato', quantityKg: 300, createdAt: '2026-09-02T10:00:00Z' },
  { crop: 'Potato', quantityKg: 50, createdAt: '2026-09-03T10:00:00Z' },
  { crop: 'Potato', quantityKg: 40, createdAt: '2026-09-04T10:00:00Z' },
]
assert.equal(predictCropDemand({ crop: 'Potato', orders: ordersLow }).demandLevel, 'LOW')
console.log('  ✓ Passed: Threshold boundaries verified (>=150% HIGH, 80-149% MEDIUM, <80% LOW)')

// -------------------------------------------------------------
// Test 6: Insufficient Data (Single Order)
// -------------------------------------------------------------
console.log('\nTest 6: Insufficient data handling (single order)')
const singleOrder = [{ crop: 'Rice', quantityKg: 120, createdAt: '2026-09-01T10:00:00Z' }]
const singleRes = predictCropDemand({ crop: 'Rice', orders: singleOrder, lang: 'en' })
assert.equal(singleRes.hasEnoughData, false, 'Single order must be marked hasEnoughData: false')
assert.equal(singleRes.confidence, 50, 'Single order confidence must be marked lower (50%)')
assert.equal(singleRes.predictedDemandKg, 120)
assert.match(singleRes.explanation, /Early single transaction detected/i)
console.log('  ✓ Passed: Single order gracefully handled with lower confidence notice')

// -------------------------------------------------------------
// Test 7: Zero Orders (Clean Empty State, Zero Fake Numbers)
// -------------------------------------------------------------
console.log('\nTest 7: Zero orders handling')
const zeroRes = predictCropDemand({ crop: 'Fruits', orders: [], listings: [], lang: 'en' })
assert.equal(zeroRes.hasEnoughData, false)
assert.equal(zeroRes.historicalDemandKg, 0)
assert.equal(zeroRes.averageDemandKg, 0)
assert.equal(zeroRes.predictedDemandKg, 0, 'Must NOT invent fake demand quantities')
assert.equal(zeroRes.trendPercent, 0)
assert.ok(zeroRes.confidence <= 35, 'Zero orders must have low confidence (<= 35%)')
assert.match(zeroRes.explanation, /Not enough transaction data/i)
assert.match(zeroRes.recommendation, /List your produce/i)
console.log('  ✓ Passed: Zero orders gracefully reports clean empty state without fake numbers')

// -------------------------------------------------------------
// Test 8: Malformed Data & Defensive Safeguards
// -------------------------------------------------------------
console.log('\nTest 8: Malformed, missing, negative and invalid data handling')
const malformedOrders = [
  null,
  undefined,
  { invalid: true },
  { crop: 'Onion', quantityKg: -50 }, // Negative quantity should be ignored
  { crop: 'Onion', quantityKg: 'not_a_number' },
  { crop: 'Onion', quantityKg: 80, createdAt: '2026-09-01T10:00:00Z' },
  { crop: 'Onion', quantityKg: 100, createdAt: '2026-09-02T10:00:00Z' },
]
const malformedRes = predictCropDemand({ crop: 'Onion', orders: malformedOrders })
assert.equal(malformedRes.hasEnoughData, true)
assert.equal(malformedRes.historicalDemandKg, 180)
assert.equal(malformedRes.averageDemandKg, 90)
assert.ok(!isNaN(malformedRes.predictedDemandKg), 'Predicted demand must not be NaN')
assert.ok(!isNaN(malformedRes.trendPercent), 'Trend must not be NaN')

// Null crop input
const nullCropRes = predictCropDemand({ crop: null })
assert.equal(nullCropRes.cropKey, 'unknown')
assert.equal(nullCropRes.hasEnoughData, false)
console.log('  ✓ Passed: Malformed, null and negative inputs handled defensively')

// -------------------------------------------------------------
// Test 9: Deterministic Repeatability
// -------------------------------------------------------------
console.log('\nTest 9: Deterministic repeatability')
const runA = predictCropDemand({ crop: 'Wheat', orders: increasingOrders })
const runB = predictCropDemand({ crop: 'Wheat', orders: increasingOrders })
assert.deepEqual(runA, runB, 'Identical inputs must yield 100% identical outputs every time')
console.log('  ✓ Passed: Strict deterministic repeatability confirmed')

// -------------------------------------------------------------
// Test 10: Bilingual Output Verification (English & Hindi)
// -------------------------------------------------------------
console.log('\nTest 10: Bilingual output verification')
const enRes = predictCropDemand({ crop: 'Tomato', orders: increasingOrders, lang: 'en' })
const hiRes = predictCropDemand({ crop: 'Tomato', orders: increasingOrders, lang: 'hi' })
assert.match(enRes.explanation, /increasing rapidly/i)
assert.match(hiRes.explanation, /मांग .* बढ़ रही है/i)
assert.match(enRes.recommendation, /High demand/i)
assert.match(hiRes.recommendation, /उच्च मांग/i)

// Check translations.js dictionary integrity
assert.ok(translations.en.demandPrediction, 'translations.en.demandPrediction must exist')
assert.ok(translations.hi.demandPrediction, 'translations.hi.demandPrediction must exist')
assert.equal(translations.en.demandPrediction.title, 'AI Demand Prediction')
assert.equal(translations.hi.demandPrediction.title, 'एआई मांग पूर्वानुमान')
assert.equal(translations.en.demandPrediction.highDemand, 'High Demand')
assert.equal(translations.hi.demandPrediction.highDemand, 'उच्च मांग')
console.log('  ✓ Passed: Bilingual English and Hindi outputs and dictionary verified')

// -------------------------------------------------------------
// Test 11: Real localStorage Integration
// -------------------------------------------------------------
console.log('\nTest 11: LocalStorage integration with sih_buyer_orders')
mockStorage.clear()
const testLocalStorageOrders = [
  { id: 'ORD_1', crop: 'Rice', quantity: 150, createdAt: '2026-09-01T10:00:00Z' },
  { id: 'ORD_2', crop: 'Rice', quantity: 200, createdAt: '2026-09-02T10:00:00Z' },
  { id: 'ORD_3', crop: 'Rice', quantity: 250, createdAt: '2026-09-03T10:00:00Z' },
]
mockStorage.set(BUYER_ORDERS_STORAGE_KEY, JSON.stringify(testLocalStorageOrders))
const storageRes = predictCropDemand({ crop: 'Rice' })
assert.equal(storageRes.crop, 'Rice')
assert.equal(storageRes.historicalDemandKg, 600)
assert.ok(storageRes.predictedDemandKg > 200)
console.log('  ✓ Passed: Direct integration with sih_buyer_orders in localStorage verified')

// -------------------------------------------------------------
// Test 12: All Crops Forecast & Top Demanded Crops
// -------------------------------------------------------------
console.log('\nTest 12: predictAllCropsDemand & getTopDemandedCrops')
const allPredictions = predictAllCropsDemand()
assert.equal(allPredictions.length, 6, 'predictAllCropsDemand must return all 6 crops')
const top3 = getTopDemandedCrops(3)
assert.equal(top3.length, 3, 'getTopDemandedCrops(3) must return exactly 3 crops')
assert.ok(top3[0].predictedDemandKg >= top3[1].predictedDemandKg || top3[0].demandLevel === 'HIGH')
console.log('  ✓ Passed: Multi-crop forecasting and Top 3 ranking verified')

// -------------------------------------------------------------
// Test 13: Badge Styling Helper
// -------------------------------------------------------------
console.log('\nTest 13: getDemandBadgeStyle UI styling helper')
const highStyle = getDemandBadgeStyle('HIGH')
const medStyle = getDemandBadgeStyle('MEDIUM')
const lowStyle = getDemandBadgeStyle('LOW')
assert.equal(highStyle.labelEn, 'High Demand')
assert.equal(highStyle.labelHi, 'उच्च मांग')
assert.equal(medStyle.labelEn, 'Medium Demand')
assert.equal(lowStyle.labelEn, 'Low Demand')
assert.ok(highStyle.bg && highStyle.color && highStyle.border)
console.log('  ✓ Passed: Badge styling contract verified for HIGH, MEDIUM, LOW')

console.log('\n🎉 ALL 13 AI DEMAND PREDICTION E2E TESTS PASSED!')
