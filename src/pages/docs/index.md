---
layout: ../../layouts/Docs.astro
title: Overview
description: CloakPipe is a self-hosted gate on AI agent tool calls. It refuses out-of-contract actions, asks a human when policy says so, and leaves evidence anyone can verify offline.
---

# CloakPipe documentation

**Model proposes. Code disposes.** An agent's model decides which tool to call and with what arguments. CloakPipe sits between the agent and its tools, checks every call against rules you wrote down, and only lets through the calls those rules allow. It runs on your machines as one binary, `cloakpipe`, and is MIT-licensed.

CloakPipe does three jobs at the **action boundary**, the point where a model's text becomes a side effect:

- **Stop** a tool call that is out of contract: an undeclared tool, an undeclared argument, an email to an address the task never mentioned, a refund over the limit.
- **Ask a human** when policy says a call needs approval, and let through only the exact call that was approved.
- **Leave evidence**: a signed, hash-chained entry for every decision, anchored to outside timestamping services, that an auditor can check offline without trusting you.

## Declare, enforce, prove

| Step | What you do | What CloakPipe does |
|---|---|---|
| **Declare** | Write one `cloakpipe.manifest.yaml`: the tools the agent may call, what each argument may hold, which calls have side effects and which need approval. Optionally point it at a Cedar policy for rate limits and tiers. | Loads and checks it at start-up, and refuses to start on a bad rule. See [Manifest reference](/docs/manifest) and [Policy](/docs/policy). |
| **Enforce** | Run your MCP server behind `cloakpipe mcp-proxy`. | Checks each `tools/call` in order (contract, Cedar, approval, side-effect state) and forwards it or answers with a JSON-RPC error. See [MCP tool gate](/docs/mcp-gate). |
| **Prove** | Export the ledger with `cloakpipe ledger export`. | Every decision is a signed ledger entry; epochs are anchored with an RFC 3161 timestamp authority and Sigstore Rekor; `cloakpipe verify` checks a pack offline. See [Evidence & verification](/docs/evidence). |

The [quick start](/docs/quickstart) runs all three on a sample support agent in a few minutes. In that example, a prompt-injected `send_email` to `attacker@evil.example` is refused as `scope_mismatch`, and a call to an undeclared `export_customers` tool is refused as `undeclared_tool`.

## Release status

The latest release is **v0.13.0** (28 October 2026): a [GitHub release](https://github.com/rohansx/cloakpipe/releases/tag/v0.13.0), the [`cloakpipe-cli` 0.13.0](https://crates.io/crates/cloakpipe-cli/0.13.0) package on [crates.io](https://crates.io/crates/cloakpipe-cli), and the Docker image [`ghcr.io/rohansx/cloakpipe:0.13.0`](https://github.com/rohansx/cloakpipe/pkgs/container/cloakpipe), which runs the gate by default. The [quick start](/docs/quickstart#1-install) shows the install. Every page labels what it describes:

- <span class="badge oss">v0.11</span> since v0.11, and still in v0.13.0.
- <span class="badge oss">v0.12</span> since v0.12, and still in v0.13.0.
- <span class="badge next">v0.13</span> new in v0.13.0: not in the 0.12.0 crates or the 0.12.0 image.
- <span class="badge building">Roadmap</span> planned, not built.

| Capability | Status |
|---|---|
| `cloakpipe mcp-proxy` over stdio, one upstream MCP server | <span class="badge oss">v0.11</span> |
| Signed approval receipts bound to one exact call (`cloakpipe approve`) | <span class="badge oss">v0.11</span> |
| Side-effect tracking with reconcile-before-retry (`--operations-db`, `cloakpipe operations`) | <span class="badge oss">v0.11</span> |
| The single-file `cloakpipe.manifest.yaml`, closed by default, with `one_of_context`, `idempotency_key` and conditional `approval` | <span class="badge oss">v0.12</span> |
| Cedar policies with persistent call counters and `@approval` | <span class="badge oss">v0.12</span> |
| A signed decision ledger written by default, shadow mode (`--mode shadow`) | <span class="badge oss">v0.12</span> |
| Scheduled anchoring epochs, `cloakpipe ledger export` and `cloakpipe verify` | <span class="badge oss">v0.12</span> |
| A lean default binary, MIT-only licence | <span class="badge oss">v0.12</span> |
| MCP over HTTP (Streamable HTTP) on both sides of the gate: `--listen` for agents, `--upstream-url` for servers | <span class="badge next">v0.13</span> |
| One gate in front of several stdio servers (`--server`), with `tools/list` pinning (`cloakpipe tools pin`, `--tools-lock`) and drift detection | <span class="badge next">v0.13</span> |
| Gate events as signed webhooks (generic, Slack, Discord), OpenTelemetry spans and a JSONL log. See [Alerts & events](/docs/events) | <span class="badge next">v0.13</span> |
| The Docker image runs the gate over HTTP by default. See [Docker](/docs/docker) | <span class="badge next">v0.13</span> |
| Tool-call checks in the OpenAI/Anthropic-compatible LLM proxy | <span class="badge building">Roadmap</span> |
| An approval broker, replay of a candidate manifest | <span class="badge building">Roadmap</span> |
| A hosted plane on top of the events (grouped alerts, routing, approval cards, digests). Nothing is sent to a hosted service today | <span class="badge building">Roadmap</span> |

v0.11.0 configured the gate with the older pair of files, an `AgentRelease` plus a `ToolContract`. v0.12.0 and v0.13.0 still read that pair, with a deprecation warning.

## What it is not

- **Not a sandbox.** It decides whether a tool call goes through. It does not contain a tool server that is already running, or code the agent runs some other way.
- **Not a prompt filter or jailbreak detector.** It does not read the model's reasoning. It checks the call the model proposes against rules that do not depend on the model.
- **Not observability.** Traces show what happened afterwards. The gate decides before the call happens and records why. Its optional OpenTelemetry spans <span class="badge next">v0.13</span> describe the gate's own decisions, not the agent's work.
- **Not identity or access management.** It does not issue or broker credentials. It decides what a release may do with the tools it already has.
- **Not a hosted service.** The gate runs on your machines and calls no CloakPipe service. The only outside calls are the ones you turn on: anchoring sends a signed epoch head (hashes, no arguments) to the timestamp authority and Rekor log you choose. Hosted alerts and approvals are not built; if you want them, [tell us on the waitlist](/waitlist).

The [threat model](/docs/threat-model) is specific about what the gate does and does not protect against.

## Open source

Everything on these pages is in [rohansx/cloakpipe](https://github.com/rohansx/cloakpipe) under the MIT licence. There is no paid tier of the gate. The same binary also has a PII transform (`mcp-proxy --transform pii`, and an OpenAI/Anthropic-compatible proxy, `cloakpipe start`) that pseudonymizes personal data in arguments. It is an optional transform on calls the gate has already allowed, not the product.

## Where to go next

- [Quick start](/docs/quickstart): run the support-agent example and watch the gate refuse the injected email.
- [MCP tool gate](/docs/mcp-gate): every flag, the decision order and the refusal codes.
- [Integrations](/docs/integrations): put the gate in front of a server in Claude Code, Cursor or Codex.
- [Alerts & events](/docs/events): tell a human about a refusal, by webhook, Slack, Discord or OpenTelemetry <span class="badge next">v0.13</span>.
- [Comparison](/docs/comparison): how CloakPipe differs from other agent governance tools.
