// tests/bfm_verification.js
import assert from 'assert';
import { allocateMultiFarmerOrder, groupListingsByVariety, scoreListingMatch } from '../server/matchingEngine.js';
import { CROP_KEYS, CROP_VARIETIES, getCropVarieties, normalizeVariety } from '../server/cropConstants.js';
import { listingStore } from '../server/listingStore.js';
import { calculateFairPrice as serverCalculateFairPrice } from '../server/fairPrice.js';
import { calculateFairPrice as clientCalculateFairPrice } from '../src/utils/fairPrice.js';

async function runTests() {
  console.log('====================================================');
  console.log('  PRAGATI BFM-001 & CROP-001 VERIFICATION SUITE');
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

  await listingStore.init();
  if (Array.isArray(listingStore.inMemoryListings)) {
    listingStore.inMemoryListings = listingStore.inMemoryListings.filter(
      (l) => !l.id.startsWith('test_') && !l.id.startsWith('list_fair_price_test_')
    );
    listingStore.saveLocalStore();
  }

  // 1. CROP-001 Scope Check
  test('CROP-001: Strict 4 crops canonical scope', () => {
    assert.deepStrictEqual(CROP_KEYS, ['rice', 'wheat', 'chana_dal', 'toor_dal']);
    assert(CROP_VARIETIES['rice'].includes('Basmati'));
    assert(CROP_VARIETIES['rice'].includes('Sona Masoori'));
    assert(CROP_VARIETIES['wheat'].includes('Sharbati'));
    assert(CROP_VARIETIES['chana_dal'].includes('Desi'));
    assert(CROP_VARIETIES['toor_dal'].includes('Fatka'));
  });

  // 2. Scenario A: Multi-farmer full fulfillment
  test('Scenario A: Multi-farmer full fulfillment (300kg + 200kg = 500kg)', () => {
    const requirement = {
      crop: 'wheat',
      quantity: 500,
      variety: 'Sharbati',
      buyerLocation: 'Indore',
    };
    const listings = [
      {
        id: 'L1',
        farmerId: 'F1',
        farmerName: 'Ramesh',
        crop: 'wheat',
        variety: 'Sharbati',
        quantity: 300,
        reservedQuantity: 0,
        price: 25,
        location: 'Indore',
        quality: { grade: 'A', score: 92 },
      },
      {
        id: 'L2',
        farmerId: 'F2',
        farmerName: 'Suresh',
        crop: 'wheat',
        variety: 'Sharbati',
        quantity: 200,
        reservedQuantity: 0,
        price: 26,
        location: 'Ujjain',
        quality: { grade: 'B', score: 80 },
      },
    ];

    const plan = allocateMultiFarmerOrder(requirement, listings);
    assert.strictEqual(plan.matchStatus, 'FULL');
    assert.strictEqual(plan.fulfilledQuantity, 500);
    assert.strictEqual(plan.remainingQuantity, 0);
    assert.strictEqual(plan.allocations.length, 2);
    assert.strictEqual(plan.allocations[0].allocatedQuantity, 300);
    assert.strictEqual(plan.allocations[1].allocatedQuantity, 200);
    assert(plan.weightedAveragePrice > 0);
  });

  // 3. Scenario B: Variety match
  test('Scenario B: Variety match (Basmati requested, only Basmati allocated)', () => {
    const requirement = {
      crop: 'rice',
      variety: 'Basmati',
      quantity: 400,
      buyerLocation: 'Delhi',
    };
    const listings = [
      {
        id: 'L_BASMATI',
        farmerId: 'F1',
        farmerName: 'Farmer Basmati',
        crop: 'rice',
        variety: 'Basmati',
        quantity: 400,
        price: 60,
        location: 'Karnal',
        quality: { grade: 'A', score: 95 },
      },
      {
        id: 'L_SONA',
        farmerId: 'F2',
        farmerName: 'Farmer Sona',
        crop: 'rice',
        variety: 'Sona Masoori',
        quantity: 400,
        price: 40,
        location: 'Karnal',
        quality: { grade: 'A', score: 95 },
      },
    ];

    const plan = allocateMultiFarmerOrder(requirement, listings);
    assert.strictEqual(plan.matchStatus, 'FULL');
    assert.strictEqual(plan.fulfilledQuantity, 400);
    assert.strictEqual(plan.allocations.length, 1);
    assert.strictEqual(plan.allocations[0].listingId, 'L_BASMATI');
  });

  // 4. Scenario C: Variety exclusion
  test('Scenario C: Variety exclusion (Basmati requested, only Sona Masoori available -> NO_MATCH)', () => {
    const requirement = {
      crop: 'rice',
      variety: 'Basmati',
      quantity: 300,
      buyerLocation: 'Delhi',
    };
    const listings = [
      {
        id: 'L_SONA',
        farmerId: 'F2',
        farmerName: 'Farmer Sona',
        crop: 'rice',
        variety: 'Sona Masoori',
        quantity: 500,
        price: 35,
        location: 'Nellore',
        quality: { grade: 'A', score: 90 },
      },
    ];

    const plan = allocateMultiFarmerOrder(requirement, listings);
    assert.strictEqual(plan.matchStatus, 'NO_MATCH');
    assert.strictEqual(plan.fulfilledQuantity, 0);
    assert.strictEqual(plan.allocations.length, 0);
  });

  // 5. Scenario D: Variety unspecified (distinct homogeneous groups, never mixed)
  await asyncTest('Scenario D: Variety unspecified - candidates grouped by variety, never mixed in real allocation or store paths', async () => {
    const requirement = {
      crop: 'rice',
      variety: null, // Any variety / unspecified
      quantity: 600,
      buyerLocation: 'Delhi',
    };
    const listings = [
      {
        id: 'L_BASMATI_D',
        farmerId: 'F1',
        farmerName: 'Farmer Basmati',
        crop: 'rice',
        variety: 'Basmati',
        quantity: 300,
        reservedQuantity: 0,
        price: 60,
        location: 'Delhi',
        quality: { grade: 'A', score: 90 },
      },
      {
        id: 'L_SONA_D',
        farmerId: 'F2',
        farmerName: 'Farmer Sona',
        crop: 'rice',
        variety: 'Sona Masoori',
        quantity: 400,
        reservedQuantity: 0,
        price: 40,
        location: 'Delhi',
        quality: { grade: 'A', score: 92 },
      },
    ];

    // Part 1: Standalone grouping helper test
    const varietyGroups = groupListingsByVariety(listings);
    assert(varietyGroups['Basmati']);
    assert(varietyGroups['Sona Masoori']);
    assert.strictEqual(varietyGroups['Basmati'].length, 1);
    assert.strictEqual(varietyGroups['Sona Masoori'].length, 1);

    // Part 2: Real allocation engine path: MUST NOT blend 300kg Basmati + 400kg Sona Masoori
    const plan = allocateMultiFarmerOrder(requirement, listings);
    assert(plan.allocations.length > 0, 'Plan should have allocations');
    // All allocations must share the exact same variety (homogeneous)
    const winningVariety = plan.allocations[0].variety;
    const allSameVariety = plan.allocations.every((a) => a.variety === winningVariety);
    assert.strictEqual(allSameVariety, true, 'Allocations must be strictly homogeneous');
    // Sona Masoori fulfills 400kg vs Basmati 300kg, so Sona Masoori is selected
    assert.strictEqual(winningVariety, 'Sona Masoori');
    assert.strictEqual(plan.fulfilledQuantity, 400);
    assert.strictEqual(plan.allocations.some((a) => a.variety === 'Basmati'), false, 'Basmati must not be blended');
    assert(plan.varietyPlans);
    assert(plan.varietyPlans['Basmati']);
    assert(plan.varietyPlans['Sona Masoori']);

    // Part 3: Real listingStore / store allocation path test
    const listBasmatiId = 'test_d_basmati_' + Date.now();
    const listSonaId = 'test_d_sona_' + Date.now();

    try {
      await listingStore.createListing({
        id: listBasmatiId,
        farmerId: 'farmer_d1',
        farmerName: 'Farmer D1',
        crop: 'rice',
        variety: 'Basmati',
        quantity: 300,
        reservedQuantity: 0,
        price: 60,
        location: 'Delhi',
        quality: { grade: 'A', score: 90 },
      });

      await listingStore.createListing({
        id: listSonaId,
        farmerId: 'farmer_d2',
        farmerName: 'Farmer D2',
        crop: 'rice',
        variety: 'Sona Masoori',
        quantity: 400,
        reservedQuantity: 0,
        price: 40,
        location: 'Delhi',
        quality: { grade: 'A', score: 92 },
      });

      const storeOrderRes = await listingStore.createMultiFarmerOrder({
        requirement: {
          crop: 'rice',
          variety: null, // Unspecified
          quantity: 600,
          buyerLocation: 'Delhi',
        },
        buyerSession: { id: 'buyer_d', name: 'Buyer D' },
      });

      assert(storeOrderRes.success, 'Store allocation should succeed');
      const parentOrder = storeOrderRes.order;
      assert.strictEqual(parentOrder.crop, 'rice');
      assert.strictEqual(parentOrder.variety, 'Sona Masoori');
      assert.strictEqual(parentOrder.fulfilledQuantity, 400);
      // Verify parent order allocations never mix different varieties
      const orderVarieties = new Set(parentOrder.allocations.map((a) => a.variety));
      assert.strictEqual(orderVarieties.size, 1, 'Parent order must contain exactly 1 variety');
      assert(orderVarieties.has('Sona Masoori'));
      assert(!orderVarieties.has('Basmati'), 'Basmati must not be blended into Sona Masoori order');

      // Verify inventory reservation in store: Sona Masoori reserved 400, Basmati remained untouched (0 reserved)
      const sonaCheck = await listingStore.getListingById(listSonaId);
      assert.strictEqual(sonaCheck.reservedQuantity, 400);
      const basmatiCheck = await listingStore.getListingById(listBasmatiId);
      assert.strictEqual(basmatiCheck.reservedQuantity, 0, 'Incompatible variety must not be reserved');
    } finally {
      // Clean up test listings
      await listingStore.deleteListing(listBasmatiId);
      await listingStore.deleteListing(listSonaId);
    }
  });

  // 6. Scenario E: Minimum Grade Filter
  test('Scenario E: Minimum Grade B rejects Grade C produce', () => {
    const requirement = {
      crop: 'chana_dal',
      quantity: 200,
      minGrade: 'B',
      buyerLocation: 'Nagpur',
    };
    const listings = [
      {
        id: 'L_A',
        farmerId: 'F1',
        crop: 'chana_dal',
        variety: 'Desi',
        quantity: 100,
        price: 70,
        quality: { grade: 'A', score: 91 },
      },
      {
        id: 'L_C',
        farmerId: 'F2',
        crop: 'chana_dal',
        variety: 'Desi',
        quantity: 100,
        price: 60,
        quality: { grade: 'C', score: 55 },
      },
    ];

    const plan = allocateMultiFarmerOrder(requirement, listings);
    assert.strictEqual(plan.fulfilledQuantity, 100);
    assert.strictEqual(plan.allocations.length, 1);
    assert.strictEqual(plan.allocations[0].listingId, 'L_A');
  });

  // 7. Scenario F: Partial fulfillment
  test('Scenario F: Partial fulfillment (450kg allocated out of 600kg requested)', () => {
    const requirement = {
      crop: 'toor_dal',
      quantity: 600,
      variety: 'Desi',
      buyerLocation: 'Latur',
    };
    const listings = [
      {
        id: 'L1',
        farmerId: 'F1',
        crop: 'toor_dal',
        variety: 'Desi',
        quantity: 250,
        price: 110,
        quality: { grade: 'A', score: 88 },
      },
      {
        id: 'L2',
        farmerId: 'F2',
        crop: 'toor_dal',
        variety: 'Desi',
        quantity: 200,
        price: 112,
        quality: { grade: 'B', score: 82 },
      },
    ];

    const plan = allocateMultiFarmerOrder(requirement, listings);
    assert.strictEqual(plan.matchStatus, 'PARTIAL');
    assert.strictEqual(plan.fulfilledQuantity, 450);
    assert.strictEqual(plan.remainingQuantity, 150);
    assert.strictEqual(plan.allocations.length, 2);
  });

  // 8. Scenario G: Atomic Store Concurrency & Inventory Reservation
  await asyncTest('Scenario G: Atomic reservation prevents overselling beyond stock', async () => {
    // Clean slate test listing
    const listingId = 'test_listing_concurrency_' + Date.now();
    await listingStore.createListing({
      id: listingId,
      farmerId: 'farmer_g',
      farmerName: 'Farmer G',
      crop: 'wheat',
      variety: 'Lokwan',
      quantity: 300,
      reservedQuantity: 0,
      price: 24,
      location: 'Sehore',
      quality: { grade: 'A', score: 89 },
    });

    // Buyer 1 requests 200kg
    const order1 = await listingStore.createMultiFarmerOrder({
      requirement: {
        crop: 'wheat',
        variety: 'Lokwan',
        quantity: 200,
        buyerLocation: 'Bhopal',
      },
      buyerSession: { id: 'buyer_1', name: 'Buyer 1' },
    });

    assert(order1.success, 'Buyer 1 order should succeed');
    assert.strictEqual(order1.order.fulfilledQuantity, 200);

    // Verify listing available quantity decremented to 100
    const listingAfter1 = await listingStore.getListingById(listingId);
    assert.strictEqual(listingAfter1.reservedQuantity, 200);
    assert.strictEqual(listingAfter1.quantity - listingAfter1.reservedQuantity, 100);

    // Buyer 2 requests 200kg concurrently (only 100kg left!)
    const order2 = await listingStore.createMultiFarmerOrder({
      requirement: {
        crop: 'wheat',
        variety: 'Lokwan',
        quantity: 200,
        buyerLocation: 'Bhopal',
      },
      buyerSession: { id: 'buyer_2', name: 'Buyer 2' },
    });

    assert(order2.success, 'Buyer 2 order should process');
    // Only remaining 100kg could be fulfilled
    assert.strictEqual(order2.order.fulfilledQuantity, 100);
    assert.strictEqual(order2.order.matchStatus, 'PARTIAL');

    const listingAfter2 = await listingStore.getListingById(listingId);
    assert.strictEqual(listingAfter2.reservedQuantity, 300);
    assert.strictEqual(listingAfter2.quantity - listingAfter2.reservedQuantity, 0);

    // Clean up test listing
    await listingStore.deleteListing(listingId);
  });

  // 9. Reallocation Test on Farmer Rejection
  await asyncTest('Scenario H: Farmer rejects allocation -> automatic reallocation to next candidate', async () => {
    const listA_id = 'test_realloc_a_' + Date.now();
    const listB_id = 'test_realloc_b_' + Date.now();

    await listingStore.createListing({
      id: listA_id,
      farmerId: 'farmer_a',
      farmerName: 'Farmer A',
      crop: 'toor_dal',
      variety: 'Fatka',
      quantity: 100,
      reservedQuantity: 0,
      price: 110,
      location: 'Akola',
      quality: { grade: 'A', score: 95 },
    });

    await listingStore.createListing({
      id: listB_id,
      farmerId: 'farmer_b',
      farmerName: 'Farmer B',
      crop: 'toor_dal',
      variety: 'Fatka',
      quantity: 100,
      reservedQuantity: 0,
      price: 115,
      location: 'Akola',
      quality: { grade: 'B', score: 85 },
    });

    // Place 100kg order (Rank 1 Farmer A gets allocated)
    const orderRes = await listingStore.createMultiFarmerOrder({
      requirement: {
        crop: 'toor_dal',
        variety: 'Fatka',
        quantity: 100,
        buyerLocation: 'Akola',
      },
      buyerSession: { id: 'buyer_realloc', name: 'Realloc Buyer' },
    });

    assert(orderRes.success);
    const allocA = orderRes.order.allocations.find((a) => a.farmerId === 'farmer_a');
    assert(allocA, 'Farmer A should have received the allocation');

    // Farmer A rejects allocation
    const rejectRes = await listingStore.rejectAllocation(allocA.id, 'farmer_a');
    assert(rejectRes.success, 'Rejection should succeed');
    assert(rejectRes.reallocated, 'Should have automatically reallocated');

    // Verify Farmer A's reservation released and Farmer B allocated
    const checkA = await listingStore.getListingById(listA_id);
    assert.strictEqual(checkA.reservedQuantity, 0, "Farmer A's reservation must be cleared");

    const checkB = await listingStore.getListingById(listB_id);
    assert.strictEqual(checkB.reservedQuantity, 100, "Farmer B's reservation must now be reserved");

    // Clean up
    await listingStore.deleteListing(listA_id);
    await listingStore.deleteListing(listB_id);
  });

  // 10. Rice Variety Pricing Hierarchy
  test('Pricing: Rice variety hierarchy (1121 Basmati > Basmati > Sona Masoori > PR-14 > Regular)', () => {
    const p1121 = serverCalculateFairPrice({ crop: 'rice', variety: '1121 Basmati', quantity: 100 });
    const pBasmati = serverCalculateFairPrice({ crop: 'rice', variety: 'Basmati', quantity: 100 });
    const pSona = serverCalculateFairPrice({ crop: 'rice', variety: 'Sona Masoori', quantity: 100 });
    const pPR14 = serverCalculateFairPrice({ crop: 'rice', variety: 'PR-14', quantity: 100 });
    const pRegular = serverCalculateFairPrice({ crop: 'rice', variety: 'Regular', quantity: 100 });

    assert(p1121.suggestedPrice > pBasmati.suggestedPrice, '1121 Basmati must be > Basmati');
    assert(pBasmati.suggestedPrice > pSona.suggestedPrice, 'Basmati must be > Sona Masoori');
    assert(pSona.suggestedPrice >= pPR14.suggestedPrice, 'Sona Masoori must be >= PR-14');
    assert(pPR14.suggestedPrice > pRegular.suggestedPrice, 'PR-14 must be > Regular');
    assert.strictEqual(pRegular.varietyMultiplier, 1.00);
    assert.strictEqual(p1121.varietyMultiplier, 1.50);
  });

  // 11. Wheat Variety Pricing Hierarchy
  test('Pricing: Wheat variety hierarchy (Sharbati > Lokwan > DBW 187 > HD 2967 > Regular)', () => {
    const pSharbati = serverCalculateFairPrice({ crop: 'wheat', variety: 'Sharbati', quantity: 100 });
    const pLokwan = serverCalculateFairPrice({ crop: 'wheat', variety: 'Lokwan', quantity: 100 });
    const pDBW = serverCalculateFairPrice({ crop: 'wheat', variety: 'DBW 187', quantity: 100 });
    const pHD = serverCalculateFairPrice({ crop: 'wheat', variety: 'HD 2967', quantity: 100 });
    const pRegular = serverCalculateFairPrice({ crop: 'wheat', variety: 'Regular', quantity: 100 });

    assert(pSharbati.suggestedPrice > pLokwan.suggestedPrice, 'Sharbati must be > Lokwan');
    assert(pLokwan.suggestedPrice > pDBW.suggestedPrice, 'Lokwan must be > DBW 187');
    assert(pDBW.suggestedPrice >= pHD.suggestedPrice, 'DBW 187 must be >= HD 2967');
    assert(pHD.suggestedPrice > pRegular.suggestedPrice, 'HD 2967 must be > Regular');
    assert.strictEqual(pRegular.varietyMultiplier, 1.00);
    assert.strictEqual(pSharbati.varietyMultiplier, 1.20);
  });

  // 12. Chana Dal Variety Pricing Hierarchy
  test('Pricing: Chana Dal variety hierarchy (Kabuli > Desi > Regular)', () => {
    const pKabuli = serverCalculateFairPrice({ crop: 'chana_dal', variety: 'Kabuli', quantity: 100 });
    const pDesi = serverCalculateFairPrice({ crop: 'chana_dal', variety: 'Desi', quantity: 100 });
    const pRegular = serverCalculateFairPrice({ crop: 'chana_dal', variety: 'Regular', quantity: 100 });

    assert(pKabuli.suggestedPrice > pDesi.suggestedPrice, 'Kabuli must be > Desi');
    assert(pDesi.suggestedPrice > pRegular.suggestedPrice, 'Desi must be > Regular');
    assert.strictEqual(pRegular.varietyMultiplier, 1.00);
    assert.strictEqual(pKabuli.varietyMultiplier, 1.20);
    assert.strictEqual(pDesi.varietyMultiplier, 1.08);
  });

  // 13. Toor Dal Variety Pricing Hierarchy
  test('Pricing: Toor Dal variety hierarchy (Asha > Regular)', () => {
    const pAsha = serverCalculateFairPrice({ crop: 'toor_dal', variety: 'Asha', quantity: 100 });
    const pRegular = serverCalculateFairPrice({ crop: 'toor_dal', variety: 'Regular', quantity: 100 });

    assert(pAsha.suggestedPrice > pRegular.suggestedPrice, 'Asha must be > Regular');
    assert.strictEqual(pRegular.varietyMultiplier, 1.00);
    assert.strictEqual(pAsha.varietyMultiplier, 1.12);
  });

  // 14. Deterministic Parity Between Client and Server Price Engines
  test('Pricing: Deterministic parity between client and server engines', () => {
    const crops = ['rice', 'wheat', 'chana_dal', 'toor_dal'];
    for (const c of crops) {
      const vars = getCropVarieties(c);
      for (const v of vars) {
        const clientRes = clientCalculateFairPrice({ crop: c, variety: v, quantity: 250, grade: 'A' });
        const serverRes = serverCalculateFairPrice({ crop: c, variety: v, quantity: 250, grade: 'A' });
        assert.strictEqual(
          clientRes.suggestedPrice,
          serverRes.suggestedPrice,
          `Client and server suggested price mismatch for ${c} / ${v}`
        );
        assert.strictEqual(
          clientRes.varietyMultiplier,
          serverRes.varietyMultiplier,
          `Client and server multiplier mismatch for ${c} / ${v}`
        );
      }
    }
  });

  // 15. Quality Grade & Volume Tier Adjustments
  test('Pricing: Quality grade and volume tier adjustments operate correctly', () => {
    const pGradeA = serverCalculateFairPrice({ crop: 'wheat', variety: 'Lokwan', quantity: 100, grade: 'A' });
    const pGradeB = serverCalculateFairPrice({ crop: 'wheat', variety: 'Lokwan', quantity: 100, grade: 'B' });
    const pGradeC = serverCalculateFairPrice({ crop: 'wheat', variety: 'Lokwan', quantity: 100, grade: 'C' });

    assert(pGradeA.suggestedPrice > pGradeB.suggestedPrice, 'Grade A price must be > Grade B');
    assert(pGradeB.suggestedPrice > pGradeC.suggestedPrice, 'Grade B price must be > Grade C');
    assert.strictEqual(pGradeA.gradeMultiplier, 1.20);
    assert.strictEqual(pGradeB.gradeMultiplier, 1.00);
    assert.strictEqual(pGradeC.gradeMultiplier, 0.80);

    // Volume tiers: wholesale batch (2000kg) vs retail lot (50kg)
    const pWholesale = serverCalculateFairPrice({ crop: 'wheat', variety: 'Lokwan', quantity: 2500 });
    const pRetail = serverCalculateFairPrice({ crop: 'wheat', variety: 'Lokwan', quantity: 50 });
    assert(pRetail.suggestedPrice > pWholesale.suggestedPrice, 'Small retail lot rate must be > wholesale bulk lot');
    assert.strictEqual(pWholesale.volumeMultiplier, 0.92);
    assert.strictEqual(pRetail.volumeMultiplier, 1.05);
  });

  // 16. Safe Fallbacks & Non-Negative / Non-Zero Guarantee
  test('Pricing: Safe fallbacks for missing variety and non-negative guarantee', () => {
    const pNull = serverCalculateFairPrice({ crop: 'rice', variety: null, quantity: 0 });
    assert(pNull.suggestedPrice > 0, 'Suggested price must be positive');
    assert.strictEqual(pNull.variety, 'Regular');
    assert.strictEqual(pNull.varietyMultiplier, 1.00);

    const pInvalid = serverCalculateFairPrice({ crop: 'rice', variety: 'unknown_xyz', quantity: -50 });
    assert(pInvalid.suggestedPrice > 0, 'Suggested price must be positive despite invalid qty');
    assert(!isNaN(pInvalid.suggestedPrice), 'Suggested price must not be NaN');
  });

  // 17. Authoritative Backend Calculation on Listing Creation & Update
  await asyncTest('Pricing: Authoritative backend recalculation on listing creation & update', async () => {
    const testListId = 'list_fair_price_test_' + Date.now();

    try {
      // Farmer submits listing with Basmati Rice and bogus fairPrice
      const created = await listingStore.createListing({
        id: testListId,
        farmerId: 'farmer_fp_test',
        crop: 'rice',
        variety: 'Basmati',
        quantity: 500,
        price: 50,
        fairPrice: { suggestedPrice: 1 }, // Bogus client price
        location: 'Karnal',
      });

      assert.strictEqual(created.variety, 'Basmati');
      assert(created.fairPrice, 'Listing must contain server-computed fairPrice');
      // Expected: 35 * 1.35 * 1.00 * 0.96 = 45.36 -> 45
      assert.strictEqual(created.fairPrice.varietyMultiplier, 1.35);
      assert.strictEqual(created.fairPrice.suggestedPrice, 45, 'Server must override client fairPrice with authoritative 45');

      // Update variety to 1121 Basmati
      const updated = await listingStore.updateListing(testListId, {
        variety: '1121 Basmati',
      });

      assert.strictEqual(updated.variety, '1121 Basmati');
      // Expected: 35 * 1.50 * 1.00 * 0.96 = 50.4 -> 50
      assert.strictEqual(updated.fairPrice.varietyMultiplier, 1.50);
      assert.strictEqual(updated.fairPrice.suggestedPrice, 50, 'Server must recalculate fairPrice to 50 on variety update');
    } finally {
      // Clean up
      await listingStore.deleteListing(testListId);
    }
  });

  console.log('\n====================================================');
  console.log(`  VERIFICATION RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
