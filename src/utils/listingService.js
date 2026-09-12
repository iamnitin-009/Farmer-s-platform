// src/utils/listingService.js
// Client API service for shared marketplace listings.
// Communicates with backend /api/listings and maintains local cache fallback.

export const FARMER_LISTINGS_KEY = 'sih_farmer_listings';

function buildAuthHeaders(session, roleOverride) {
  const headers = { 'Content-Type': 'application/json' };
  if (session) {
    if (session.token) headers['Authorization'] = `Bearer ${session.token}`;
    if (session.id) headers['x-user-id'] = session.id;
    if (session.role || roleOverride) headers['x-user-role'] = roleOverride || session.role;
    if (session.name) headers['x-user-name'] = session.name;
    if (session.mobile) headers['x-user-mobile'] = session.mobile;
  } else if (roleOverride) {
    headers['x-user-role'] = roleOverride;
  }
  return headers;
}

function getLocalCache() {
  try {
    const raw = localStorage.getItem(FARMER_LISTINGS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function setLocalCache(listings) {
  try {
    const list = Array.isArray(listings) ? listings : [];
    const unique = Array.from(new Map(list.map((item) => [item.id, item])).values());
    localStorage.setItem(FARMER_LISTINGS_KEY, JSON.stringify(unique));
  } catch (e) {
    console.warn('Could not save to localStorage cache:', e);
  }
}

/**
 * Fetch listings from shared backend with offline cache fallback.
 */
export async function fetchListings(filters = {}, session = null) {
  const { role, farmerId, crop, status, myListings } = filters;
  const userRole = role || session?.role || 'buyer';

  const params = new URLSearchParams();
  if (userRole) params.set('role', userRole);
  if (crop) params.set('crop', crop);
  if (status) params.set('status', status);
  if (farmerId) params.set('farmerId', farmerId);
  if (myListings) params.set('myListings', 'true');

  try {
    const res = await fetch(`/api/listings?${params.toString()}`, {
      method: 'GET',
      headers: buildAuthHeaders(session, userRole),
    });

    if (res.ok) {
      const data = await res.json();
      if (data.success && Array.isArray(data.listings)) {
        // Authoritative backend response: Always update local cache on general query
        if (!filters.crop && !filters.farmerId && !filters.myListings) {
          setLocalCache(data.listings);
        }
        return data.listings;
      }
    }
  } catch (err) {
    console.warn('[listingService] Backend fetch failed, reading from local cache:', err.message);
  }

  // Graceful fallback to local cache
  let cached = getLocalCache();
  if (userRole === 'buyer') {
    cached = cached.filter((l) => (l.quantity ?? 0) > 0 && l.moderationStatus !== 'rejected');
  } else if (userRole === 'farmer' && (farmerId || session?.id)) {
    const targetId = farmerId || session?.id;
    cached = cached.filter((l) => l.farmerId === targetId || (session?.mobile && l.farmerMobile === session.mobile));
  }
  if (crop) {
    cached = cached.filter((l) => (l.crop || '').toLowerCase() === crop.toLowerCase());
  }
  return cached;
}

/**
 * Fetch a single listing by ID or traceability ID.
 */
export async function fetchListingById(id, session = null) {
  if (!id) return null;
  try {
    const res = await fetch(`/api/listings/${id}`, {
      method: 'GET',
      headers: buildAuthHeaders(session),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.success && data.listing) {
        return data.listing;
      }
    }
  } catch (err) {
    console.warn('[listingService] Backend fetch single listing failed:', err.message);
  }

  // Fallback
  const cached = getLocalCache();
  return cached.find((l) => l.id === id || l.traceabilityId === id) || null;
}

/**
 * Create a new produce listing on the shared backend.
 */
export async function createListing(listingData, session = null) {
  const headers = buildAuthHeaders(session, session?.role || 'farmer');

  try {
    const res = await fetch('/api/listings', {
      method: 'POST',
      headers,
      body: JSON.stringify(listingData),
    });

    const data = await res.json();
    if (res.ok && data.success && data.listing) {
      // Update local cache
      const cached = getLocalCache();
      const updated = [data.listing, ...cached.filter((l) => l.id !== data.listing.id)];
      setLocalCache(updated);
      return { success: true, listing: data.listing };
    }
    return { success: false, error: data.error || 'Failed to create listing' };
  } catch (err) {
    console.warn('[listingService] Backend create failed, saving to local cache:', err.message);
    // Offline fallback
    const fallbackItem = {
      ...listingData,
      id: listingData.id || 'listing_' + Date.now(),
      farmerId: session?.id || listingData.farmerId || 'demo_farmer',
      farmerName: session?.name || listingData.farmerName || 'Farmer',
      farmerMobile: session?.mobile || listingData.farmerMobile || '',
      createdAt: new Date().toISOString(),
      status: 'Listed',
      moderationStatus: 'approved',
    };
    const cached = getLocalCache();
    const updated = [fallbackItem, ...cached.filter((l) => l.id !== fallbackItem.id)];
    setLocalCache(updated);
    return { success: true, listing: fallbackItem };
  }
}

/**
 * Update an existing listing (e.g. edit price/quantity or moderation status).
 */
export async function updateListing(id, updates, session = null) {
  const headers = buildAuthHeaders(session);

  try {
    const res = await fetch(`/api/listings/${id}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(updates),
    });

    const data = await res.json();
    if (res.ok && data.success && data.listing) {
      // Update local cache
      const cached = getLocalCache();
      const updated = cached.map((l) => (l.id === id ? data.listing : l));
      setLocalCache(updated);
      return { success: true, listing: data.listing };
    }
    return { success: false, error: data.error || 'Failed to update listing' };
  } catch (err) {
    console.warn('[listingService] Backend update failed, updating local cache:', err.message);
    const cached = getLocalCache();
    const updated = cached.map((l) => (l.id === id ? { ...l, ...updates } : l));
    setLocalCache(updated);
    const item = updated.find((l) => l.id === id);
    return { success: true, listing: item };
  }
}

/**
 * Delete a listing from the shared backend.
 */
export async function deleteListing(id, session = null) {
  const headers = buildAuthHeaders(session);

  try {
    const res = await fetch(`/api/listings/${id}`, {
      method: 'DELETE',
      headers,
    });

    const data = await res.json();
    if (res.ok && data.success) {
      const cached = getLocalCache();
      setLocalCache(cached.filter((l) => l.id !== id));
      return { success: true };
    }
    return { success: false, error: data.error || 'Failed to delete listing' };
  } catch (err) {
    console.warn('[listingService] Backend delete failed, removing from local cache:', err.message);
    const cached = getLocalCache();
    setLocalCache(cached.filter((l) => l.id !== id));
    return { success: true };
  }
}
