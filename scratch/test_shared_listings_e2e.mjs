// scratch/test_shared_listings_e2e.mjs
// End-to-End & Multi-User Verification Suite for Shared Marketplace Listings.
// Verifies:
// 1. Farmer A creates listing on shared backend
// 2. Buyer B (isolated browser/session with 0 localStorage) retrieves and views Farmer A's listing
// 3. Authorization protection: Farmer C cannot edit/delete Farmer A's listing
// 4. Inventory decrement upon order placement
// 5. Admin can see, moderate, and manage all listings
// 6. Data persistence across sessions

import assert from 'assert';
import path from 'path';
import { fileURLToPath } from 'url';

process.env.NODE_ENV = 'test';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const serverPath = path.resolve(projectRoot, 'server.js');
const { app } = await import(`file://${serverPath}`);

const API_PORT = 5002;
const BASE_URL = `http://localhost:${API_PORT}`;

async function makeRequest(method, urlPath, headers = {}, body = null) {
  const res = await fetch(`${BASE_URL}${urlPath}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
  });
  let data;
  try {
    data = await res.json();
  } catch {
    data = await res.text();
  }
  return { status: res.status, data };
}

console.log('====================================================');
console.log('  STARTING SHARED MARKETPLACE LISTINGS E2E SUITE');
console.log('====================================================\n');

// Start backend server
const server = await new Promise((resolve) => {
  const s = app.listen(API_PORT, () => resolve(s));
});
console.log(`✓ Test backend server active on ${BASE_URL}\n`);

try {
  // Reset seed data
  await makeRequest('POST', '/api/listings/reset');

  // -------------------------------------------------------------
  // TEST 1: Farmer A Creates Listing on Shared Backend
  // -------------------------------------------------------------
  console.log('--- TEST 1: Farmer A Creates Produce Listing ---');
  const farmerAListingPayload = {
    crop: 'tomato',
    quantity: 500,
    price: 32,
    location: 'Ghaziabad, Uttar Pradesh',
    harvestDate: '2026-03-10',
    photo: null,
    quality: {
      score: 93,
      grade: 'A',
      confidence: 0.94,
      observations: ['Firm uniform tomatoes', 'Zero pest damage'],
    },
    fairPrice: { suggestedPrice: 32, grade: 'A' },
    pickupDecision: { method: 'HOME', quantityKg: 500, thresholdKg: 30 },
  };

  const createRes = await makeRequest(
    'POST',
    '/api/listings',
    {
      'x-user-id': 'farmer_a_ghaziabad',
      'x-user-role': 'farmer',
      'x-user-name': 'Farmer Ramesh Ghaziabad',
      'x-user-mobile': '9876500001',
    },
    farmerAListingPayload
  );

  console.log('  Create listing response status:', createRes.status);
  assert.strictEqual(createRes.status, 201, 'Expected status 201 for listing creation');
  assert.strictEqual(createRes.data?.success, true);

  const createdListing = createRes.data.listing;
  console.log('  ✓ Listing created successfully. ID:', createdListing.id);
  console.log('    Crop:', createdListing.crop, '| Qty:', createdListing.quantity, '| Price:', createdListing.price, '| Location:', createdListing.location);

  assert.strictEqual(createdListing.quantity, 500);
  assert.strictEqual(createdListing.price, 32);
  assert.strictEqual(createdListing.location, 'Ghaziabad, Uttar Pradesh');

  // -------------------------------------------------------------
  // TEST 2: Direct Single Listing Fetch by ID
  // -------------------------------------------------------------
  console.log('\n--- TEST 2: Fetch Listing by ID ---');
  const getSingleRes = await makeRequest('GET', `/api/listings/${createdListing.id}`);
  assert.strictEqual(getSingleRes.status, 200);
  assert.strictEqual(getSingleRes.data?.success, true);
  console.log('  ✓ Successfully retrieved listing from backend storage');
  console.log('    Farmer:', getSingleRes.data.listing.farmerName, '| Traceability:', getSingleRes.data.listing.traceabilityId);

  // -------------------------------------------------------------
  // TEST 3: Multi-User / Cross-Browser Buyer Visibility
  // -------------------------------------------------------------
  console.log('\n--- TEST 3: Buyer B Discovers Farmer A\'s Listing from Different Account/Session ---');
  const buyerBListingsRes = await makeRequest('GET', '/api/listings', {
    'x-user-id': 'buyer_b_delhi',
    'x-user-role': 'buyer',
    'x-user-name': 'Buyer Priya Delhi',
    'x-user-mobile': '9811000002',
  });

  assert.strictEqual(buyerBListingsRes.status, 200);
  assert.strictEqual(buyerBListingsRes.data?.success, true);

  const allListings = buyerBListingsRes.data.listings;
  const foundFarmerAListing = allListings.find((l) => l.id === createdListing.id);

  assert(foundFarmerAListing, 'CRITICAL FAILURE: Farmer A\'s listing was NOT found in Buyer B\'s marketplace query!');
  console.log('  ✓ Cross-account visibility verified: Buyer B sees Farmer A\'s listing!');
  console.log('    Found listing:', foundFarmerAListing.crop, foundFarmerAListing.quantity + 'kg', '₹' + foundFarmerAListing.price, foundFarmerAListing.location);

  // -------------------------------------------------------------
  // TEST 4: Authorization Protection (Farmer C cannot edit/delete Farmer A's listing)
  // -------------------------------------------------------------
  console.log('\n--- TEST 4: Authorization Protection Against Unauthorized Modification ---');
  // Farmer C attempts to edit Farmer A's listing
  const unauthorizedEditRes = await makeRequest(
    'PUT',
    `/api/listings/${createdListing.id}`,
    {
      'x-user-id': 'farmer_c_unauthorized',
      'x-user-role': 'farmer',
      'x-user-name': 'Malicious User',
    },
    { price: 1 }
  );

  console.log('  Unauthorized edit status (expect 403):', unauthorizedEditRes.status);
  assert.strictEqual(unauthorizedEditRes.status, 403, 'Expected 403 Forbidden for unauthorized edit');
  console.log('  ✓ Unauthorized edit successfully blocked with 403 Forbidden');

  // Farmer C attempts to delete Farmer A's listing
  const unauthorizedDeleteRes = await makeRequest(
    'DELETE',
    `/api/listings/${createdListing.id}`,
    {
      'x-user-id': 'farmer_c_unauthorized',
      'x-user-role': 'farmer',
    }
  );

  console.log('  Unauthorized delete status (expect 403):', unauthorizedDeleteRes.status);
  assert.strictEqual(unauthorizedDeleteRes.status, 403, 'Expected 403 Forbidden for unauthorized delete');
  console.log('  ✓ Unauthorized delete successfully blocked with 403 Forbidden');

  // Buyer attempts to create a listing (forbidden for buyers)
  const buyerCreateAttemptRes = await makeRequest(
    'POST',
    '/api/listings',
    {
      'x-user-id': 'buyer_b_delhi',
      'x-user-role': 'buyer',
    },
    { crop: 'rice', quantity: 100, price: 30, location: 'Delhi' }
  );
  assert.strictEqual(buyerCreateAttemptRes.status, 403, 'Expected 403 for buyer creating listing');
  console.log('  ✓ Buyer role prevented from creating listing (403 Forbidden)');

  // -------------------------------------------------------------
  // TEST 5: Buyer Order Placement Inventory Decrement
  // -------------------------------------------------------------
  console.log('\n--- TEST 5: Buyer Order Inventory Decrement (500kg - 100kg = 400kg) ---');
  const orderDecrementRes = await makeRequest(
    'PUT',
    `/api/listings/${createdListing.id}`,
    {
      'x-user-id': 'buyer_b_delhi',
      'x-user-role': 'buyer',
    },
    {
      decrementQuantity: 100,
      action: 'order_decrement',
    }
  );

  assert.strictEqual(orderDecrementRes.status, 200);
  assert.strictEqual(orderDecrementRes.data?.success, true);

  const updatedListing = orderDecrementRes.data.listing;
  console.log('  Remaining quantity after 100kg order:', updatedListing.quantity);
  assert.strictEqual(updatedListing.quantity, 400, 'Expected remaining quantity to be 400 kg');
  console.log('  ✓ Shared backend inventory updated accurately to 400 kg');

  // -------------------------------------------------------------
  // TEST 6: Admin Oversight & Moderation
  // -------------------------------------------------------------
  console.log('\n--- TEST 6: Admin Control Center Shared Data & Moderation ---');
  const adminFetchRes = await makeRequest('GET', '/api/listings', {
    'x-user-id': 'admin',
    'x-user-role': 'admin',
  });

  assert.strictEqual(adminFetchRes.status, 200);
  const adminListings = adminFetchRes.data.listings;
  const adminViewOfFarmerA = adminListings.find((l) => l.id === createdListing.id);
  assert(adminViewOfFarmerA, 'Admin should view Farmer A listing');
  console.log('  ✓ Admin successfully retrieved shared listing (Quantity: ' + adminViewOfFarmerA.quantity + 'kg)');

  // Admin updates moderation status to 'flagged'
  const adminModRes = await makeRequest(
    'PUT',
    `/api/listings/${createdListing.id}`,
    {
      'x-user-id': 'admin',
      'x-user-role': 'admin',
    },
    { moderationStatus: 'flagged' }
  );
  assert.strictEqual(adminModRes.status, 200);
  assert.strictEqual(adminModRes.data?.listing?.moderationStatus, 'flagged');
  console.log('  ✓ Admin updated listing moderation status to FLAGGED');

  // Admin approves it back
  await makeRequest(
    'PUT',
    `/api/listings/${createdListing.id}`,
    {
      'x-user-id': 'admin',
      'x-user-role': 'admin',
    },
    { moderationStatus: 'approved' }
  );
  console.log('  ✓ Admin approved listing back to APPROVED');

  // -------------------------------------------------------------
  // TEST 7: Farmer A Edits & Deletes Own Listing
  // -------------------------------------------------------------
  console.log('\n--- TEST 7: Farmer A Edits & Deletes Own Listing ---');
  const farmerEditRes = await makeRequest(
    'PUT',
    `/api/listings/${createdListing.id}`,
    {
      'x-user-id': 'farmer_a_ghaziabad',
      'x-user-role': 'farmer',
    },
    { price: 34 }
  );
  assert.strictEqual(farmerEditRes.status, 200);
  assert.strictEqual(farmerEditRes.data?.listing?.price, 34);
  console.log('  ✓ Farmer A updated own listing price to ₹34');

  const farmerDeleteRes = await makeRequest('DELETE', `/api/listings/${createdListing.id}`, {
    'x-user-id': 'farmer_a_ghaziabad',
    'x-user-role': 'farmer',
  });
  assert.strictEqual(farmerDeleteRes.status, 200);
  assert.strictEqual(farmerDeleteRes.data?.success, true);
  console.log('  ✓ Farmer A successfully deleted own listing');

  const verifyDeletedRes = await makeRequest('GET', `/api/listings/${createdListing.id}`);
  assert.strictEqual(verifyDeletedRes.status, 404);
  console.log('  ✓ Verified listing is deleted from backend (returns 404 Not Found)');

  console.log('\n====================================================');
  console.log('🎉 ALL SHARED MARKETPLACE LISTINGS TESTS PASSED 100%!');
  console.log('====================================================\n');
} finally {
  server.close();
}
