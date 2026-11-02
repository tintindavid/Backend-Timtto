import { redactQuotesFor } from '../utils/requisicionQuoteVisibility.util.js';

/**
 * Router-level response filter of the requisitions: hides the supplier quotations from users who may not see them (see
 * requisicionQuoteVisibility.util.js). Mount it right after `authenticate`, so every response of the router passes through.
 */
export function redactLicitacionQuotes(req, res, next) {
  const json = res.json.bind(res);
  res.json = (body) => {
    if (body && typeof body === 'object' && body.success === true && body.data) {
      return json({ ...body, data: redactQuotesFor(body.data, req.user) });
    }
    return json(body);
  };
  next();
}
