// src/utils/paymentEscrow.js
// Escrow-style payment & fulfillment state management for SIH MVP
// Pure deterministic utility with simulated escrow protections

export const FULFILLMENT_STEPS = [
  'PAYMENT_SECURED',
  'VERIFICATION_PENDING',
  'PICKUP_SCHEDULED',
  'IN_TRANSIT',
  'DELIVERED',
  'PAYMENT_RELEASED',
];

export const BUYER_ORDERS_STORAGE_KEY = 'sih_buyer_orders';

/**
 * Calculate order total deterministically
 */
export function calculateOrderTotal(quantityKg, ratePerKg) {
  const q = parseFloat(quantityKg);
  const r = parseFloat(ratePerKg);
  if (isNaN(q) || isNaN(r) || q <= 0 || r <= 0) return 0;
  return Math.round(q * r * 100) / 100;
}

/**
 * Get numerical index of a fulfillment step (0 to 5)
 */
export function getStepIndex(status) {
  return FULFILLMENT_STEPS.indexOf(status);
}

/**
 * Get next sequential fulfillment status
 */
export function getNextFulfillmentStatus(currentStatus) {
  const idx = getStepIndex(currentStatus);
  if (idx === -1 || idx >= FULFILLMENT_STEPS.length - 1) {
    return null;
  }
  return FULFILLMENT_STEPS[idx + 1];
}

/**
 * Defensively normalizes order objects to guarantee all payment and escrow fields exist,
 * providing seamless backward compatibility with legacy orders.
 */
export function normalizeOrder(order) {
  if (!order || typeof order !== 'object') return null;

  const orderId = order.orderId || order.id || 'ORD_UNKNOWN';
  const quantityKg = typeof order.quantityKg === 'number'
    ? order.quantityKg
    : parseFloat(order.quantity || 0);
  const ratePerKg = typeof order.ratePerKg === 'number'
    ? order.ratePerKg
    : parseFloat(order.pricePerKg || 0);
  const totalAmount = typeof order.totalAmount === 'number'
    ? order.totalAmount
    : calculateOrderTotal(quantityKg, ratePerKg);

  // Safe fallback for legacy orders without fulfillmentStatus
  let fulfillmentStatus = order.fulfillmentStatus;
  if (!fulfillmentStatus || !FULFILLMENT_STEPS.includes(fulfillmentStatus)) {
    if (order.status === 'Delivered' || order.status === 'Completed') {
      fulfillmentStatus = 'PAYMENT_RELEASED';
    } else {
      fulfillmentStatus = 'PAYMENT_SECURED';
    }
  }

  // Safe fallback for payment object
  let payment = order.payment;
  if (!payment || typeof payment !== 'object') {
    payment = {
      status: fulfillmentStatus === 'PAYMENT_RELEASED' ? 'RELEASED' : 'SECURED',
      amount: totalAmount,
      simulated: true,
    };
  } else {
    payment = {
      ...payment,
      amount: typeof payment.amount === 'number' ? payment.amount : totalAmount,
      simulated: true,
      status: fulfillmentStatus === 'PAYMENT_RELEASED' ? 'RELEASED' : (payment.status || 'SECURED'),
    };
  }

  return {
    ...order,
    id: order.id || orderId,
    orderId,
    quantity: order.quantity ?? quantityKg,
    quantityKg,
    pricePerKg: order.pricePerKg ?? ratePerKg,
    ratePerKg,
    totalAmount,
    qualityGrade: order.qualityGrade || order.quality?.grade || null,
    fairPrice: order.fairPrice ?? (order.listing?.fairPrice?.suggestedPrice || null),
    pickupDecision: order.pickupDecision ?? (order.listing?.pickupDecision || null),
    payment,
    fulfillmentStatus,
    status: order.status || (fulfillmentStatus === 'PAYMENT_RELEASED' ? 'Payment Released' : 'Payment Secured'),
    createdAt: order.createdAt || new Date().toISOString(),
  };
}

/**
 * Advance an order forward through the defined 6-step sequence.
 * Strictly prevents backward movement and skipping steps.
 */
export function advanceOrderStatus(orderId, expectedNextStatus) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return { success: false, error: 'localStorage is not available' };
    }

    const raw = localStorage.getItem(BUYER_ORDERS_STORAGE_KEY);
    const orders = raw ? JSON.parse(raw) : [];

    const index = orders.findIndex((o) => o.orderId === orderId || o.id === orderId);
    if (index === -1) {
      return { success: false, error: 'Order not found' };
    }

    const currentOrder = normalizeOrder(orders[index]);
    const currentIdx = getStepIndex(currentOrder.fulfillmentStatus);

    if (currentIdx === FULFILLMENT_STEPS.length - 1) {
      return { success: false, error: 'Order is already at final status (PAYMENT_RELEASED)' };
    }

    const nextStatus = FULFILLMENT_STEPS[currentIdx + 1];

    // If expectedNextStatus was passed, ensure it is the exact next step
    if (expectedNextStatus && expectedNextStatus !== nextStatus) {
      const expectedIdx = getStepIndex(expectedNextStatus);
      if (expectedIdx <= currentIdx) {
        return { success: false, error: 'Status cannot move backwards' };
      }
      return { success: false, error: `Cannot skip steps. Next status must be ${nextStatus}` };
    }

    const updatedPayment = {
      ...currentOrder.payment,
      status: nextStatus === 'PAYMENT_RELEASED' ? 'RELEASED' : 'SECURED',
      simulated: true,
    };

    const updatedOrder = {
      ...currentOrder,
      fulfillmentStatus: nextStatus,
      payment: updatedPayment,
      status: nextStatus === 'PAYMENT_RELEASED' ? 'Payment Released' : nextStatus.replace(/_/g, ' '),
      updatedAt: new Date().toISOString(),
    };

    orders[index] = updatedOrder;
    localStorage.setItem(BUYER_ORDERS_STORAGE_KEY, JSON.stringify(orders));

    return { success: true, order: updatedOrder };
  } catch (err) {
    console.error('Error advancing order status:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Retrieve incoming orders for a specific farmer
 */
export function getFarmerOrders(farmerId, farmerMobile) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return [];
    const raw = localStorage.getItem(BUYER_ORDERS_STORAGE_KEY);
    const all = raw ? JSON.parse(raw) : [];
    if (!farmerId && !farmerMobile) return [];
    return all
      .map(normalizeOrder)
      .filter((order) => {
        if (!order) return false;
        if (farmerId && order.farmerId === farmerId) return true;
        if (farmerMobile && order.farmerMobile === farmerMobile) return true;
        return false;
      });
  } catch (err) {
    console.error('Error getting farmer orders:', err);
    return [];
  }
}

/**
 * Compute key escrow & fulfillment statistics from an orders array
 */
export function getOrderEscrowStats(orders = []) {
  const normalized = (orders || []).map(normalizeOrder).filter(Boolean);

  let activeOrders = 0;
  let securedPayments = 0;
  let ordersInTransit = 0;
  let completedOrders = 0;

  for (const order of normalized) {
    const isCompleted = order.fulfillmentStatus === 'PAYMENT_RELEASED';
    if (isCompleted) {
      completedOrders++;
    } else {
      activeOrders++;
    }

    if (order.fulfillmentStatus === 'IN_TRANSIT') {
      ordersInTransit++;
    }

    if (order.payment?.status === 'SECURED') {
      securedPayments += (order.payment.amount || 0);
    }
  }

  return {
    activeOrders,
    securedPayments,
    ordersInTransit,
    completedOrders,
  };
}
