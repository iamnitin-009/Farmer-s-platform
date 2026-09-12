// tests/dlv_verification.js
import assert from 'assert';
import { calculateDeliveryPricing, FixedDeliveryStrategy } from '../server/deliveryPricing.js';
import { calculateDeliveryPricing as clientCalculateDeliveryPricing } from '../src/utils/deliveryPricing.js';
import { MIN_DELIVERY_CHARGE, FREE_DELIVERY_THRESHOLD, DELIVERY_RULE_VERSION } from '../server/deliveryConstants.js';
import { allocateMultiFarmerOrder } from '../server/matchingEngine.js';
import { listingStore } from '../server/listingStore.js';

async function runTests() {
  console.log('====================================================');
  console.log('  PRAGATI DLV-001 DELIVERY PRICING VERIFICATION');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try {
      fn();
      console.log(`✅ PASS: ${name}`);
      passed++;
    } catch (err) {
      console.error(`❌ FAIL: ${name}`);
      console.error(err);
      failed++;
    }
  }

  async function asyncTest(name, fn) {
    try {
      await fn();
      console.log(`✅ PASS: ${name}`);
      passed++;
    } catch (err) {
      console.error(`❌ FAIL: ${name}`);
      console.error(err);
      failed++;
    }
  }

  // ----------------------------------------------------
  // Core Business Rule Verification
  // ----------------------------------------------------

  // Test Case A: productSubtotal = ₹500
  test('Case A: productSubtotal = ₹500 => delivery = ₹40, net = ₹540, charged', () => {
    const res = calculateDeliveryPricing(500, 20);
    assert.strictEqual(res.productSubtotal, 500);
    assert.strictEqual(res.deliveryCharge, 40);
    assert.strictEqual(res.netPayable, 540);
    assert.strictEqual(res.effectivePricePerKg, 27); // 540 / 20 = 27
    assert.strictEqual(res.deliveryStatus, 'CHARGED');
    assert.strictEqual(res.freeDeliveryEligible, false);
    assert.strictEqual(res.amountNeededForFreeDelivery, 1500.01);
  });

  // Test Case B: productSubtotal = ₹1,999
  test('Case B: productSubtotal = ₹1,999 => delivery = ₹40, net = ₹2,039', () => {
    const res = calculateDeliveryPricing(1999, 50);
    assert.strictEqual(res.productSubtotal, 1999);
    assert.strictEqual(res.deliveryCharge, 40);
    assert.strictEqual(res.netPayable, 2039);
    assert.strictEqual(res.effectivePricePerKg, 40.78);
    assert.strictEqual(res.deliveryStatus, 'CHARGED');
    assert.strictEqual(res.freeDeliveryEligible, false);
    assert.strictEqual(res.amountNeededForFreeDelivery, 1.01);
  });

  // Test Case C: Boundary condition at exact threshold ₹2,000 (Strict >)
  test('Case C: productSubtotal = ₹2,000 (Boundary) => delivery = ₹40 (NOT FREE), net = ₹2,040', () => {
    const res = calculateDeliveryPricing(2000, 50);
    assert.strictEqual(res.productSubtotal, 2000);
    assert.strictEqual(res.deliveryCharge, 40, 'Strict inequality > 2000 required: ₹2,000 must incur ₹40 delivery');
    assert.strictEqual(res.netPayable, 2040);
    assert.strictEqual(res.effectivePricePerKg, 40.8);
    assert.strictEqual(res.deliveryStatus, 'CHARGED');
    assert.strictEqual(res.freeDeliveryEligible, false);
    assert.strictEqual(res.amountNeededForFreeDelivery, 0.01);
  });

  // Test Case D: productSubtotal = ₹2,001 (First integer above threshold)
  test('Case D: productSubtotal = ₹2,001 => delivery = ₹0, net = ₹2,001, FREE', () => {
    const res = calculateDeliveryPricing(2001, 50);
    assert.strictEqual(res.productSubtotal, 2001);
    assert.strictEqual(res.deliveryCharge, 0);
    assert.strictEqual(res.netPayable, 2001);
    assert.strictEqual(res.effectivePricePerKg, 40.02);
    assert.strictEqual(res.deliveryStatus, 'FREE');
    assert.strictEqual(res.freeDeliveryEligible, true);
    assert.strictEqual(res.amountNeededForFreeDelivery, 0);
  });

  // Test Case E: productSubtotal = ₹5,000 (Well above threshold)
  test('Case E: productSubtotal = ₹5,000 => delivery = ₹0, net = ₹5,000, FREE', () => {
    const res = calculateDeliveryPricing(5000, 100);
    assert.strictEqual(res.productSubtotal, 5000);
    assert.strictEqual(res.deliveryCharge, 0);
    assert.strictEqual(res.netPayable, 5000);
    assert.strictEqual(res.effectivePricePerKg, 50);
    assert.strictEqual(res.deliveryStatus, 'FREE');
    assert.strictEqual(res.freeDeliveryEligible, true);
    assert.strictEqual(res.amountNeededForFreeDelivery, 0);
  });

  // Test Case F: Multi-farmer subtotal ₹800 + ₹700 = ₹1,500
  test('Case F: Multi-farmer ₹800 + ₹700 = ₹1,500 => single delivery ₹40 (NOT ₹80), net = ₹1,540', () => {
    const res = calculateDeliveryPricing(1500, 50);
    assert.strictEqual(res.productSubtotal, 1500);
    assert.strictEqual(res.deliveryCharge, 40, 'Multi-farmer order must charge single delivery fee');
    assert.strictEqual(res.netPayable, 1540);
    assert.strictEqual(res.effectivePricePerKg, 30.8);
  });

  // Test Case G: Multi-farmer subtotal ₹1,200 + ₹1,000 = ₹2,200
  test('Case G: Multi-farmer ₹1,200 + ₹1,000 = ₹2,200 => delivery = ₹0 (crosses threshold combined)', () => {
    const res = calculateDeliveryPricing(2200, 60);
    assert.strictEqual(res.productSubtotal, 2200);
    assert.strictEqual(res.deliveryCharge, 0);
    assert.strictEqual(res.netPayable, 2200);
    assert.strictEqual(res.deliveryStatus, 'FREE');
  });

  // Test Case H: Zero quantity or unallocated order
  test('Case H: Zero quantity / unallocated order => delivery = ₹40, effectivePrice = NOT_APPLICABLE (No NaN/div-by-zero)', () => {
    const res = calculateDeliveryPricing(0, 0);
    assert.strictEqual(res.productSubtotal, 0);
    assert.strictEqual(res.deliveryCharge, 40);
    assert.strictEqual(res.netPayable, 40);
    assert.strictEqual(res.effectivePricePerKg, 'NOT_APPLICABLE');
    assert.strictEqual(Number.isNaN(res.netPayable), false);
  });

  // Test Case I: Negative / Invalid input validation
  test('Case I: Negative or NaN price/quantity throws descriptive error', () => {
    assert.throws(() => calculateDeliveryPricing(-100, 10), /non-negative number/);
    assert.throws(() => calculateDeliveryPricing(500, -5), /cannot be negative/);
    assert.throws(() => calculateDeliveryPricing('abc', 10), /valid non-negative number/);
  });

  // Test Case J: Client vs Server parity
  test('Case J: Client and Server delivery calculation algorithms produce 100% identical outputs', () => {
    const testCases = [
      { subtotal: 0, qty: 0 },
      { subtotal: 500, qty: 15 },
      { subtotal: 1999.99, qty: 60 },
      { subtotal: 2000, qty: 50 },
      { subtotal: 2000.01, qty: 50 },
      { subtotal: 2001, qty: 50 },
      { subtotal: 7500, qty: 250 },
    ];

    for (const tc of testCases) {
      const serverRes = calculateDeliveryPricing(tc.subtotal, tc.qty);
      const clientRes = clientCalculateDeliveryPricing(tc.subtotal, tc.qty);
      assert.strictEqual(serverRes.productSubtotal, clientRes.productSubtotal);
      assert.strictEqual(serverRes.deliveryCharge, clientRes.deliveryCharge);
      assert.strictEqual(serverRes.netPayable, clientRes.netPayable);
      assert.strictEqual(serverRes.effectivePricePerKg, clientRes.effectivePricePerKg);
      assert.strictEqual(serverRes.deliveryStatus, clientRes.deliveryStatus);
      assert.strictEqual(serverRes.amountNeededForFreeDelivery, clientRes.amountNeededForFreeDelivery);
    }
  });

  // ----------------------------------------------------
  // End-to-End Engine & Store Integration Verification
  // ----------------------------------------------------

  // Test Case K: Matching engine preview outputs DLV-001 fields
  test('Case K: Matching Engine allocateMultiFarmerOrder outputs DLV-001 fields', () => {
    const dummyListings = [
      { id: 'l1', crop: 'wheat', variety: 'Sharbati', quantity: 30, price: 30, location: 'Nashik', quality: { grade: 'A' } },
      { id: 'l2', crop: 'wheat', variety: 'Sharbati', quantity: 30, price: 30, location: 'Nashik', quality: { grade: 'A' } },
    ];
    // 60kg * ₹30 = ₹1,800 <= 2000 => delivery ₹40
    const plan = allocateMultiFarmerOrder({ crop: 'wheat', variety: 'Sharbati', quantity: 60 }, dummyListings);
    assert.strictEqual(plan.fulfilledQuantity, 60);
    assert.strictEqual(plan.productSubtotal, 1800);
    assert.strictEqual(plan.deliveryCharge, 40);
    assert.strictEqual(plan.netPayable, 1840);
    assert.strictEqual(plan.effectivePricePerKg, Math.round((1840 / 60) * 100) / 100);
    assert.strictEqual(plan.deliveryStatus, 'CHARGED');
    assert.strictEqual(plan.freeDeliveryEligible, false);
    assert.strictEqual(plan.amountNeededForFreeDelivery, 200.01);
  });

  // Test Case L: Matching engine preview above ₹2,000 threshold
  test('Case L: Matching Engine preview > ₹2,000 outputs delivery = 0 and FREE', () => {
    const dummyListings = [
      { id: 'l1', crop: 'wheat', variety: 'Sharbati', quantity: 50, price: 30, location: 'Nashik', quality: { grade: 'A' } },
      { id: 'l2', crop: 'wheat', variety: 'Sharbati', quantity: 50, price: 30, location: 'Nashik', quality: { grade: 'A' } },
    ];
    // 100kg * ₹30 = ₹3,000 > 2000 => delivery ₹0
    const plan = allocateMultiFarmerOrder({ crop: 'wheat', variety: 'Sharbati', quantity: 100 }, dummyListings);
    assert.strictEqual(plan.fulfilledQuantity, 100);
    assert.strictEqual(plan.productSubtotal, 3000);
    assert.strictEqual(plan.deliveryCharge, 0);
    assert.strictEqual(plan.netPayable, 3000);
    assert.strictEqual(plan.effectivePricePerKg, 30);
    assert.strictEqual(plan.deliveryStatus, 'FREE');
    assert.strictEqual(plan.freeDeliveryEligible, true);
  });

  // Test Case M: Store persistence & dynamic recalculation upon farmer rejection/reallocation
  await asyncTest('Case M: Store persistence & dynamic recalculation across ₹2,000 boundary', async () => {
    await listingStore.init();

    // Create fresh test listings:
    // Farmer A: 50kg @ ₹30 = ₹1,500
    // Farmer B: 30kg @ ₹30 = ₹900
    // Total combined = 80kg @ ₹30 = ₹2,400 (> 2000, FREE delivery)
    const listA = await listingStore.createListing({
      id: 'dlv_test_list_a',
      farmerId: 'farmer_dlv_a',
      farmerName: 'Ramesh',
      crop: 'wheat',
      variety: 'Sharbati',
      quantity: 50,
      price: 30,
      location: 'Pune',
      quality: { grade: 'A' },
    });

    const listB = await listingStore.createListing({
      id: 'dlv_test_list_b',
      farmerId: 'farmer_dlv_b',
      farmerName: 'Suresh',
      crop: 'wheat',
      variety: 'Sharbati',
      quantity: 30,
      price: 30,
      location: 'Pune',
      quality: { grade: 'A' },
    });

    // Create order for 80kg
    const createRes = await listingStore.createMultiFarmerOrder({
      requirement: { crop: 'wheat', variety: 'Sharbati', quantity: 80, buyerLocation: 'Pune' },
      buyerSession: { id: 'buyer_dlv_test', name: 'Buyer Test', mobile: '9999999999' },
    });

    assert.strictEqual(createRes.success, true);
    const order = createRes.order;
    assert.strictEqual(order.fulfilledQuantity, 80);
    assert.strictEqual(order.productSubtotal, 2400);
    assert.strictEqual(order.deliveryCharge, 0, 'Initial order > 2000 must have deliveryCharge = 0');
    assert.strictEqual(order.netPayable, 2400);
    assert.strictEqual(order.deliveryStatus, 'FREE');

    // Find allocation for Farmer B (30kg) and reject it
    const allocB = order.allocations.find((a) => a.listingId === listB.id);
    assert(allocB, 'Allocation for Farmer B should exist');

    // Reject Farmer B's allocation (no replacement supply exists)
    const rejectRes = await listingStore.rejectAllocation(allocB.allocationId, 'farmer_dlv_b');
    assert.strictEqual(rejectRes.success, true);

    const updatedOrder = rejectRes.order;
    // Now active allocations = Farmer A only (50kg @ ₹30 = ₹1,500)
    // ₹1,500 <= 2000 => delivery charge must dynamically update to ₹40!
    assert.strictEqual(updatedOrder.fulfilledQuantity, 50);
    assert.strictEqual(updatedOrder.productSubtotal, 1500);
    assert.strictEqual(updatedOrder.deliveryCharge, 40, 'Dynamic recalculation: subtotal dropped to 1500, delivery must become 40');
    assert.strictEqual(updatedOrder.netPayable, 1540);
    assert.strictEqual(updatedOrder.effectivePricePerKg, 30.8);
    assert.strictEqual(updatedOrder.deliveryStatus, 'CHARGED');

    // Cleanup test listings
    if (listingStore.inMemoryListings) {
      listingStore.inMemoryListings = listingStore.inMemoryListings.filter((l) => !l.id.startsWith('dlv_test_'));
      listingStore.saveLocalStore();
    }
  });

  console.log('\n====================================================');
  console.log(`SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Test runner fatal error:', err);
  process.exit(1);
});
