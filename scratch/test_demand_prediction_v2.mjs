// scratch/test_demand_prediction_v2.mjs
// Comprehensive verification of PRAGATI 7-Day Demand Prediction Engine
// Tests: Real order data, low-data fallback, crop-specific normalization,
// confidence calculation, 7-day projection, invalid crops, and API response structure.

process.env.NODE_ENV = 'test';
import assert from 'node:assert/strict';
import http from 'node:http';
const { app } = await import('../server.js');
import {
  calculate7DayDemand,
  calculateAllCropsDemand,
  getTopDemandedCropsList,
  CROP_7DAY_BASELINE_DEMAND,
  normalizeCropKey,
} from '../server/demandPredictor.js';
import { predictCropDemand } from '../src/utils/demandPrediction.js';

console.log('🧪 Starting 7-Day Demand Prediction V2 Verification Suite...\n');

let server;
let baseUrl;

async function startServer() {
  return new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
}

async function stopServer() {
  return new Promise((resolve) => {
    if (server) {
      if (typeof server.closeAllConnections === 'function') {
        server.closeAllConnections();
      }
      server.close(() => {
        resolve();
      });
    } else {
      resolve();
    }
  });
}

async function fetchJson(path, opts = {}) {
  const res = await fetch(`${baseUrl}${path}`, opts);
  const data = await res.json();
  return { status: res.status, data };
}

try {
  await startServer();

  // --------------------------------------------------------------------------
  // SECTION 1: CROP-SPECIFIC BASELINE VALUES & LOW-DATA FALLBACK (Zero Orders)
  // --------------------------------------------------------------------------
  console.log('Test 1: Low-Data Fallback for all major crops (Wheat, Rice, Tomato, Onion, Potato)');
  const majorCrops = ['Wheat', 'Rice', 'Tomato', 'Onion', 'Potato'];

  for (const crop of majorCrops) {
    const res = calculate7DayDemand({ crop, orders: [], listings: [] });
    assert.equal(res.cropKey, crop.toLowerCase());
    assert.equal(res.horizon, '7_days');
    assert.equal(res.unit, 'kg');
    assert.equal(res.dataSource, 'baseline_estimate');
    assert.equal(res.hasEnoughData, false);
    assert.equal(res.confidence, 30, 'Zero orders must have low confidence (30%)');
    assert.equal(res.demandLevel, 'MEDIUM');
    assert.equal(res.predictedDemand, CROP_7DAY_BASELINE_DEMAND[res.cropKey]);
    assert.equal(res.predictedDemandKg, CROP_7DAY_BASELINE_DEMAND[res.cropKey]);
    assert.match(res.explanation, /baseline estimate/i);
    assert.match(res.recommendation, /Moderate demand/i);
  }

  // Verify that different crops do NOT all receive the same prediction
  assert.notEqual(CROP_7DAY_BASELINE_DEMAND.wheat, CROP_7DAY_BASELINE_DEMAND.tomato);
  assert.notEqual(CROP_7DAY_BASELINE_DEMAND.rice, CROP_7DAY_BASELINE_DEMAND.onion);
  assert.equal(CROP_7DAY_BASELINE_DEMAND.wheat, 1200);
  assert.equal(CROP_7DAY_BASELINE_DEMAND.rice, 1000);
  assert.equal(CROP_7DAY_BASELINE_DEMAND.potato, 750);
  assert.equal(CROP_7DAY_BASELINE_DEMAND.onion, 600);
  assert.equal(CROP_7DAY_BASELINE_DEMAND.tomato, 450);
  console.log('  ✓ Passed: Distinct, realistic 7-day baseline values verified for all major crops');

  // --------------------------------------------------------------------------
  // SECTION 2: 7-DAY TIME-WINDOWED PROJECTION & DEMAND VELOCITY
  // --------------------------------------------------------------------------
  console.log('\nTest 2: 7-Day Time-windowed velocity projection');
  // Scenario: 5 orders of 100 kg placed over 5 days (Total 500 kg in 5 days -> 100 kg/day)
  // Projected 7-day demand from velocity = 100 * 7 = 700 kg
  const dayMs = 86400000;
  const now = Date.now();
  const velocityOrders = [
    { crop: 'Tomato', quantityKg: 100, createdAt: new Date(now - 4 * dayMs).toISOString() },
    { crop: 'Tomato', quantityKg: 100, createdAt: new Date(now - 3 * dayMs).toISOString() },
    { crop: 'Tomato', quantityKg: 100, createdAt: new Date(now - 2 * dayMs).toISOString() },
    { crop: 'Tomato', quantityKg: 100, createdAt: new Date(now - 1 * dayMs).toISOString() },
    { crop: 'Tomato', quantityKg: 100, createdAt: new Date(now).toISOString() },
  ];

  const velRes = calculate7DayDemand({ crop: 'Tomato', orders: velocityOrders });
  assert.equal(velRes.crop, 'Tomato');
  assert.equal(velRes.historicalDemandKg, 500);
  assert.equal(velRes.orderCount, 5);
  assert.ok(velRes.predictedDemand >= 600, `Expected velocity-driven projection >= 600 kg, got ${velRes.predictedDemand}`);
  assert.equal(velRes.demandLevel, 'HIGH', '700 kg projected Tomato demand (>450 baseline) must be HIGH');
  console.log(`  ✓ Passed: 7-Day velocity calculated at ${velRes.predictedDemand} kg (HIGH demand)`);

  // --------------------------------------------------------------------------
  // SECTION 3: CROP-SPECIFIC NORMALIZATION
  // --------------------------------------------------------------------------
  console.log('\nTest 3: Crop-specific normalization against distinct benchmark bands');
  // Volume ~350-420 kg 7-day projection:
  // - For Tomato (benchmark 450 kg): ratio ~0.90 -> MEDIUM
  // - For Wheat (benchmark 1200 kg): ratio ~0.35 -> LOW
  const testOrdersNorm = [
    { quantity: 30, createdAt: new Date(now - 3 * dayMs).toISOString() },
    { quantity: 30, createdAt: new Date(now - 2 * dayMs).toISOString() },
    { quantity: 30, createdAt: new Date(now - 1 * dayMs).toISOString() },
    { quantity: 30, createdAt: new Date(now).toISOString() },
    { quantity: 30, createdAt: new Date(now).toISOString() },
    { quantity: 30, createdAt: new Date(now).toISOString() },
  ];

  const wheatRes = calculate7DayDemand({ crop: 'Wheat', orders: testOrdersNorm.map(o => ({ ...o, crop: 'Wheat' })) });
  const tomatoRes = calculate7DayDemand({ crop: 'Tomato', orders: testOrdersNorm.map(o => ({ ...o, crop: 'Tomato' })) });

  assert.equal(wheatRes.demandLevel, 'LOW', `~400 kg volume for Wheat must be LOW demand (benchmark 1200 kg), got ${wheatRes.demandLevel}`);
  assert.equal(tomatoRes.demandLevel, 'MEDIUM', `~400 kg volume for Tomato must be MEDIUM (benchmark 450 kg), got ${tomatoRes.demandLevel}`);
  console.log(`  ✓ Passed: Crop normalization verified (Wheat = ${wheatRes.demandLevel} [${wheatRes.predictedDemand}kg], Tomato = ${tomatoRes.demandLevel} [${tomatoRes.predictedDemand}kg])`);

  // --------------------------------------------------------------------------
  // SECTION 4: HONEST CONFIDENCE CALCULATION
  // --------------------------------------------------------------------------
  console.log('\nTest 4: Honest confidence scaling based on data quantity');
  // 0 orders: 30% (or 35% with listings)
  const conf0 = calculate7DayDemand({ crop: 'Rice', orders: [] }).confidence;
  assert.equal(conf0, 30, '0 orders must have 30% confidence');

  // 1 order: 50%
  const conf1 = calculate7DayDemand({ crop: 'Rice', orders: [{ crop: 'Rice', quantity: 100 }] }).confidence;
  assert.equal(conf1, 50, '1 order must have 50% confidence');

  // 3 orders: 66%
  const conf3 = calculate7DayDemand({
    crop: 'Rice',
    orders: [
      { crop: 'Rice', quantity: 100 },
      { crop: 'Rice', quantity: 100 },
      { crop: 'Rice', quantity: 100 },
    ],
  }).confidence;
  assert.equal(conf3, 66, '3 orders must have 66% confidence');

  // 10 orders: capped at 85% (never fake 90-100%)
  const conf10 = calculate7DayDemand({
    crop: 'Rice',
    orders: Array.from({ length: 10 }, () => ({ crop: 'Rice', quantity: 100 })),
  }).confidence;
  assert.ok(conf10 <= 85, `Confidence must be capped at 85%, got ${conf10}%`);
  assert.ok(conf10 >= 75, `Confidence with 10 orders should be >= 75%, got ${conf10}%`);
  console.log(`  ✓ Passed: Honest confidence verified (0 orders: ${conf0}%, 1 order: ${conf1}%, 3 orders: ${conf3}%, 10 orders: ${conf10}%)`);

  // --------------------------------------------------------------------------
  // SECTION 5: INVALID & MISSING CROP HANDLING
  // --------------------------------------------------------------------------
  console.log('\nTest 5: Defensive handling for invalid or missing crop');
  const invalidRes = calculate7DayDemand({ crop: 'CryptoCornXYZ' });
  assert.equal(invalidRes.cropKey, 'unknown');
  assert.equal(invalidRes.predictedDemand, 0);
  assert.equal(invalidRes.confidence, 0);
  assert.equal(invalidRes.dataSource, 'unknown');
  assert.match(invalidRes.explanation, /unsupported crop/i);

  const nullRes = calculate7DayDemand({ crop: null });
  assert.equal(nullRes.cropKey, 'unknown');
  assert.equal(nullRes.confidence, 0);
  console.log('  ✓ Passed: Invalid and null crop inputs handled safely');

  // --------------------------------------------------------------------------
  // SECTION 6: BACKEND API ENDPOINT (GET /api/demand-prediction)
  // --------------------------------------------------------------------------
  console.log('\nTest 6: Backend API structure (GET /api/demand-prediction)');

  // 6.1: Single crop query ?crop=wheat
  const apiWheat = await fetchJson('/api/demand-prediction?crop=wheat');
  assert.equal(apiWheat.status, 200);
  const dataW = apiWheat.data;
  assert.equal(dataW.success, true);
  assert.equal(dataW.crop, 'Wheat');
  assert.equal(dataW.unit, 'kg');
  assert.equal(dataW.horizon, '7_days');
  assert.ok(dataW.predictedDemand > 0);
  assert.ok(['HIGH', 'MEDIUM', 'LOW'].includes(dataW.demandLevel));
  assert.ok(typeof dataW.confidence === 'number');
  assert.ok(typeof dataW.explanation === 'string');
  assert.ok(typeof dataW.recommendation === 'string');
  assert.ok(dataW.dataSource === 'baseline_estimate' || dataW.dataSource === 'marketplace_orders' || dataW.dataSource === 'limited_marketplace_data');
  console.log('  ✓ Passed: GET /api/demand-prediction?crop=wheat returned valid consistent contract');

  // 6.2: All crops query
  const apiAll = await fetchJson('/api/demand-prediction');
  assert.equal(apiAll.status, 200);
  assert.equal(apiAll.data.success, true);
  assert.equal(apiAll.data.horizon, '7_days');
  assert.equal(apiAll.data.unit, 'kg');
  assert.ok(Array.isArray(apiAll.data.predictions));
  assert.equal(apiAll.data.predictions.length, 6, 'Must predict all 6 supported crops');
  assert.ok(Array.isArray(apiAll.data.topDemanded));
  assert.equal(apiAll.data.topDemanded.length, 3, 'Must return top 3 demanded crops');
  console.log('  ✓ Passed: GET /api/demand-prediction (all crops) returned 6 predictions and top 3 ranking');

  // 6.3: Invalid crop API request
  const apiInvalid = await fetchJson('/api/demand-prediction?crop=invalid_crop_name');
  assert.equal(apiInvalid.status, 400);
  assert.equal(apiInvalid.data.success, false);
  assert.match(apiInvalid.data.error, /unsupported crop/i);
  console.log('  ✓ Passed: GET /api/demand-prediction with invalid crop returns 400 with clean error');

  // 6.4: Real order integration via API
  // Reset orders, post 5 real orders for Rice, and verify that GET /api/demand-prediction reflects them!
  await fetchJson('/api/orders/reset', { method: 'POST' });

  // Post 4 orders of 300 kg Rice
  for (let i = 0; i < 4; i++) {
    await fetch(`${baseUrl}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        crop: 'rice',
        quantity: 300,
        pricePerKg: 35,
        totalAmount: 10500,
      }),
    });
  }

  const apiRiceWithOrders = await fetchJson('/api/demand-prediction?crop=rice');
  assert.equal(apiRiceWithOrders.status, 200);
  assert.equal(apiRiceWithOrders.data.crop, 'Rice');
  assert.equal(apiRiceWithOrders.data.orderCount, 4);
  assert.equal(apiRiceWithOrders.data.historicalDemandKg, 1200);
  assert.equal(apiRiceWithOrders.data.dataSource, 'marketplace_orders');
  assert.ok(apiRiceWithOrders.data.confidence >= 65);
  assert.equal(apiRiceWithOrders.data.demandLevel, 'HIGH');
  console.log('  ✓ Passed: Real order integration in backend stores & updates demand prediction dynamically');

  // --------------------------------------------------------------------------
  // SECTION 7: RICE, WHEAT, TOMATO, ONION CROSS-COMPARISON
  // --------------------------------------------------------------------------
  console.log('\nTest 7: Rice, Wheat, Tomato, Onion cross-comparison (Zero vs Active orders)');

  const testCrops = ['Rice', 'Wheat', 'Tomato', 'Onion'];
  console.log('  Zero-Order Baseline Evaluations:');
  for (const c of testCrops) {
    const zero = calculate7DayDemand({ crop: c, orders: [] });
    console.log(`    - ${c}: Predicted 7-Day Demand = ${zero.predictedDemand} kg | Level = ${zero.demandLevel} | Confidence = ${zero.confidence}% | Source = ${zero.dataSource}`);
    assert.ok(zero.predictedDemand > 0);
    assert.equal(zero.dataSource, 'baseline_estimate');
  }

  console.log('\n🎉 ALL 7-DAY DEMAND PREDICTION V2 TESTS PASSED SUCCESSFULLY!');
} finally {
  await stopServer();
}
