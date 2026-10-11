---
layout: ../../layouts/Docs.astro
title: MCP tool gate
description: cloakpipe mcp-proxy flags, how the release gate decides each tools/call, tool contracts, signed approvals, operation outcomes, JSON-RPC refusals and fail-closed behaviour.
---

# MCP tool gate

`cloakpipe mcp-proxy` sits between an agent and one upstream MCP server. It always masks PII in tool-call arguments and rehydrates pseudonym tokens in results. With `--manifest`, it also **enforces certification where the agent acts: its tool calls**.

| Capability | Status |
|---|---|
| `mcp-proxy --upstream` (masking interceptor) | <span class="badge oss">Main</span> |
| `cloakpipe mcp` (MCP server with `pseudonymize`, `rehydrate`, `detect`, `vault_stats`, `configure`, `session_context` tools) | <span class="badge oss">Main</span> |
| Release gate (`--manifest`, `--certification`, …) and release-bound evidence | <span class="badge oss">Main</span> |
| [Action boundary](#action-boundary): tool contracts, signed approval receipts, operation outcomes and reconciliation | <span class="badge building">Building</span> |

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

## Action boundary

<span class="badge building">Building</span> The release gate answers "may this release call this tool at all". The action boundary answers a narrower question: **may this exact call run**, decided only from trusted inputs. The model proposes a tool call; the gate checks its arguments against a signed-in contract and the orchestrator's task context, requires a signed approval for this exact payload when the contract says so, and tracks the outcome of every side-effecting call so an uncertain one is reconciled instead of retried blindly. This is in progress in the open-source core and not on `main` yet; the interface below is the one being built.

Fail closed everywhere: anything unparseable, unknown, expired or ambiguous is a denial. A release with no tool contract, and a gate started without the new flags, behaves exactly as described above.

### Tool contracts

A `ToolContract` declares, per tool, which arguments are allowed and what values they may take:

```yaml
apiVersion: cloakpipe.co/v1alpha1
kind: ToolContract
metadata:
  name: crm-tools
spec:
  tools:
    crm.patch:
      sideEffect: true          # track operation outcomes
      requiresApproval: true    # needs a signed approval receipt
      arguments:                # closed by default: unknown argument -> denial
        tenant: { bindTo: task.tenant }
        record: { bindTo: task.record }
        patch:
          type: object
          minProperties: 1
          additionalProperties: false
          properties:
            stage: { enum: [qualified, review] }
            note:  { type: string, maxLength: 280 }
      required: [tenant, record, patch]
```

The release binds the contract through its existing `spec.policies` list as `policy:<name>@sha256:<hex>`, where the hex is SHA-256 over the domain string `cloakpipe.co/tool-contract/v1`, a newline, and the RFC 8785 (JCS) bytes of the contract. The contract is therefore part of the certified [release hash](/docs/releases#hash), with no manifest schema change.

The constraint language is a small, deterministic subset of JSON Schema: `type` (`string`, `integer`, `number`, `boolean`, `object`, `array`, `null`), `enum`, `const`, `minLength` / `maxLength` (counted in Unicode scalar values), `pattern` (anchored full match), `minimum` / `maximum`, `properties`, `required`, `additionalProperties` (default `false`), `minProperties` / `maxProperties`, `items`, `minItems` / `maxItems`, plus one extension:

- `bindTo: task.<key>`: the value must equal (JSON equality) the trusted task context's value for that key. A missing task key is a denial.

Unknown keywords in a contract are a parse error, never ignored. Tools declared in the manifest's `spec.tools` but absent from every contract keep the release-gate behaviour.

### Trusted task context

The orchestrator writes a JSON object (flat or nested) describing the task the agent is working on, for example:

```json
{"taskId": "t-981", "tenant": "demo-co", "record": "lead-42"}
```

Pass it with `--task-context <file.json>` or `CLOAKPIPE_TASK_CONTEXT=<path>`. It never comes from MCP messages: `_meta`, tool arguments and anything else the agent sends cannot change it.

### Signed approval receipts

For a tool with `requiresApproval: true`, the gate needs a valid approval receipt for this exact call. The call is identified by its **argument fingerprint**: SHA-256 over `cloakpipe.co/tool-call/v1`, a newline, and the JCS bytes of `{"release": "<sha256:…>", "tool": "<name>", "arguments": <raw args>}`.

```bash
cloakpipe action fingerprint --manifest release.yaml --tool crm.patch --args call.json

cloakpipe release keygen --out approver.key
cloakpipe approve --manifest release.yaml --tool crm.patch --args call.json \
  --task-context task.json --key approver.key \
  [--expires 15m] [--operation-id <id>] --out approvals/
```

`approve` writes `approvals/<fingerprint-hex>.approval.json`: a DSSE envelope (Ed25519, payload type `application/vnd.in-toto+json`) holding an in-toto statement with predicate type `https://cloakpipe.co/attestations/approval/v1alpha1`, the fingerprint as subject, and the predicate `{ release, tool, taskId, operationId, approver, approvedAt, notAfter }`. `--operation-id` defaults to a fresh UUID v4.

The gate looks up `<fingerprint-hex>.approval.json` in `--approvals` and checks: a signature by a trusted `--approver-key`, `notAfter` not passed (and `approvedAt` not in the future beyond the usual clock-skew allowance), the release and tool equal the gate's, the subject equals the recomputed fingerprint, and `taskId` equals the task context's `taskId`. Any change to the arguments gives a different fingerprint, so no receipt is found. A receipt is not single-use on its own; replaying an approved call is handled by its operation ID (below).

### Operation identity and outcomes

For a tool with `sideEffect: true`, the gate keeps a durable record of each operation in a SQLite store (`--operations-db <path>` or `CLOAKPIPE_OPERATIONS_DB`). The store is required when any contract tool has `sideEffect: true`.

The **operation ID** comes from the approval receipt's `operationId` when there is one; otherwise it is `op-` followed by the first 32 hex characters of SHA-256 over `cloakpipe.co/operation/v1`, a newline, the `taskId`, a newline, and the fingerprint hex. The model never supplies it.

Before forwarding a call, the gate checks the stored operation in one transaction:

| Stored state | What the gate does |
|---|---|
| none | records `in_flight` and forwards the call |
| any, with a different call fingerprint | denies `operation_conflict` |
| `done` | does not forward; answers with the stored result, marked `_meta.cloakpipe.replayed = true` |
| `in_flight` or `unknown` | denies `reconcile_before_retry` |
| `failed` or `not_applied` | allows a retry and sets it back to `in_flight` |

A result without `isError: true` settles the operation as `done`; `isError: true` or a JSON-RPC error settles it as `failed`. If the upstream exits or the pipe breaks while operations are `in_flight`, they become `unknown`, and so does any `in_flight` row left by a previous process at startup.

MCP has no standard way to ask a server whether a call took effect, so reconciliation is an explicit operator step:

```bash
cloakpipe operations list --state unknown --operations-db ops.db
cloakpipe operations reconcile <operation-id> --outcome done --operations-db ops.db --ledger-db ledger.db
```

`--outcome` is `done` or `not-applied`. `reconcile` refuses unless the operation is `unknown` or `in_flight`.

### Flags

| Flag | Meaning |
|---|---|
| `--tool-contract FILE` | a `ToolContract`; repeatable. Each one's digest must appear in the release's `spec.policies`, and every tool-contract policy the release references must be supplied, or the gate refuses to start (exit 2) |
| `--task-context FILE` | the trusted task context (or `CLOAKPIPE_TASK_CONTEXT`) |
| `--approvals DIR` | directory of approval receipts named `<fingerprint-hex>.approval.json` |
| `--approver-key KEY` | a trusted approver public key; repeatable |
| `--operations-db PATH` | the operations store (or `CLOAKPIPE_OPERATIONS_DB`); required when a contract tool has `sideEffect: true` |

### Denials

Action boundary denials use the same JSON-RPC error `-32001` and `block` hop as the release gate, except `reconcile_before_retry`, which is error **`-32002`** with `data.operationId`. Codes are stable:

| Code | Why |
|---|---|
| `argument_missing` | a required argument is absent |
| `argument_not_allowed` | an argument the contract does not declare (its name is not echoed) |
| `argument_invalid` | a value breaks a rule; carries the contract path, such as `/patch/stage`, never the value |
| `scope_mismatch` | a `bindTo` value differs from the task context |
| `task_context_missing` | no task context, or it lacks a bound key |
| `approval_required` | no receipt for this exact call |
| `approval_invalid` | bad signature, or wrong release, tool, task or subject |
| `approval_expired` | `notAfter` has passed |
| `operation_conflict` | the operation ID is already used by a different call |
| `reconcile_before_retry` | the previous attempt is `in_flight` or `unknown` |

### Evidence

The ledger stays free of PII: it never holds raw argument values, or a plain hash of them. A denial hop carries `gate_denial=<code>` and, where it applies, `gate_path=<contract path>`. An approved call's `mcp_tool_call` hop carries `approval=<sha256 of the receipt envelope>` and `operation_id`; the receipt stays with the operator, and an auditor matches it to the ledger by digest. The `mcp_tool_result` hop carries `operation_id` and `operation_state` (`done` or `failed`; `unknown` when written by the process-exit sweep). Reconciliation appends an `operation_reconciled` hop with `operation_id` and `operation_state` (`done` or `not_applied`).

To check that a release neither under-blocks nor over-refuses at this boundary, certify it with a [boundary rule](/docs/certification#boundary-rule).

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
