# PRAGATI — BFM-001 & CROP-001 Implementation Report

## 1. Executive Summary
Successfully implemented **BFM-001** (Buyer–Farmer Matching & Multi-Farmer Order Allocation Engine) and **CROP-001** (Canonical Product Scope: Rice, Wheat, Chana Dal, Toor Dal) without breaking existing features (AI Quality, Fair Price, Smart Pickup, Escrow, QR Traceability, Bilingual support).

---

## 2. Product Scope (CROP-001)
- **Active Crops**: `rice`, `wheat`, `chana_dal`, `toor_dal` (Potato, Onion, Tomato, Fruits removed from active listing).
- **Varieties**:
  - **Rice**: Basmati, Sona Masoori, Regular
  - **Wheat**: Sharbati, Lokwan, Regular
  - **Chana Dal**: Desi, Kabuli, Regular
  - **Toor Dal**: Desi, Fatka, Regular
- **Compatibility**: Legacy listings with `variety: null` default safely to `'Regular'`.

---

## 3. Matching & Allocation Architecture (BFM-001)

```
[Buyer Requirement]
        │
        ▼
[Stage 1: Hard Filters]  ──▶ (Crop, Variety, Min Grade, Max Price, Distance, Stock > 0)
        │
        ▼
[Stage 2: Deterministic Scoring (100 pts)]
        ├── Price Competitiveness (30 pts)
        ├── Proximity / Distance (25 pts)
        ├── Volume Fit / Minimize Farmer Count (25 pts)
        ├── Quality Grade (12 pts)
        └── Logistics Mode (8 pts)
        │
        ▼
[Stage 3: Greedy Multi-Farmer Allocation]
        ├── allocatedQty = min(availQty, remainingDemand)
        ├── remainingDemand -= allocatedQty
        └── Calculate Weighted Average Price per kg
        │
        ▼
[Parent Order + Child Allocations] (Status: FULL / PARTIAL / NO_MATCH)
```

---

## 4. Key Implementation Details

1. **Atomic Concurrency Protection**:
   - `AsyncMutex` in `server/listingStore.js` serializes allocations.
   - Prevents overselling available inventory (`quantity - reservedQuantity`).

2. **Parent-Child Order Hierarchy**:
   - **Parent Order**: Contains buyer info, crop, total quantity, fulfilled quantity, weighted average price, and fulfillment status (`PAYMENT_SECURED` / `PARTIAL`).
   - **Child Allocations**: Assigned per farmer (`farmerId`, `allocatedQuantity`, `unitPrice`, `status: PENDING | ACCEPTED | REJECTED`).

3. **Farmer Lifecycle & Privacy**:
   - `GET /api/orders?farmerId=...`: Farmers only see their own assigned allocation (privacy-safe).
   - `POST /api/allocations/:id/accept`: Farmer accepts allocation; stock permanently decremented.
   - `POST /api/allocations/:id/reject`: Farmer rejects; reservation released and shortfall automatically reallocated to next ranked farmer.

4. **UI Additions**:
   - **Farmer Portal**: Variety selector dropdown, variety tag on listings, allocation cards with Accept / Reject buttons.
   - **Buyer Marketplace**: Variety filter, "⚡ Smart Multi-Farmer Bulk Order" modal with preview breakdown and one-click order confirmation.

---

## 5. API Endpoints

| Method | Route | Purpose |
| :--- | :--- | :--- |
| `POST` | `/api/match` | Preview multi-farmer allocation without reserving inventory |
| `POST` | `/api/orders/allocate` | Atomically reserve stock & create parent order + child allocations |
| `POST` | `/api/allocations/:id/accept` | Farmer accepts allocated share |
| `POST` | `/api/allocations/:id/reject` | Farmer rejects allocated share; triggers auto-reallocation |
| `GET` | `/api/orders` | Fetch orders with role-based privacy filtering |

---

## 6. Verification Results

Ran `node tests/bfm_verification.js`:
- ✅ **CROP-001**: 4 canonical crops and varieties validated
- ✅ **Scenario A**: Multi-farmer fill (300kg + 200kg = 500kg, status `FULL`)
- ✅ **Scenario B**: Variety match (Basmati requested $\to$ only Basmati allocated)
- ✅ **Scenario C**: Variety exclusion (Basmati requested, Sona Masoori available $\to$ `NO_MATCH`)
- ✅ **Scenario D**: Variety unspecified (Candidates grouped by variety, never mixed)
- ✅ **Scenario E**: Min Grade B filter (Grade A allocated, Grade C excluded)
- ✅ **Scenario F**: Partial fill (450kg of 600kg allocated, status `PARTIAL`)
- ✅ **Scenario G**: Concurrency & atomic reservation (oversell prevented)
- ✅ **Scenario H**: Reallocation on farmer rejection (released and reallocated)

**Test Status**: **9 PASSED, 0 FAILED**  
**Build Status**: **`npm run build` SUCCEEDED (0 errors)**
