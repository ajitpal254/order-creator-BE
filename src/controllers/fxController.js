import { getRates } from '../services/fx.js';
import { logger } from '../utils/logger.js';

// @desc Get current FX rates (ECB, EUR-based, cached 24h)
// @route GET /api/fx/rates
export const getFxRates = async (req, res) => {
  try {
    const { base, rates, asOf } = await getRates();
    return res.status(200).json({
      success: true,
      data: { base, rates, asOf },
    });
  } catch (error) {
    // getRates() is designed never to throw, but keep the endpoint
    // contract absolute: log and 500 only on a truly unexpected error.
    logger.error('Error fetching FX rates', { error: error.message });
    return res.status(500).json({ success: false, message: error.message });
  }
};
