# cloakpipe-landing

The CloakPipe marketing site and docs ([cloakpipe.co](https://cloakpipe.co)): a static
[Astro](https://astro.build) site, deployed by Vercel on every push to `main`.

```sh
npm ci
npm run dev        # http://localhost:4321
npm run build      # static site in dist/
node scripts/check-links.mjs   # every internal link in dist/ must resolve
npm test           # unit tests for the waitlist function (node:test, no deps)
npm run test:site  # build + link check
```

- Pages: `src/pages/` (docs are Markdown in `src/pages/docs/`, sidebar order in `src/lib/docs.ts`).
- Page bodies: `src/partials/*.html`; shared chrome: `src/components/`, `src/layouts/`.
- Headers, redirects and the Content-Security-Policy: `vercel.json`.
- Waitlist: page `src/pages/waitlist.astro`, Vercel Function `api/waitlist.js` (logic in `api/_lib/`, tests in `test/`).

The product itself is open source at [rohansx/cloakpipe](https://github.com/rohansx/cloakpipe).

## Waitlist setup

CloakPipe Cloud is in early access, so the site's only call to action is the waitlist at `/waitlist`. The form
posts to the Vercel Function `POST /api/waitlist`, which appends one row per signup to a Google Sheet. It has
no dependencies: it signs a service-account JWT with `node:crypto` and calls the Sheets API v4 with `fetch`.
Vercel deploys `api/waitlist.js` as a Node.js function next to the static Astro build (no adapter needed).

Until the env vars below are set, the function answers `503` and the form shows a "temporarily unavailable"
message with a mailto fallback.

### 1. Google Cloud: service account and Sheets API

1. In the [Google Cloud console](https://console.cloud.google.com/), pick or create a project.
2. **APIs & Services → Library → Google Sheets API → Enable.**
3. **IAM & Admin → Service accounts → Create service account** (e.g. `cloakpipe-waitlist`). It needs no
   project roles; access comes from sharing the sheet.
4. Open the service account → **Keys → Add key → Create new key → JSON**. A `.json` file downloads. It holds
   `client_email` and `private_key`. Treat it as a secret: never commit it, and delete the local copy once the
   values are in Vercel.

### 2. The sheet

1. Create a Google Sheet (e.g. "CloakPipe waitlist").
2. **Share** it with the service account's `client_email` (`…@….iam.gserviceaccount.com`) as **Editor**.
   Untick "Notify people".
3. The sheet ID is the part of the URL between `/d/` and `/edit`:
   `https://docs.google.com/spreadsheets/d/<WAITLIST_SHEET_ID>/edit#gid=0`.
4. Tab name: `Waitlist` by default (set `WAITLIST_SHEET_TAB` to use another). If the tab does not exist the
   function creates it; if it is empty the function writes the header row. To create it by hand, row 1 is:

   | A | B | C | D | E | F | G | H | I | J | K |
   |---|---|---|---|---|---|---|---|---|---|---|
   | Timestamp (UTC) | Email | Name | Company | Role | Use case | Source page | UTM source | UTM medium | UTM campaign | User agent |

   Email must stay in column B: it is read for de-duplication. IP addresses are never stored; "User agent" is a
   short family such as `Chrome/macOS`. Cells are written with `valueInputOption=RAW` and values starting with
   `= + - @` are prefixed with `'`, so nothing is evaluated as a formula.

### 3. Vercel environment variables

Set these for **Production** and **Preview** (Project → Settings → Environment Variables), then redeploy:

| Name | Value |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | `client_email` from the JSON key |
| `GOOGLE_PRIVATE_KEY` | `private_key` from the JSON key, the whole `-----BEGIN PRIVATE KEY-----…` block. Literal `\n` sequences (as in the JSON file) are fine. |
| `WAITLIST_SHEET_ID` | the sheet ID from the URL |
| `WAITLIST_SHEET_TAB` | optional, default `Waitlist` |

With the CLI (each command prompts for the value, so it never lands in shell history):

```sh
vercel env add GOOGLE_SERVICE_ACCOUNT_EMAIL production
vercel env add GOOGLE_SERVICE_ACCOUNT_EMAIL preview
vercel env add GOOGLE_PRIVATE_KEY production
vercel env add GOOGLE_PRIVATE_KEY preview
vercel env add WAITLIST_SHEET_ID production
vercel env add WAITLIST_SHEET_ID preview
```

Never put the key in `vercel.json`, the repository, or a committed `.env` file.

### 4. Test

- Unit tests (validation, origin check, rate limit, JWT signature, token cache, Sheets calls against a fake
  Google, JSON vs redirect responses): `npm test`.
- After deploying with the env vars set, open `/waitlist` on the deployment, submit your own email and check a
  row appears; submit it again and you should see "You're already on the list" with no second row.
- Without JS (disable it in devtools) the form still posts and the page shows the result.
- `curl -i https://cloakpipe.co/api/waitlist` should answer `405`; a POST from another origin answers `403`.
  Preview deployments may sit behind Vercel Authentication, in which case curl gets Vercel's login page.

### API contract

`POST /api/waitlist`, body `application/json` or `application/x-www-form-urlencoded`:

| Field | Rules |
|---|---|
| `email` | required, trimmed and lowercased, max 254, must look like an address |
| `name`, `company` | optional, max 120 |
| `role` | optional, one of `Engineering/ML`, `Platform/SRE`, `Security/Compliance`, `Founder/Exec`, `Other` |
| `use_case` | optional, max 1000 |
| `cp_hp` | honeypot, must be empty (a filled one gets a fake success and nothing is stored) |
| `started_at`, `submitted_at` | epoch ms set by the page's JS; submissions under 2 s are refused. Absent for no-JS posts. |
| `source`, `utm_source`, `utm_medium`, `utm_campaign` | optional; fall back to the same-origin Referer |

Requests must come from `cloakpipe.co`, `www.cloakpipe.co`, the deployment's own `*.vercel.app` URLs, or
localhost outside production. Each warm instance allows about 5 requests per minute per IP.

| Outcome | JSON (`Accept: application/json` or a JSON body) | Form post (no JS) |
|---|---|---|
| Added | `201 {"status":"joined"}` | `303 /waitlist?joined=1#wl-joined` |
| Already on the list | `200 {"status":"already"}` | `303 /waitlist?joined=already#wl-already` |
| Invalid input | `400 {"error":"invalid_email"\|"too_long"\|"invalid_role"\|"too_fast"\|"invalid"\|"invalid_timing", "field"?, "message"}` | `303 /waitlist?error=<code>#wl-error` |
| Wrong origin | `403 {"error":"forbidden"}` | same, `?error=forbidden` |
| Rate limited | `429 {"error":"rate_limited"}` + `Retry-After: 60` | same, `?error=rate_limited` |
| Bad content type / too large | `415` / `413` | same |
| Not configured | `503 {"error":"unavailable"}` | `?error=unavailable` |
| Google API error | `502 {"error":"upstream"}` | `?error=server` |
| Any other method | `405`, `Allow: POST` | |

Error responses never include credentials, Google's response bodies or stack traces; the server log names the
failing step, the HTTP status and Google's short error code.
