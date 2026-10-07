---
layout: ../../layouts/Docs.astro
title: MCP tool gate
description: cloakpipe mcp-proxy flags, how the release gate decides each tools/call, JSON-RPC refusals and fail-closed behaviour.
---

# MCP tool gate

`cloakpipe mcp-proxy` sits between an agent and one upstream MCP server. It always masks PII in tool-call arguments and rehydrates pseudonym tokens in results. With `--manifest`, it also **enforces certification where the agent acts: its tool calls**.

| Capability | Status |
|---|---|
| `mcp-proxy --upstream` (masking interceptor) | <span class="badge oss">Main</span> |
| `cloakpipe mcp` (MCP server with `pseudonymize`, `rehydrate`, `detect`, `vault_stats`, `configure`, `session_context` tools) | <span class="badge oss">Main</span> |
| Release gate (`--manifest`, `--certification`, …) and release-bound evidence | <span class="badge oss">Main</span> |

## Usage

```bash
cloakpipe mcp-proxy --upstream "npx -y @acme/crm-mcp" \
  --manifest release.yaml --certification release.cert.dsse.json \
  --trust-key "$KEYID=$PUBHEX" --environment production
```

| Flag | Meaning |
|---|---|
| `--upstream CMD` | required. Upstream MCP server command and args, e.g. `--upstream "npx -y @modelcontextprotocol/server-filesystem /data"` |
| `--manifest FILE` | the Agent Release manifest the agent runs as. Enables the tool gate: `tools/call` must name a tool the manifest declares |
| `--certification FILE` | DSSE certification envelope of the release. Without one, every `tools/call` is refused (enforce) or reported (warn) |
| `--trust FILE` | trusted signer key file (from `release keygen`; public part only); repeatable |
| `--trust-key KEYID=PUBHEX` | trusted signer inline; repeatable |
| `--revoked-statement HEX` | SHA-256 hex of a revoked certification statement; repeatable |
| `--revoked-key KEYID` | key id of a revoked signer; repeatable |
| `--environment ENV` | the environment the agent runs in; the certification must cover it (default `production`) |
| `--gate enforce\|warn` | `enforce` (default) refuses calls that fail the gate; `warn` forwards them and reports |

## How a call is decided

With `--manifest`, each `tools/call` passes only if:

1. the tool is declared in the manifest's `spec.tools` (`tool:refund@4` declares `refund`), and
2. `--certification` verifies offline **at the moment of the call**: trusted signer (`--trust` / `--trust-key`), not revoked (`--revoked-statement`, `--revoked-key`), inside its validity window, about this manifest's release, a `certified` decision, for `--environment`.

Because verification happens per call, a certification that expires while the proxy runs stops the next call.

## Refusals

With `--gate enforce`, a refused call never reaches the upstream tool. The agent receives JSON-RPC error **`-32001`** with `data: {reason, tool, release}` (notifications get no reply). Reasons:

| `reason` | Why |
|---|---|
| `undeclared_tool` | the manifest does not declare the tool |
| `uncertified` | no `--certification` was given |
| `wrong_environment` | certified, but for another environment |
| `blocked` | the certification is a verified `BLOCKED` decision |
| `expired`, `revoked`, `invalid`, … | the certification's verification status |

The refusal is recorded as a release-bound `mcp_tool_call` hop with action `block` and `gate_denial=<reason>`. With `--gate warn`, the call is forwarded, the violation is logged, and the hop is marked `gate_violation=<reason>`.

## Fail-closed behaviour

- With a gate, only a message it can read in full is forwarded, re-serialized (never the raw line). In both modes it refuses, with a JSON-RPC error (`id: null`) and a `block` hop:
  - lines that do not parse: `unreadable`, **`-32700`** (out-of-range numbers, lone surrogates, deep nesting that laxer upstream parsers accept),
  - batches: `batch`,
  - non-objects: `not_an_object`,
  - case variants of JSON-RPC member names such as `"Method"` or `"Name"`: `noncanonical` (some decoders match keys case-insensitively).
- `--manifest` without a certification refuses every call.
- These refuse to start: any gate flag without `--manifest`, a malformed `--revoked-statement`, an uncertifiable manifest, an unreadable envelope, or a `CLOAKPIPE_RELEASE` naming another release.

## Evidence

The manifest also binds every evidence hop to its release: each ledger hop carries `release_hash` inside its signed, hash-chained bytes. Without `--manifest`, set `CLOAKPIPE_RELEASE=sha256:…` for the same binding; a malformed value stops the interceptor from starting. See [Evidence & verification](/docs/evidence).

## Limits

MCP server identity (`spec.mcpServers`) is not checked: the gate fronts the one upstream it was started with. Run one `mcp-proxy` per upstream server.

## Source

The interceptor and MCP server are in [`crates/cloakpipe-mcp`](https://github.com/rohansx/cloakpipe/tree/main/crates/cloakpipe-mcp) on `main`, including the gate (`gate.rs`).
