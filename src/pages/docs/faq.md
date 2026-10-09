---
layout: ../../layouts/Docs.astro
title: FAQ & limitations
description: Common questions about CloakPipe and an honest list of what it does not do yet.
---

# FAQ & limitations

## Is CloakPipe open source?

The core is, under MIT, in [rohansx/cloakpipe](https://github.com/rohansx/cloakpipe): the privacy proxy, vault, MCP server and interceptor, evidence ledger and the offline verifier (the verifier crate is Apache-2.0). Release manifests, evaluation import, certification, the MCP tool gate, external anchoring and release audit packs are on `main` of the same repository. CloakPipe Cloud (the hosted registry, runtime enforcement, evaluation upload, audit pack downloads, the DPDP pack and the dashboard) is not open source.

## Do I need CloakPipe Cloud to certify a release?

No. `cloakpipe eval import`, `release certify` and `release verify-cert` run offline on your machine or in CI, and the [MCP tool gate](/docs/mcp-gate) enforces certifications without any service. The cloud adds the release registry, promotion gating, release-aware LLM proxy enforcement and sentinels. It is in early access: [join the waitlist](/waitlist).

## Does a certification prove my agent is safe?

No. A valid certification proves that a named issuer applied a named policy to named evaluation runs of an exact release and reached the stated decision. It does not prove the evaluators measured the right property, that the suites are representative, or that the release is safe outside the certified scope and validity window.

## What happens if I change one prompt?

The manifest hash changes, so the old certification no longer applies to the new release. `cloakpipe release diff` shows which assurance suites the change requires (for a prompt: `prompt_contract`, `functional`, `safety`, `privacy`, `regression`). See [Agent releases](/docs/releases#diff).

## Can a caller lie about which release it is?

With an unscoped API key, yes: the `X-CloakPipe-Release` header is self-asserted. Use a [scoped API key](/docs/runtime#scoped-api-keys) so the server picks the release, and require `context.release.bound` in Cedar.

## Known limitations

- **Langfuse dataset runs.** The importer reads `/api/public/datasets/{dataset}/runs/{run}`, which Langfuse is deprecating; reading the experiments API is <span class="badge building">Building</span>.
- **Braintrust trials.** Experiments must run with one trial per case.
- **MCP server identity.** The tool gate does not check `spec.mcpServers`; it fronts the one upstream it was started with.
- **Self-asserted headers.** Unscoped keys let callers omit or misstate their release unless policy requires `bound` or `declared`.
- **Sentinel coverage.** Only calls whose release the server chose are measured; streamed calls are timed to first byte, and calls whose client disconnects are not recorded.
- **One Cedar policy set.** Policies are global per deployment; per-tenant policies are <span class="badge building">Building</span>.
- **Anchoring.** `cloakpipe anchor` seals one exported bundle as a single batch; sealing new records incrementally in further batches, and Rekor v2, are <span class="badge building">Building</span>. The verifier does not check certificate revocation (CRL/OCSP) or Rekor log consistency. CloakPipe Cloud does not anchor its ledger yet. See [External anchoring](/docs/evidence#external-anchoring).
- **Audit packs.** Governance events are attested only by the exporter, and a verifier cannot tell whether anything was left out. See [Audit packs](/docs/audit-pack#what-a-pack-does-not-prove).
- **DPDP pack.** Not legal advice; purpose, consent and age band are asserted by the caller. An RBI pack is <span class="badge building">Planned</span>. See [Runtime enforcement](/docs/runtime#dpdp-compliance-pack).

## Still stuck?

Email [rohan@cloakpipe.co](mailto:rohan@cloakpipe.co) or open an issue on [GitHub](https://github.com/rohansx/cloakpipe/issues).
