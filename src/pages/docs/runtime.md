---
layout: ../../layouts/Docs.astro
title: Runtime enforcement
description: How CloakPipe Cloud acts on certifications at request time and promotion time - release headers, Cedar context, unmask rules, the production gate, break-glass, scoped API keys and sentinels.
---

# Runtime enforcement <span class="badge cloud">Cloud</span>

A certification is only useful if something acts on it. In CloakPipe Cloud two places do: the **proxy**, at request time, and the **registry**, at promotion time. (For enforcement at an agent's tool calls without the cloud, see the [MCP tool gate](/docs/mcp-gate).)

## The proxy

CloakPipe Cloud is a drop-in proxy for the OpenAI and Anthropic APIs at `https://api.cloakpipe.co/v1`. Send two headers: `X-CloakPipe-Key` with your `cpk_live_…` key and `Authorization: Bearer` with your **own** provider key, which is forwarded upstream.

```bash
curl https://api.cloakpipe.co/v1/chat/completions \
  -H "X-CloakPipe-Key: cpk_live_xxxxxxxxxxxxxxxx" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -H "X-CloakPipe-Release: sha256:ae7bc9e404c194c9fcf80d95cafe4c322e4e9f69595c693ffb48441647d03c32" \
  -H "X-CloakPipe-Environment: production" \
  -d '{
    "model": "gpt-4o",
    "messages": [
      {"role": "user", "content": "Email jane@acme.com about invoice #4821"}
    ]
  }'
```

Calls to `/v1/chat/completions` and `/v1/embeddings` may name their release:

| Header | Value |
|---|---|
| `X-CloakPipe-Release` | `sha256:<hex>` manifest hash (malformed → `400`) |
| `X-CloakPipe-Environment` | `draft`, `candidate`, `staging`, `production` (default) or `rollback` (other → `400`) |

## Release status

For each call, the release's certifications for that environment become one status. Rules apply in this order:

| Status | Meaning |
|---|---|
| `certified` | at least one certification is `certified`, unrevoked, already issued and not yet expired |
| `uncertified` | the release has no certification for this environment |
| `revoked` | a certification was revoked and none is valid now |
| `blocked` | the newest certification is a `blocked` decision |
| `expired` | the newest certification is outside its validity window |
| `unregistered` | the caller never registered this release |

Any valid certification certifies; a newer `blocked` decision or an older revoked certification does not cancel it. To stop a release, revoke the certification that is still valid: a revocation then stands until a new valid certification is issued. Without a registry, or if the lookup fails, a declared release is `unknown`, never `certified`. Status is looked up on every call with no cache, so a revocation or promotion takes effect on the next request.

## Release context in Cedar

Each LLM hop is authorized with [Cedar](https://www.cedarpolicy.com/) after masking and before forwarding. The request evaluated is:

```text
principal  Tenant::"<tenant-uuid>"      // derived from the caller
action     Action::"LlmPrompt" | Action::"Unmask"
resource   Provider::"openai" | "anthropic" | ...   // from the model
context    { release: { declared: Bool, status: String,
                        environment: String, agent: String } }
```

Every attribute is always present, so policies never hit a missing-attribute error (Cedar skips a policy whose evaluation errors, which would silently disable a `forbid`). With a [scoped key](#scoped-api-keys) there is also `context.release.bound`.

The default policy set:

```text
// Permit all hops by default.
permit(principal, action, resource);

// Demo enforcement: never route to a provider named "blocked".
forbid(principal, action, resource == Provider::"blocked");

// A revoked certification stops the release.
forbid(principal, action, resource) when { context.release.status == "revoked" };

// Only a certified release sees real values in responses.
forbid(principal, action == Action::"Unmask", resource)
    when { context.release.declared && context.release.status != "certified" };
```

What that means:

- **Revoked → refused.** `LlmPrompt` is denied: `403` with `{"error": "policy_denied", "action", "provider", "release_status", "environment"}`, a `POLICY_BLOCK` ledger record bound to the release and a `policy.block` audit row. Nothing reaches the provider.
- **Declared but not certified → masked response.** The prompt is forwarded (masked, as always) but `Unmask` is denied, so the response keeps pseudonyms instead of real values.
- **No release declared → unchanged.**

### Unmask rules

`Unmask` is a Cedar decision on every chat call. When it is denied, the response carries `X-CloakPipe-Unmask: withheld` (otherwise `allowed`) and `_cloakpipe.release_status`, and a `policy.unmask_withheld` audit row is written. Streaming responses follow the same decision.

**Custom policy sets** replace the default via `CEDAR_POLICIES_PATH`. They must permit `Action::"Unmask"` as well as `Action::"LlmPrompt"`: Cedar is default-deny, so a set that permits only `LlmPrompt` returns pseudonymized responses to every caller (the API logs a warning at boot). To require every call to name a certified release:

```text
permit(principal, action, resource) when {
    context.release.declared && context.release.status == "certified"
};
```

The engine fails closed: if `CEDAR_POLICIES_PATH` is set and the file is unreadable or does not parse, the API refuses to start. A request that cannot be expressed in Cedar is denied, and an empty policy set denies everything. Today there is one global policy set; per-tenant policies from the dashboard are <span class="badge building">Building</span>.

## Scoped API keys

The headers above are asserted by the caller. A key created with a scope takes that choice away from it. Create one with `POST /api/keys {"name", "agent": "support-agent", "environment": "production"}`, or in the dashboard under Settings → Vault.

- **Environment** is the key's. An `X-CloakPipe-Environment` naming another one is `403 {"error": "scope_violation"}`.
- **Release** is the one the agent's environment pointer names, so calls need no `X-CloakPipe-Release` and promotion takes effect on the next request. A header may name another *registered release of the same agent* (a canary), judged on its own status; any other release is `403`. With nothing promoted yet the status is `unpromoted` (masked-only by default).
- **Cedar** sees `context.release.bound == true` only for the pointer's release. Require it to accept only server-chosen releases:

  ```text
  forbid(principal, action == Action::"Unmask", resource) unless { context.release.bound };
  ```

- **Runtime only.** A scoped key cannot register releases, import evaluation runs, certify or promote (`403 {"error": "runtime_key"}`), not even within its own scope: a leaked runtime key must not be able to approve its own release. Use an unscoped key (CI) or a dashboard session for those.
- A stored scope with only an agent or only an environment is refused, never treated as unscoped. Without a configured registry a scoped key is refused (`503`).

Unscoped keys keep the self-asserted behaviour: a caller holding one can still omit or misstate its release unless the policy requires `bound` or `declared`.

## Production promotion gate

`PUT /api/agents/{agent}/environments/production` (dashboard session) or `PUT /v1/agents/{agent}/environments/production` (API key) requires the release to be `certified` for `production`. Otherwise it returns `409`:

```json
{ "error": "certification_required", "environment": "production",
  "release_status": "expired", "message": "…" }
```

This applies to re-pointing production at the release it already references, too. Other environments are not gated; `rollback` stays available as the emergency path.

### Break-glass

```json
{"release": "sha256:…", "reason": "INC-4521", "break_glass": true}
```

promotes anyway. A non-empty reason is required (`400` otherwise; the database enforces it as well). The move is marked `break_glass` in the pointer history (dashboard: Agents → Releases → Promotion history) and the `ReleasePromoted` ledger record carries `break_glass: true`. A `break_glass` request for a release that is in fact certified is recorded as an ordinary promotion. The response includes `certification_status` and `break_glass`.

## Sentinels

A certification says a release was good when it was evaluated. Sentinels watch it while it runs.

- **Outcomes.** Chat and embeddings calls whose release the **server chose** (a scoped key running its environment's pointer) record `ok`, `guardrail_blocked`, `policy_denied` or `upstream_error` (any 5xx) with their latency. Calls that name their release in a header, calls with no release, and every 4xx are not recorded.
- **Rules.** A sentinel watches one agent's environment: `metric op threshold` over a trailing window, judged only once `min_calls` calls were made. Metrics: `guardrail_block_rate`, `error_rate`, `policy_denial_rate` (rates in [0, 1]) and `p95_latency_ms` (completed calls only). Only calls made as the release the environment **currently points at** count.
- **Breach.** With `"action": "revoke"` it first revokes that release's valid certifications for the environment (actor `sentinel:<id>`, `CertificationRevoked` evidence), so the next call is refused and production cannot be re-pointed at it without a new certification. Then the breach is recorded as an event, at most one per sentinel, release and window.
- **Evaluation** runs every `SENTINEL_INTERVAL_SECS` (default 60, `0` off) and on demand. Call outcomes older than 8 days are deleted (the longest window is 7). An agent can have at most 50 sentinels.
- **Limits.** A streamed call is recorded when the provider's response starts (latency to first byte; a stream that fails later still counts as `ok`), and a call whose client disconnects before it finishes is not recorded.

API (dashboard session only; Agents → Releases → Sentinels):

```text
GET    /api/agents/{agent}/sentinels
POST   /api/agents/{agent}/sentinels   {"name", "environment", "metric", "op": "gt"|"lt",
                                        "threshold", "window_seconds", "min_calls",
                                        "action": "alert"|"revoke"}
DELETE /api/agents/{agent}/sentinels/{id}        (disable; events are kept)
GET    /api/agents/{agent}/sentinels/events
POST   /api/agents/{agent}/sentinels/evaluate
```

## DPDP compliance pack

<span class="badge cloud">Cloud</span> A tenant can enable the India **DPDP pack** (Digital Personal Data Protection Act, 2023 and DPDP Rules, 2025), a versioned Cedar policy set (`dpdp`, version `1`) applied to its proxied chat and embeddings calls on top of the base policy set. A pack can only `forbid`, so it never widens what the base set allows.

- **Context per call** from headers: `X-CloakPipe-Purpose` (a purpose the tenant declared), `X-CloakPipe-Consent` (an opaque consent artefact id) and `X-CloakPipe-Principal-Age-Band` (`adult`, `child` or `unknown`). Malformed headers, and ids shaped like personal data (Aadhaar, PAN and similar), are `400 invalid_dpdp_header`. The provider's processing country comes from `CLOAKPIPE_PROVIDER_REGIONS`. Policies see it all as `context.dpdp`.
- **Rules**: a declared purpose on every call, consent or a Section 7 legitimate use, verifiable parental consent and no tracking for children, real values unmasked only under consent, for adults, to a server-bound certified release, and no transfer to a provider with an unknown region or in a country on the tenant's restricted list.
- **Outcome**: a denied prompt is `403 {"error": "dpdp_denied", "rule", "section", …}` and nothing reaches the provider; a denied unmask leaves the response pseudonymized (`X-CloakPipe-Dpdp-Rule`). Every decision, allow or deny, is written to the signed ledger with purpose and consent id before the call proceeds; if it cannot be recorded, or the pack cannot be loaded, the call is refused (`503`).
- **Configure** with `PUT /v1/tenant/packs/dpdp` (an unscoped admin key) or in the dashboard under Configure → Compliance packs, which also lists recent decisions and the enable/disable history.

The pack is a technical control, **not legal advice**, and does not make anyone "DPDP compliant". Purpose, consent and age band are what the caller asserts: the pack does not validate consent artefacts with a Consent Manager. Notices, rights requests, retention and breach reporting are out of scope, and MCP tool hops are not judged by the pack. An RBI pack is <span class="badge building">Planned</span>.

## Registry endpoints for CI

These take an API key in `X-CloakPipe-Key`:

| Endpoint | Purpose |
|---|---|
| `POST /v1/agents/{agent}/releases` | register a release (what `cloakpipe release register` calls) |
| `POST /v1/agents/{agent}/releases/{hash}/runs` | import an evaluation run for a release |
| `POST /v1/agents/{agent}/releases/{hash}/runs/import` | upload JUnit, Braintrust, Langfuse or native results ([Evaluation import](/docs/evaluation#upload-to-cloakpipe-cloud)) |
| `POST /v1/agents/{agent}/releases/{hash}/certify` | certify a release |
| `PUT /v1/agents/{agent}/environments/{environment}` | promote a release to an environment |
| `GET /v1/agents/{agent}/releases/{hash}/audit-pack` | download the release's signed [audit pack](/docs/audit-pack#cloakpipe-cloud) |

Public, no authentication, for offline verification: `GET /v1/certification/keys`, `GET /v1/certification/revocations` and `GET /v1/audit-pack/keys`.
