---
layout: ../../layouts/Docs.astro
title: Overview
description: What CloakPipe is, the Evaluate, Certify, Enforce, Prove model, and which parts are open source and which run in CloakPipe Cloud.
---

# CloakPipe documentation

CloakPipe is the reliability layer for AI agents. It gives one exact agent configuration a name (the **release**), turns your evaluation results about that release into a signed **certification**, makes the runtime act on that certification, and records **evidence** that a third party can verify offline.

## The model: Evaluate, Certify, Enforce, Prove

| Step | What happens | Where it runs |
|---|---|---|
| **Evaluate** | You keep your evaluation tool. `cloakpipe eval import` turns JUnit XML, a Braintrust experiment or a Langfuse dataset run into a native `EvaluationRun` bound to the release's manifest hash. | CLI, offline |
| **Certify** | `cloakpipe release certify` applies a `CertificationPolicy` to the runs and reaches a deterministic `CERTIFIED` or `BLOCKED` decision, optionally signed as a DSSE-wrapped in-toto statement with Ed25519. | CLI, offline; GitHub Action |
| **Enforce** | The `cloakpipe mcp-proxy` tool gate lets only a certified release call the tools its manifest declares. CloakPipe Cloud's proxy feeds the release's certification status into Cedar policy, gates production promotion and watches the running release with sentinels. | CLI (MCP); Cloud (LLM proxy, registry) |
| **Prove** | Every hop is written to a hash-chained, Ed25519-signed ledger. The standalone `cloakpipe-verify` binary checks an exported bundle offline. | Core ledger + verifier; Cloud export |

Everything hangs off one identifier: the release's **manifest hash**, `sha256:<hex>` over a canonical view of the manifest. A passing test of one configuration can never certify a different one. See [Agent releases](/docs/releases).

## Open source and cloud

**Open source** in [rohansx/cloakpipe](https://github.com/rohansx/cloakpipe) (MIT; the standalone verifier crate is Apache-2.0):

- The Rust privacy proxy (`cloakpipe start`): detect, mask, forward, unmask, with an encrypted vault.
- The MCP server (`cloakpipe mcp`) and MCP interceptor (`cloakpipe mcp-proxy`).
- The evidence ledger and the offline verifier (`cloakpipe-verify`).
- Release manifests (`cloakpipe release`), evaluation import (`cloakpipe eval import`), certification and the GitHub Action, and the MCP tool gate.
- External anchoring of evidence bundles (`cloakpipe anchor`, RFC 3161 and Sigstore Rekor) and release audit packs (`cloakpipe release audit-pack`, `cloakpipe-verify release-pack`). See [Evidence & verification](/docs/evidence) and [Audit packs](/docs/audit-pack).

All of this is on `main`; the [quick start](/docs/quickstart) installs it.

**CloakPipe Cloud** <span class="badge cloud">Cloud</span> is the hosted service (early access: [join the waitlist](/waitlist)). It is not open source. It adds:

- The release registry: `cloakpipe release register` from CI, environment pointers and promotion history.
- Release-aware runtime enforcement in the hosted LLM proxy: Cedar context, unmask rules, the production promotion gate, break-glass, scoped API keys and sentinels. See [Runtime enforcement](/docs/runtime).
- Evaluation upload from CI or the dashboard, converted by the same importers as the CLI. See [Evaluation import](/docs/evaluation#upload-to-cloakpipe-cloud).
- A signed audit pack download for every release. See [Audit packs](/docs/audit-pack#cloakpipe-cloud).
- The India DPDP compliance pack at the proxy. See [Runtime enforcement](/docs/runtime#dpdp-compliance-pack).
- Evidence export and verification endpoints, the dashboard, and team features.

CloakPipe Cloud is in early access with design partners. To get access, [join the waitlist](/waitlist); everything on `main` above works today without it.

## Status labels

Every page says what state each feature is in:

- <span class="badge oss">Main</span> merged to `main` of the open-source repo.
- <span class="badge cloud">Cloud</span> runs in CloakPipe Cloud.
- <span class="badge building">Building</span> in progress or planned, not usable yet.

## Where to go next

- [Quick start](/docs/quickstart): install the CLI and certify a sample release in a few minutes.
- [Certification](/docs/certification): the policy rules, signing and verification.
- [MCP tool gate](/docs/mcp-gate): enforce certification at an agent's tool calls.
- [Integrations](/docs/integrations): providers, frameworks and the [playground](/playground).
