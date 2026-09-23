/**
 * Pricing, Currency and Logistics helper module
 */

export const DISTRIBUTOR_TIER_DISCOUNTS = {
  Standard: 0,
  Bronze: 0.05, // 5% discount
  Silver: 0.08, // 8% discount
  Gold: 0.12, // 12% discount
  Platinum: 0.15, // 15% discount
};

export const CURRENCY_RATES = {
  USD: 1.0,
  EUR: 0.92,
  GBP: 0.78,
  AUD: 1.52,
};

export const getTierDiscountPercent = (tier = 'Standard') => {
  return DISTRIBUTOR_TIER_DISCOUNTS[tier] || 0;
};

export const getCarrierTrackingUrl = (carrierName = '', trackingNumber = '') => {
  if (!trackingNumber) return null;
  const cleanTracking = trackingNumber.trim();
  const lowerCarrier = (carrierName || '').toLowerCase();

  if (lowerCarrier.includes('dhl')) {
    return `https://www.dhl.com/en/express/tracking.html?AWB=${encodeURIComponent(cleanTracking)}`;
  }
  if (lowerCarrier.includes('fedex')) {
    return `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(cleanTracking)}`;
  }
  if (lowerCarrier.includes('ups')) {
    return `https://www.ups.com/track?tracknum=${encodeURIComponent(cleanTracking)}`;
  }
  if (lowerCarrier.includes('maersk')) {
    return `https://www.maersk.com/tracking/${encodeURIComponent(cleanTracking)}`;
  }
  if (lowerCarrier.includes('msc')) {
    return `https://www.msc.com/en/track-a-shipment?trackingNumber=${encodeURIComponent(cleanTracking)}`;
  }

  return `https://www.google.com/search?q=${encodeURIComponent((carrierName ? carrierName + ' ' : '') + cleanTracking + ' tracking')}`;
};
