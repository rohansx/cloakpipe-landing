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
- Waitlist: page `src/pages/waitlist.astro`, Vercel Function `api/waitlist.js` (logic in `api/_lib/`, tests in
  `test/`), Google Apps Script `apps-script/Code.gs`.

The product itself is open source at [rohansx/cloakpipe](https://github.com/rohansx/cloakpipe).

## Waitlist setup

CloakPipe Cloud is in early access, so the site's only call to action is the waitlist at `/waitlist`. The form
posts to the Vercel Function `POST /api/waitlist` (`api/waitlist.js`), which checks the request (method, origin,
rate limit, honeypot, timing, field validation and limits, formula neutralisation) and forwards the clean row
to a **Google Apps Script web app** bound to the sheet ([`apps-script/Code.gs`](apps-script/Code.gs)). The
script runs as you, checks a shared secret, de-duplicates by email under a lock and appends the row. There is no
Google Cloud project, service account or key.

Until the two env vars below are set, the function answers `503` and the form shows a "temporarily unavailable"
message with a mailto fallback.

### 1. Generate the shared secret

```sh
openssl rand -hex 32
```

This prints 64 hex characters. You paste the same value into the script (step 3) and into Vercel (step 5). The
function refuses secrets shorter than 32 characters. Keep it out of the repository and out of chat logs.

### 2. The sheet and the script

1. Create a Google Sheet (e.g. "CloakPipe waitlist") in the Google account that should own the signups.
2. In the sheet: **Extensions → Apps Script**. The editor opens with a `Code.gs` file bound to this sheet.
3. Delete the placeholder `function myFunction() {}`, paste the whole of
   [`apps-script/Code.gs`](apps-script/Code.gs), and press **Save project** (the disk icon, or ⌘S / Ctrl+S).
   Optionally rename the project (click "Untitled project") to "CloakPipe waitlist".

### 3. Script properties

1. In the Apps Script editor, click **Project Settings** (the gear icon in the left sidebar).
2. Scroll to **Script properties → Add script property** (or **Edit script properties** if some exist).
3. Add:

   | Property | Value |
   |---|---|
   | `WAITLIST_SECRET` | the secret from step 1 |
   | `WAITLIST_TAB` | optional tab name; default `Waitlist` |

4. **Save script properties.**

The script creates the tab if it is missing and writes the header row when the tab is empty:

| A | B | C | D | E | F | G | H | I | J | K |
|---|---|---|---|---|---|---|---|---|---|---|
| Timestamp (UTC) | Email | Name | Company | Role | Use case | Source page | UTM source | UTM medium | UTM campaign | User agent |

Email must stay in column B: it is read for de-duplication (case-insensitive). IP addresses are never stored;
"User agent" is a short family such as `Chrome/macOS`. Values starting with `= + - @` are prefixed with `'` by
the function and again by the script, so nothing is evaluated as a formula.

### 4. Deploy the web app

1. In the Apps Script editor: **Deploy → New deployment**.
2. Next to "Select type", click the gear icon → **Web app**.
3. Description: e.g. `waitlist v1`. **Execute as: Me** (your account). **Who has access: Anyone**.
   "Anyone" is required: Vercel calls it without a Google login. The shared secret is what keeps others out.
4. **Deploy**. The first time, Google asks you to **Authorize access**: pick your account. On "Google hasn't
   verified this app", click **Advanced → Go to CloakPipe waitlist (unsafe)** (it is your own script), then
   **Allow**. The script asks only for access to the spreadsheet it is bound to.
5. Copy the **Web app URL**. It looks like `https://script.google.com/macros/s/AKfy…/exec`. Use the `/exec` URL,
   not the `/dev` test URL.

Check it answers (this runs `doGet`, which returns no data):

```sh
curl -sL "https://script.google.com/macros/s/AKfy…/exec"
# {"ok":true}
```

If you get an HTML Google sign-in page instead, "Who has access" is not "Anyone".

### 5. Vercel environment variables

Set these for **Production** and **Preview** (Project → Settings → Environment Variables), then redeploy:

| Name | Value |
|---|---|
| `WAITLIST_SCRIPT_URL` | the web app `/exec` URL from step 4 |
| `WAITLIST_SCRIPT_SECRET` | the secret from step 1 (same as the `WAITLIST_SECRET` script property) |

With the CLI (each command prompts for the value, so it never lands in shell history):

```sh
vercel env add WAITLIST_SCRIPT_URL production
vercel env add WAITLIST_SCRIPT_URL preview
vercel env add WAITLIST_SCRIPT_SECRET production
vercel env add WAITLIST_SCRIPT_SECRET preview
```

Never put the secret in `vercel.json`, the repository, or a committed `.env` file. To rotate it, change the
script property and the Vercel variable together, then redeploy the site.

### 6. Updating the script

After editing `apps-script/Code.gs`, paste it into the editor and save, then **Deploy → Manage deployments**,
select the deployment, click the pencil (**Edit**), set **Version: New version**, and **Deploy**. The `/exec` URL
stays the same, so Vercel needs no change. (Saving alone does not update a deployment, and **New deployment**
would create a second URL.) Script property changes take effect immediately, without redeploying.

### 7. Test

- Unit tests: `npm test`. They cover validation, the origin check, the rate limit, the Apps Script client (the
  302 to `script.googleusercontent.com`, sign-in pages, HTML and non-JSON answers, timeouts) and `Code.gs`
  itself, run in a `node:vm` sandbox against fake Sheets, Lock and Properties services.
- The script directly. `curl -L` follows Google's 302 to `script.googleusercontent.com` and, as curl does for a
  302, turns the POST into a GET there, which is exactly what is needed (don't add `-X POST`, which would make
  curl re-POST to the redirect target):

  ```sh
  SECRET=…   # the shared secret
  curl -sL "https://script.google.com/macros/s/AKfy…/exec" \
    -H 'content-type: application/json' \
    --data "{\"secret\":\"$SECRET\",\"entry\":{\"email\":\"you+test@example.com\",\"name\":\"curl test\"}}"
  # {"status":"joined"}, then {"status":"already"} the second time; {"error":"unauthorized"} with a wrong secret
  ```

- The site function, after deploying with the env vars set (the Origin header is required):

  ```sh
  curl -si https://cloakpipe.co/api/waitlist \
    -H 'origin: https://cloakpipe.co' -H 'content-type: application/json' -H 'accept: application/json' \
    --data '{"email":"you+test2@example.com","role":"Other"}'
  # HTTP/2 201 … {"status":"joined"}
  ```

  `curl -i https://cloakpipe.co/api/waitlist` answers `405`; a POST from another origin answers `403`. Preview
  deployments may sit behind Vercel Authentication, in which case curl gets Vercel's login page.
- In a browser: open `/waitlist`, submit your own email and check a row appears; submit it again and you should
  see "You're already on the list" with no second row. Without JS (disable it in devtools) the form still posts
  and the page shows the result. Delete test rows from the sheet afterwards.
- On failure the Vercel function log names the step and a hint, e.g. `Apps Script redirect failed (HTTP 302):
  redirected to Google sign-in (hint: the web app is not public: …)` or `script answered error "unauthorized"
  (hint: WAITLIST_SCRIPT_SECRET in Vercel does not match …)`. Script-side errors are under **Executions** in
  the Apps Script editor.

### Analytics

On success the page sends an Umami event `waitlist_joined` (or `waitlist_already`) with the selected `role`
only; email, name and company are never sent. After a no-JS post the event is sent when the page loads with
`?joined=…` (without a role).

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
| Apps Script error (bad secret, sign-in page, HTML, non-JSON) | `502 {"error":"upstream"}` | `?error=server` |
| Apps Script timeout (10 s) | `504 {"error":"upstream"}` | `?error=server` |
| Any other method | `405`, `Allow: POST` | |

Error responses never include the secret, the script URL, Google's response bodies or stack traces; the server
log names the failing step, the HTTP status, the script's short error code and a setup hint.
