import { FxRate } from '../models/FxRate.js';
import { logger } from '../utils/logger.js';

/**
 * FX service (FEAT-04, v0.5) — multi-currency rates from the ECB.
 *
 * Source: ECB daily euro reference rates (eurofxref-daily.xml),
 * EUR-based: 1 EUR = rates[CUR] units of CUR. Rates are cached in the
 * FxRate collection for 24h. The read path never throws / never 500s:
 * stale cache beats no cache, and a built-in static snapshot beats
 * nothing at all.
 */

export const ECB_URL =
  'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;

// EMERGENCY FALLBACK — static snapshot used ONLY when the ECB fetch
// fails and no cached FxRate document exists at any age. These are
// approximate reference values, not live rates; they exist solely so
// the rates endpoint and the order-confirmation rate lock degrade
// gracefully instead of failing.
export const FALLBACK_RATES = {
  EUR: 1,
  USD: 1.08,
  GBP: 0.85,
  AUD: 1.65,
};

const toPlainRates = (rates) => {
  if (!rates) return {};
  if (rates instanceof Map) return Object.fromEntries(rates);
  // Mongoose may hand back a plain object already; copy it.
  return { ...rates };
};

const normalizeRates = (rates) => {
  const plain = toPlainRates(rates);
  const out = {};
  for (const [cur, val] of Object.entries(plain)) {
    const num = Number(val);
    if (cur && Number.isFinite(num)) out[cur.toUpperCase()] = num;
  }
  if (!out.EUR) out.EUR = 1;
  return out;
};

/**
 * Hand-rolled parser for the ECB eurofxref XML (no XML dependency).
 * Format: nested <Cube> elements; the leaf cubes carry the rates:
 *   <Cube time="2025-11-25">
 *     <Cube currency="USD" rate="1.1570"/>
 *     ...
 *   </Cube>
 * Attribute order / quote style are not assumed: each Cube tag is
 * scanned and its currency/rate attributes extracted independently.
 */
export const parseEcbXml = (xml) => {
  const rates = { EUR: 1 };
  if (!xml || typeof xml !== 'string') return rates;

  const cubeTags = xml.match(/<Cube\b[^>]*>/g) || [];
  for (const tag of cubeTags) {
    const currencyMatch = tag.match(/currency\s*=\s*["']([A-Za-z]{3})["']/);
    const rateMatch = tag.match(/rate\s*=\s*["']([\d.]+)["']/);
    if (!currencyMatch || !rateMatch) continue;
    const rate = parseFloat(rateMatch[1]);
    if (Number.isFinite(rate)) {
      rates[currencyMatch[1].toUpperCase()] = rate;
    }
  }
  return rates;
};

/**
 * Fetch the current ECB daily rates. Throws on network / HTTP /
 * parse failure (callers decide how to degrade).
 * @returns {Promise<Object>} EUR-based rates object, EUR = 1 included.
 */
export const fetchEcbRates = async () => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(ECB_URL, { signal: controller.signal });
    if (!res || !res.ok) {
      throw new Error(`ECB fetch failed: HTTP ${res ? res.status : 'no response'}`);
    }
    const xml = await res.text();
    const rates = parseEcbXml(xml);
    // A parsed document with nothing but EUR means the payload was
    // not the expected ECB format — treat it as a fetch failure.
    if (Object.keys(rates).length <= 1) {
      throw new Error('ECB payload contained no currency rates');
    }
    return rates;
  } finally {
    clearTimeout(timeout);
  }
};

/**
 * Fetch fresh rates and persist them as the singleton FxRate doc.
 * @returns {Promise<{base: string, rates: Object, asOf: Date}>}
 */
export const refreshRates = async () => {
  const rates = await fetchEcbRates();
  const fetchedAt = new Date();
  await FxRate.findOneAndUpdate(
    {},
    { base: 'EUR', rates, fetchedAt },
    { upsert: true, new: true, setDefaultsOnInsert: true, sort: { fetchedAt: -1 } }
  );
  return { base: 'EUR', rates, asOf: fetchedAt };
};

/**
 * Current rates, cache-first:
 *  1. Fresh (<24h) cache -> return it.
 *  2. Stale/missing cache -> try refresh; on success return fresh.
 *  3. Refresh fails + any cache exists -> return the (stale) cache.
 *  4. Refresh fails + no cache -> built-in static fallback snapshot.
 * Never throws under normal failure modes.
 */
export const getRates = async () => {
  let cached = null;
  try {
    cached = await FxRate.findOne({}).sort({ fetchedAt: -1 }).lean();
  } catch (err) {
    logger.warn('FX: failed to read cached rates', { error: err.message });
  }

  if (cached?.fetchedAt && Date.now() - new Date(cached.fetchedAt).getTime() < CACHE_TTL_MS) {
    return {
      base: cached.base || 'EUR',
      rates: normalizeRates(cached.rates),
      asOf: new Date(cached.fetchedAt),
    };
  }

  try {
    const fresh = await refreshRates();
    return { base: fresh.base, rates: normalizeRates(fresh.rates), asOf: fresh.asOf };
  } catch (err) {
    logger.warn('FX: ECB refresh failed', { error: err.message });
  }

  if (cached) {
    return {
      base: cached.base || 'EUR',
      rates: normalizeRates(cached.rates),
      asOf: cached.fetchedAt ? new Date(cached.fetchedAt) : null,
    };
  }

  return { base: 'EUR', rates: { ...FALLBACK_RATES }, asOf: null };
};

/**
 * Pure conversion helper using EUR-based cross rates:
 *   amount(to) = amount(from) * rate(to) / rate(from), EUR rate = 1.
 * `rates` may be a plain object or a Map. Returns the unrounded value;
 * callers round as needed. Throws on an unknown currency.
 */
export const convert = (amount, from, to, rates) => {
  const plain = normalizeRates(rates || {});
  const fromCur = String(from || '').toUpperCase();
  const toCur = String(to || '').toUpperCase();
  const fromRate = fromCur === 'EUR' ? 1 : plain[fromCur];
  const toRate = toCur === 'EUR' ? 1 : plain[toCur];
  if (!Number.isFinite(fromRate) || !Number.isFinite(toRate)) {
    throw new Error(`Unknown currency in FX conversion: ${fromCur} -> ${toCur}`);
  }
  return (Number(amount) || 0) * (toRate / fromRate);
};
