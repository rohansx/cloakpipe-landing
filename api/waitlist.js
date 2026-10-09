// Vercel Function (Node.js runtime): POST /api/waitlist.
// The logic lives in ./_lib (underscore: not deployed as separate functions).
// Env: GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, WAITLIST_SHEET_ID,
// optional WAITLIST_SHEET_TAB (default "Waitlist"). See README "Waitlist setup".

import { createHandler } from './_lib/handler.js';
import { createRateLimiter } from './_lib/guard.js';

// Module scope: survives across invocations on a warm instance, so the access
// token and the rate-limit window are reused.
const handle = createHandler({ rateLimiter: createRateLimiter({ limit: 5, windowMs: 60_000 }) });

export default {
  fetch(request) {
    return handle(request, process.env);
  },
};
