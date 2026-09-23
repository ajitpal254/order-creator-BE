import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getTierDiscountPercent,
  CURRENCY_RATES,
  getCarrierTrackingUrl,
} from '../src/utils/pricing.js';

test('Pricing: Distributor tier discount percentages', () => {
  assert.equal(getTierDiscountPercent('Standard'), 0);
  assert.equal(getTierDiscountPercent('Bronze'), 0.05);
  assert.equal(getTierDiscountPercent('Silver'), 0.08);
  assert.equal(getTierDiscountPercent('Gold'), 0.12);
  assert.equal(getTierDiscountPercent('Platinum'), 0.15);
  assert.equal(getTierDiscountPercent('Unknown'), 0);
});

test('Pricing: Multi-currency conversion rates', () => {
  assert.equal(CURRENCY_RATES.USD, 1.0);
  assert.equal(CURRENCY_RATES.EUR, 0.92);
  assert.equal(CURRENCY_RATES.GBP, 0.78);
  assert.equal(CURRENCY_RATES.AUD, 1.52);
});

test('Pricing: Carrier tracking URL generation', () => {
  const dhlUrl = getCarrierTrackingUrl('DHL Express', '987654321');
  assert.match(dhlUrl, /dhl\.com\/en\/express\/tracking\.html\?AWB=987654321/);

  const fedexUrl = getCarrierTrackingUrl('FedEx Cargo', '74839201');
  assert.match(fedexUrl, /fedex\.com\/fedextrack\/\?trknbr=74839201/);

  const maerskUrl = getCarrierTrackingUrl('Maersk Ocean', 'MSK123456');
  assert.match(maerskUrl, /maersk\.com\/tracking\/MSK123456/);

  const emptyUrl = getCarrierTrackingUrl('DHL', '');
  assert.equal(emptyUrl, null);
});
