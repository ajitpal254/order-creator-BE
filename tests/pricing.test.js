/**
 * pricing.test.js — Vitest port
 */
import { describe, it, expect } from 'vitest';
import {
  getTierDiscountPercent,
  CURRENCY_RATES,
  getCarrierTrackingUrl,
} from '../src/utils/pricing.js';

describe('Distributor tier discount percentages', () => {
  it.each([
    ['Standard', 0],
    ['Bronze', 0.05],
    ['Silver', 0.08],
    ['Gold', 0.12],
    ['Platinum', 0.15],
    ['Unknown', 0],
  ])('tier %s → %s discount', (tier, expected) => {
    expect(getTierDiscountPercent(tier)).toBe(expected);
  });
});

describe('Currency conversion rates', () => {
  it('USD is base rate 1.0', () => expect(CURRENCY_RATES.USD).toBe(1.0));
  it('EUR is 0.92', () => expect(CURRENCY_RATES.EUR).toBe(0.92));
  it('GBP is 0.78', () => expect(CURRENCY_RATES.GBP).toBe(0.78));
  it('AUD is 1.52', () => expect(CURRENCY_RATES.AUD).toBe(1.52));
});

describe('Carrier tracking URL generation', () => {
  it('generates DHL tracking URL', () => {
    expect(getCarrierTrackingUrl('DHL Express', '987654321')).toMatch(/dhl\.com\/en\/express\/tracking\.html\?AWB=987654321/);
  });
  it('generates FedEx tracking URL', () => {
    expect(getCarrierTrackingUrl('FedEx Cargo', '74839201')).toMatch(/fedex\.com\/fedextrack\/\?trknbr=74839201/);
  });
  it('generates Maersk tracking URL', () => {
    expect(getCarrierTrackingUrl('Maersk Ocean', 'MSK123456')).toMatch(/maersk\.com\/tracking\/MSK123456/);
  });
  it('returns null when tracking number is empty', () => {
    expect(getCarrierTrackingUrl('DHL', '')).toBeNull();
  });
});
