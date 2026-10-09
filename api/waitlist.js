// Vercel Function (Node.js runtime): POST /api/waitlist.
// The logic lives in ./_lib (underscore: not deployed as separate functions).
// Env: WAITLIST_SCRIPT_URL (the Apps Script web app /exec URL) and
// WAITLIST_SCRIPT_SECRET (shared with the script's WAITLIST_SECRET property).
// See README "Waitlist setup".

import { createHandler } from './_lib/handler.js';
import { createRateLimiter } from './_lib/guard.js';

// Module scope: the rate-limit window survives across invocations on a warm instance.
const handle = createHandler({ rateLimiter: createRateLimiter({ limit: 5, windowMs: 60_000 }) });

export default {
  fetch(request) {
    return handle(request, process.env);
  },
};
