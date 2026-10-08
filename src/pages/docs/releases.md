---
layout: ../../layouts/Docs.astro
title: Agent releases
description: The Agent Release manifest, its canonical hash, material-change diffs and registering a release with CloakPipe Cloud.
---

# Agent releases <span class="badge oss">Main</span>

An **Agent Release** is the complete, immutable set of behaviour-affecting components deployed as one unit. CloakPipe evaluates, certifies, enforces and records evidence against the release's **manifest hash**, so a passing test of one configuration can never certify a different one.

The `cloakpipe release` commands are on `main` of the open-source repository (install: [quick start](/docs/quickstart#1-install-the-cli)).

## Manifest

```yaml
apiVersion: cloakpipe.co/v1alpha1
kind: AgentRelease
metadata:
  agent: support-agent        # identity — hashed
  version: "184"              # human release number — not hashed
  labels: {team: support}     # bookkeeping — not hashed
spec:
  code: {repository: acme/support, commit: 8fd29ac}
  prompts: [{ref: prompt:support-answer@31}]      # ordered
  model: {ref: model:openai/gpt-5@2026-08-01}
  parameters: {temperature: 0.2, max_tokens: 1200}
  tools: [{ref: tool:lookup-customer@7}, {ref: tool:refund@4}]
  mcpServers: [{ref: mcp:crm@12}]
  retrieval: {ref: retrieval:support@22}
  policies: [{ref: policy:support-prod@11}]
  runtime: {image: registry/agent@sha256:<64 hex>, region: in-south}
  dependencies: [{name: orchestrator, version: 2.4.1}]
  featureFlags: {}
```

Manifests written by CloakPipe up to 0.10 use the legacy `apiVersion: cloakpipe.dev/v1alpha1`. They are still accepted, never rewritten, and keep the hash they were issued with (see [Hash](#hash)).

References are `<kind>:<name>@<version>`, where `version` is a digest (`sha256:<64 hex>`) or an immutable version: an optional `v` followed by a digit (`31`, `v2`, `2.4.1`, `2.0.1-rc.1`, `2026-08-01`). This is an allowlist, so moving labels (`@latest`, `@production`, `@nightly`, `@beta`, …) and unversioned references are rejected.

A release is **certifiable** only if:

- every reference is immutable,
- the commit is a hex SHA,
- the runtime image is pinned by digest, and
- no two object keys in `parameters` or `featureFlags` collide after Unicode NFC normalisation.

## Hash

```text
manifest_hash = "sha256:" + hex(SHA-256("cloakpipe.co/agent-release/v1" || "\n" || JCS(view)))
```

A legacy `cloakpipe.dev/v1alpha1` manifest is hashed with the legacy domain `cloakpipe.dev/agent-release/v1`, so release hashes issued before the move to `cloakpipe.co` stay valid.

`view` contains `apiVersion`, `kind`, `metadata.agent` and the full `spec`, with every string NFC-normalised, references flattened to strings, unordered collections (`tools`, `mcpServers`, `policies`, `dependencies`) sorted, prompt order preserved, and an absent `retrieval` as `null`. `JCS` is RFC 8785, and numbers are written as RFC 8785 requires (`1e-7`, `100000000000000000000`, `1e+21`).

Consequences:

- YAML and JSON forms of the same manifest hash identically.
- Re-registering identical behaviour under a new release number yields the same hash.
- Any material change yields a different one.

## CLI

```bash
cloakpipe release validate release.yaml        # exit 1 with field paths if not certifiable
cloakpipe release hash release.yaml            # prints sha256:… ; refuses invalid manifests
cloakpipe release diff old.yaml new.yaml       # material changes + required assurance (--json)
cloakpipe release inspect release.yaml --json  # in-toto v1 Statement for signing
cloakpipe release register release.yaml        # register with CloakPipe Cloud (CI)
```

Exit codes for all `release` commands: **0** ok, **1** invalid input, **2** usage, I/O or network error.

## Diff

`cloakpipe release diff BASELINE CANDIDATE [--json]` lists material changes over the canonical view, so key order, set order, the release number and labels never show up as changes. Each changed component maps to the minimum assurance suites it needs before the candidate can be certified:

| Component changed | Required suites |
|---|---|
| prompt | `prompt_contract`, `functional`, `safety`, `privacy`, `regression` |
| model | `functional`, `tool_use`, `safety`, `privacy`, `regression`, `performance`, `cost` |
| parameters | `functional`, `regression`, `performance`, `cost` |
| tool | `trajectory`, `authorization`, `side_effect`, `regression` |
| mcp_server | `publisher_trust`, `capability_diff`, `authorization`, `adversarial`, `regression` |
| retrieval | `grounding`, `access_control`, `freshness`, `representative` |
| policy | `policy_static_analysis`, `decision_replay` |
| code, runtime, dependency, feature_flag | `functional`, `regression` |

Changes to tools, MCP servers or policies also print `approval required: change expands or alters tool, MCP or policy authority`. Example:

```text
baseline   sha256:28b40cf5…  support-agent@184
candidate  sha256:2feecf83…  support-agent@185

changes:
  changed  prompt       prompt:support-answer@31 -> prompt:support-answer@32
  added    tool         tool:send-email@2

required assurance:
  - prompt_contract
  - functional
  - regression
  - safety
  - privacy
  - trajectory
  - authorization
  - side_effect

approval required: change expands or alters tool, MCP or policy authority
```

[`cloakpipe release certify --baseline`](/docs/certification#certify) uses the same diff to decide which suites must be covered.

## Register

<span class="badge cloud">Cloud</span> `cloakpipe release register release.yaml [--json]` validates the manifest locally first (an uncertifiable manifest is never sent), then sends it to CloakPipe Cloud. It needs two environment variables:

| Variable | Value |
|---|---|
| `CLOAKPIPE_API_URL` | your CloakPipe Cloud API, e.g. `https://api.cloakpipe.co` |
| `CLOAKPIPE_API_KEY` | a CloakPipe API key (an unscoped key; see [scoped keys](/docs/runtime#scoped-api-keys)) |

The request is `POST $CLOAKPIPE_API_URL/v1/agents/<agent>/releases` with the key in the `x-cloakpipe-key` header (a `/` in the agent name is sent as `%2F`). On `200` or `201` it prints the release hash, whether it was newly registered, the baseline it was compared against, the required assurance and the evidence ledger sequence; `--json` prints the raw response. A `400`, `409` or `422` prints the error and each issue's path.

Exit codes: **0** registered or already registered, **1** manifest rejected, **2** configuration, network or server error.

## Evidence binding

Set `CLOAKPIPE_RELEASE=sha256:…` when running `cloakpipe mcp-proxy`; every ledger hop then carries `release_hash` inside its signed, hash-chained bytes. A malformed value stops the interceptor from starting. See [MCP tool gate](/docs/mcp-gate).

## Source

The manifest schema, the Rust crate (`cloakpipe-release`) and a stdlib-only Python reference implementation of the hash (`tools/release_hash_reference.py`) are on `main`: [`crates/cloakpipe-release`](https://github.com/rohansx/cloakpipe/tree/main/crates/cloakpipe-release) and [`tools/release_hash_reference.py`](https://github.com/rohansx/cloakpipe/blob/main/tools/release_hash_reference.py).
