---
layout: ../../layouts/Docs.astro
title: MCP tool gate
description: Every cloakpipe mcp-proxy flag, the order in which a tools/call is decided, the refusal codes, approval receipts, side-effect tracking, shadow mode and fail-closed behaviour.
---

# MCP tool gate

`cloakpipe mcp-proxy` sits between an agent and an MCP server that speaks stdio. With `--manifest`, it decides every `tools/call` before the server sees it: a call the manifest and policy allow is forwarded exactly as the agent sent it, and any other call is answered with a JSON-RPC error and never reaches the tool. Every decision is written to a signed ledger.

<span class="badge unreleased">Unreleased</span> The gate can also speak MCP over HTTP on either side, and front several servers at once with their tool definitions pinned. See [MCP over HTTP](#mcp-over-http), [Several servers](#several-servers) and [Pinning tool definitions](#pinning-tool-definitions).

| Capability | Status |
|---|---|
| stdio proxy for one upstream server, tool gate, approval receipts, operations store | <span class="badge oss">v0.11</span> |
| v1 manifest (`cloakpipe.manifest.yaml`), Cedar policy, conditional approval, `idempotency_key` | <span class="badge next">v0.12</span> |
| Decision ledger by default, `--signing-key`, `--mode shadow`, anchoring flags | <span class="badge next">v0.12</span> |
| MCP over HTTP (Streamable HTTP): `--listen` for agents, `--upstream-url` for one HTTP server | <span class="badge unreleased">Unreleased</span> |
| Several stdio servers per gate (`--server`), `tools/list` pinning with a tools lock (`--tools-lock`) and drift detection | <span class="badge unreleased">Unreleased</span> |
| Event delivery: `--webhook`, `--otel-endpoint`, `--events-log` ([Alerts & events](/docs/events)) | <span class="badge unreleased">Unreleased</span> |
| SSE response streams and a `GET /mcp` stream for HTTP agents; HTTP servers behind `--server` | <span class="badge building">Roadmap</span> |

## Usage

```bash
cloakpipe mcp-proxy \
  --upstream "npx -y @acme/support-mcp" \
  --manifest cloakpipe.manifest.yaml \
  --task-context task-context.json \
  --operations-db ops.db \
  --approvals approvals/ --approver-key approver.json
```

`--upstream` is the server command line the host would otherwise run. The gate starts it as a child process, speaks to the agent on its own stdin and stdout, and logs to stderr. Without `--manifest` the proxy forwards everything, so always pass one.

## Flags

| Flag | Meaning |
|---|---|
| `--upstream CMD` | the upstream MCP server command and its arguments, as one string: the server named `default`. Required in v0.12.0; <span class="badge unreleased">Unreleased</span> optional when `--upstream-url` or `--server` is given. |
| `--server NAME=COMMAND` | <span class="badge unreleased">Unreleased</span> another stdio server (repeatable), such as `--server 'mail=npx -y @acme/mail-mcp'`. See [Several servers](#several-servers). |
| `--tools-lock FILE` | <span class="badge unreleased">Unreleased</span> a tools lock from `cloakpipe tools pin`: a tool that does not match its pin is hidden and refused as `tool_drift`. See [Pinning tool definitions](#pinning-tool-definitions). |
| `--upstream-url URL` | <span class="badge unreleased">Unreleased</span> the upstream MCP server over Streamable HTTP, instead of `--upstream`. Not with `--server` or `--tools-lock` yet (exit 2). |
| `--upstream-header 'Name: value'` | <span class="badge unreleased">Unreleased</span> a header sent on every request to `--upstream-url` (repeatable). A value `env:VAR` is read from that environment variable; values are never logged. |
| `--listen ADDR` | <span class="badge unreleased">Unreleased</span> serve agents MCP over HTTP on `ADDR` (such as `127.0.0.1:8900`) instead of stdio. Port `0` picks one. See [MCP over HTTP](#mcp-over-http). |
| `--listen-token-file FILE` | <span class="badge unreleased">Unreleased</span> a file holding a bearer token every `/mcp` request must carry. |
| `--manifest FILE` | the manifest the agent runs under. Enables the gate. A v1 `cloakpipe.manifest.yaml` is detected by its top-level `release` key; a legacy `AgentRelease` (top-level `apiVersion`) still works for this release, with a deprecation warning. See [Manifest reference](/docs/manifest). |
| `--mode enforce\|shadow` | `enforce` (default) refuses calls that fail the gate. `shadow` forwards every call the gate can read and records what enforce mode would have decided, with `mode: shadow` in each ledger entry. |
| `--task-context FILE` | the trusted task context: a JSON object the orchestrator writes, such as `{"taskId":"t-981","ticket":{"id":"T-1042"}}`. `one_of_context` arguments are checked against it. Default: `CLOAKPIPE_TASK_CONTEXT`. |
| `--approvals DIR` | directory of approval receipts, `<fingerprint hex>.approval.json`, from `cloakpipe approve`. Needs `--approver-key`. |
| `--approver-key FILE` | an approver key file from `cloakpipe release keygen` (only the public part is read); repeatable. A receipt must be signed by one of these keys. |
| `--operations-db PATH` | SQLite store of side-effecting calls. Required when the manifest has a tool with `side_effect: true`. Default: `CLOAKPIPE_OPERATIONS_DB`. One gate per database. |
| `--state-db PATH` | SQLite store of the Cedar policy's call counters, used when the manifest has `policy:`. Default: `CLOAKPIPE_STATE_DB`, else `$CLOAKPIPE_HOME/state.db`. The counters survive a restart. |
| `--ledger-db PATH` | the decision ledger. Default: `CLOAKPIPE_LEDGER_DB`, else `$CLOAKPIPE_HOME/ledger.db`. `CLOAKPIPE_HOME` defaults to `~/.cloakpipe`. |
| `--no-ledger` | record nothing, with a warning on stderr. Not recommended: nothing will show what the gate allowed or refused. |
| `--signing-key FILE` | the gate signing key that signs each ledger entry (a `cloakpipe release keygen` file). Default: `CLOAKPIPE_SIGNING_KEY`, else `$CLOAKPIPE_HOME/gate.key`, created owner-only on first use with its public key printed once on stderr. See [Keys](/docs/keys). |
| `--anchor-every N` | seal the ledger into an anchored epoch every N entries. |
| `--anchor-interval DURATION` | seal and anchor whatever is new this often (`30s`, `10m`, `1h`). Either or both anchoring flags turn anchoring on. |
| `--tsa URL` / `--tsa-root PEM` / `--no-tsa` | the RFC 3161 timestamp authority (default `https://freetsa.org/tsr`), the root(s) its answers must chain to (default: freetsa.org and DigiCert roots built in), or no timestamping. |
| `--rekor URL` / `--rekor-key PEM` / `--no-rekor` | the Sigstore Rekor log (default `https://rekor.sigstore.dev`), its public key (default: built in), or no Rekor entry. |
| `--tool-contract FILE` | legacy `AgentRelease` only, deprecated: a `ToolContract` file. A v1 manifest declares its rules inline, and passing this flag with one is a usage error. |
| `--events-log PATH` | <span class="badge unreleased">Unreleased</span> append every gate event to a JSONL file. See [Alerts & events](/docs/events). |
| `--webhook URL` | <span class="badge unreleased">Unreleased</span> POST every gate event to `URL` (repeatable), off the decision path. |
| `--webhook-secret-file FILE` | <span class="badge unreleased">Unreleased</span> sign webhook requests with HMAC-SHA256 under this secret. |
| `--webhook-format generic\|slack\|discord` | <span class="badge unreleased">Unreleased</span> the webhook payload: the event JSON (default), a Slack Block Kit message or a Discord embed. |
| `--otel-endpoint URL` | <span class="badge unreleased">Unreleased</span> export one OpenTelemetry span per tool-call decision, allows included, over OTLP/HTTP to `URL/v1/traces`. |
| `--otel` | <span class="badge unreleased">Unreleased</span> export spans to `OTEL_EXPORTER_OTLP_ENDPOINT`; the variable on its own exports nothing. |
| `--transform pii` | optional. After a call is allowed, pseudonymize personal data in its arguments before the tool sees it and put the real values back in results, through the encrypted vault (`CLOAKPIPE_VAULT_KEY`). Off by default: the gate never rewrites an allowed call. The manifest is always checked on the raw arguments. |

`--gate warn` from v0.11 still works as a hidden alias of `--mode shadow`.

## How a call is decided

Each `tools/call` goes through these stages in order. The first refusal wins, and every stage fails closed: if a stage cannot decide, the call is refused.

1. **Read.** Only a message the gate can parse in full is forwarded, and it is re-serialized rather than passed through raw. Unparseable lines, batches, non-objects and case variants of JSON-RPC member names are refused.
2. **Contract.** The manifest must declare the tool (`undeclared_tool`). The call may carry only the arguments the tool lists (`undeclared_argument`), must carry the `required` ones (`argument_missing`), and each value must pass its rules (`argument_invalid`, or `scope_mismatch` / `task_context_missing` for `one_of_context`).
3. **Cedar.** If the manifest has `policy:`, the policy must permit the call (`policy_denied`, naming the deciding policies). See [Policy](/docs/policy).
4. **Approval.** If the manifest's `approval.when` holds, or every Cedar permit that allowed the call carries `@approval`, the call needs a valid receipt for exactly this call (`approval_required`, `approval_invalid`, `approval_expired`).
5. **Side effects.** For a tool with `side_effect: true`, the operations store must have no conflicting or unsettled attempt (`operation_conflict`, `reconcile_before_retry`).
6. **Record, then forward.** The decision is written to the ledger first. If it cannot be written, the call is refused as `fail_closed` and not forwarded.

The test suite asserts that the contract and Cedar stages together take under 5ms at p99 on the example manifest (the target is 2ms). That figure does not include the ledger write or the upstream round trip.

## Refusals

A refused call gets JSON-RPC error **`-32001`** with `data: {reason, tool, release}` and, where it applies, `path` (the argument path, never its value), `policies`, `approvers` and `fingerprint`. `release` is the manifest digest. Notifications get no reply.

```json
{"jsonrpc":"2.0","id":2,"error":{"code":-32001,"message":"tool call refused by CloakPipe: scope_mismatch","data":{"reason":"scope_mismatch","tool":"send_email","release":"sha256:c558…","path":"/to"}}}
```

| `reason` | Why |
|---|---|
| `undeclared_tool` | the manifest does not declare the tool |
| `undeclared_argument` | the call carries an argument the tool does not list (its name is not echoed) |
| `argument_missing` | a `required: true` argument is absent |
| `argument_invalid` | a value breaks a rule (type, pattern, length, range, enum, …) |
| `scope_mismatch` | a `one_of_context` value matches no task context value and no `or_pattern` |
| `task_context_missing` | no task context, or it lacks a key a rule needs |
| `policy_denied` | no Cedar permit holds, or a forbid does; `data.policies` lists the deciding forbids by `@id` |
| `approval_required` | the call needs a receipt and there is none for this exact call; `data.approvers` and `data.fingerprint` are for an approval broker |
| `approval_invalid` | bad signature, untrusted approver, another release, tool, task or call, or a validity window longer than the tool's `ttl` |
| `approval_expired` | the receipt's `notAfter` has passed |
| `operation_conflict` | the operation id is already used by a different call |
| `reconcile_before_retry` | the previous attempt is `in_flight` or `unknown`: error **`-32002`**, with `data.operationId` |
| `request_id_missing`, `request_id_in_use` | a side-effecting call sent as a notification, or reusing a request id still in flight |
| `operations_unavailable` | the operations store cannot be read or written |
| `fail_closed` | a stage could not decide: a Cedar evaluation error, the counter store failing, or a ledger entry that could not be written |
| `tool_drift` | <span class="badge unreleased">Unreleased</span> the tool's definition does not match its pin in `--tools-lock`, has no pin, or changed during the session |
| `upstream_unavailable` | <span class="badge unreleased">Unreleased</span> the server could not be reached or exited: error **`-32003`**. A side-effecting call that was sent becomes `unknown` |

Messages the gate cannot read get an error with `id: null`: `unreadable` (**`-32700`**), `batch`, `not_an_object` or `noncanonical`.

## Shadow mode

`--mode shadow` is for rolling the gate out on an agent that already runs. Every call the gate can read is forwarded, and each ledger entry records the decision enforce mode would have made (`decision`, `reason`) with `mode: shadow` and `forwarded: true`. Read the ledger to see what enforce mode would have refused before you switch.

Shadow mode still refuses what it cannot read, and still refuses a call whose ledger entry cannot be written. Side-effect tracking stays on.

## Approval receipts

An approver signs a receipt for one exact call:

```bash
cloakpipe action fingerprint --manifest cloakpipe.manifest.yaml --tool issue_refund --args refund.json
cloakpipe approve --manifest cloakpipe.manifest.yaml --tool issue_refund --args refund.json \
  --task-context task-context.json --key approver.json --expires 15m --out approvals/
```

The **call fingerprint** is SHA-256 over the canonical JSON (RFC 8785) of the release, the tool and the arguments. `approve` writes `approvals/<fingerprint hex>.approval.json`: a DSSE envelope signed with Ed25519, holding an in-toto statement with predicate type `https://cloakpipe.co/attestations/approval/v1alpha1`, the fingerprint as its subject and `{release, tool, taskId, operationId, approver, approvedAt, notAfter}` as its predicate.

The gate looks the receipt up by the fingerprint it computes from the call it received, then checks the signature against `--approver-key`, the validity window (and that it is no longer than the tool's `ttl`), the release, the tool and the task's `taskId`. A receipt for a 350 refund cannot be replayed for 3,500: that is a different fingerprint, so no receipt is found.

There is no approval broker yet <span class="badge building">Roadmap</span>: the `approval_required` refusal carries `approvers` and `fingerprint` so that your own tooling can route the request, and the receipt has to be put in `--approvals` by hand or by that tooling.

## Side effects and reconciliation

A tool with `side_effect: true` (or `effect: write` / `irreversible`) runs as an **operation** tracked in `--operations-db`. Its id comes from the approval receipt's `operationId`, else from the tool's `idempotency_key` template, else from the task's `taskId` and the call fingerprint. All of these are keyed with a random key held in the operations database, and the model never supplies the id.

| Stored state | A retry of the same operation |
|---|---|
| none | recorded `in_flight` and forwarded |
| `done` | not forwarded: the stored result is replayed, marked `_meta.cloakpipe.replayed = true` |
| `in_flight` or `unknown` | refused: `reconcile_before_retry` (`-32002`) |
| `failed` or `not_applied` | forwarded again |
| any, with a different call | refused: `operation_conflict` |

A reply without `isError: true` settles the operation `done`; an error settles it `failed`. If the upstream exits with calls in flight, they become `unknown`, and waiting requests get `-32002` with reason `operation_unknown`. MCP has no standard way to ask a server whether a call took effect, so an operator settles it after checking the system of record:

```bash
cloakpipe operations list --state unknown --operations-db ops.db
cloakpipe operations reconcile op-3c6d… --outcome done --operations-db ops.db
```

`--outcome` is `done` or `not-applied`. Reconciling an `in_flight` operation needs `--force`, since a running gate may still receive its reply. Each reconciliation is a signed ledger entry in the default ledger (or `--ledger-db`). `operations reconcile --manifest` takes either format, a v1 manifest or a legacy `AgentRelease`, and binds the reconciliation entry to the manifest digest.

The operations database keeps each completed call's result for replay, so it is created owner-only (`0600`). Treat it like any store of tool output and set a retention policy for it.

## Fail-closed start-up

The gate refuses to start (non-zero exit) when:

- the manifest or its Cedar policy does not load (a bad pattern, template, condition or Cedar syntax error);
- a side-effecting tool has no `--operations-db`, or another gate holds that database;
- the ledger database or signing key cannot be opened;
- anchoring flags are given with `--no-ledger` or without `--manifest`;
- `--tool-contract` is given with a v1 manifest.

## MCP over HTTP

<span class="badge unreleased">Unreleased</span> Either side of the gate can speak MCP's Streamable HTTP transport (spec revision 2025-06-18) instead of stdio. Every `tools/call` gets the same decision, refusal and ledger entry as over stdio.

**Agents connect over HTTP** with `--listen`:

```bash
cloakpipe mcp-proxy --listen 127.0.0.1:8900 --listen-token-file listen.token \
  --manifest cloakpipe.manifest.yaml \
  --task-context task-context.json \
  --operations-db ops.db \
  --upstream "npx -y @acme/support-mcp"
```

The gate prints `cloakpipe: MCP over HTTP listening on http://127.0.0.1:8900/mcp` on stderr. Then:

- `POST /mcp` takes one JSON-RPC message. A request gets one `application/json` response; a notification gets `202`.
- `initialize` issues an `Mcp-Session-Id`, which every later request must carry: `400` without one, `404` for an unknown one. `DELETE /mcp` ends the session. All sessions share the upstream, and the gate forwards each request under an id of its own, so sessions never get each other's replies.
- `GET /mcp` is `405`: there is no server-to-client stream, so server notifications (progress, `tools/list_changed`) are not relayed to HTTP agents. SSE response streams and a `GET /mcp` stream are <span class="badge building">Roadmap</span>.
- `GET /health` answers `{"status":"ok","release":…,"release_digest":…}` and needs no token.
- A browser `Origin` header must be a loopback origin or the gate's own, which blocks DNS rebinding. With `--listen-token-file`, every `/mcp` request needs `Authorization: Bearer <token>`. The gate warns when it binds a non-loopback address; do that only with a token.
- Ctrl-C or SIGTERM stops it. Side-effecting calls still in flight are recorded as `unknown`, as over stdio.

**The server is an HTTP MCP server** with `--upstream-url`, instead of `--upstream`:

```bash
cloakpipe mcp-proxy --manifest cloakpipe.manifest.yaml \
  --upstream-url https://tools.example.com/mcp \
  --upstream-header "Authorization: env:TOOLS_AUTH"
```

The gate POSTs each message with the given headers (an `env:VAR` value is read at start-up), accepts a JSON or an SSE (`text/event-stream`) reply, and carries the server's `Mcp-Session-Id` and the negotiated protocol version. Transport errors fail closed: a connection error, an HTTP error status or a reply that never comes answers the agent with `upstream_unavailable` (JSON-RPC `-32003`), and a side-effecting call that was sent becomes `unknown` in the operations store and the ledger until it is reconciled.

`--listen` and `--upstream-url` combine. `--upstream-url` fronts one HTTP server and cannot be combined with `--server` or `--tools-lock`, which take stdio servers (exit 2). HTTP servers behind `--server` are <span class="badge building">Roadmap</span>.

## Several servers

<span class="badge unreleased">Unreleased</span> One gate can front several stdio MCP servers. Give each as `--server NAME=COMMAND`; `--upstream` is still accepted and is the server named `default`.

```bash
cloakpipe mcp-proxy --manifest cloakpipe.manifest.yaml \
  --server 'mail=npx -y @acme/mail-mcp' \
  --server 'files=npx -y @modelcontextprotocol/server-filesystem /srv/docs'
```

- **Start-up.** The gate initializes every server itself and lists its tools (every page). A server that does not start, or does not answer within 30 s, stops the gate.
- **`initialize` and `ping`** from the agent are answered by the gate.
- **`tools/list`** is one merged list of every server's tools, in server order.
- **`tools/call`** goes to the server that lists the tool, under a request id of the gate's own; the reply comes back under the agent's id. Every gate stage, the ledger and events work exactly as with one server.
- **Name collisions.** A tool name two servers list stops the gate at start-up, unless the manifest declares it per server as `<server>__<tool>` (for example `mail__search` and `files__search`). Server names use letters, digits, `-` and `_`, without `__`.
- **Other requests** (`resources/*`, `prompts/*`, …) go to the server named `default`, or to the only server; otherwise they are refused with JSON-RPC error `-32601`. Requests from a server (sampling, roots, elicitation) are refused with `-32601` too.
- **A server that exits** leaves the others serving. Requests waiting on it, and later calls to it, get `upstream_unavailable` (`-32003`); a side-effecting call it left in flight becomes `unknown`.

## Pinning tool definitions

<span class="badge unreleased">Unreleased</span> The model reads tool descriptions as instructions. A server that changes a description or a schema after you reviewed it changes what the agent does without any change to your manifest. A tools lock pins each definition as you reviewed it:

```bash
cloakpipe tools pin --manifest cloakpipe.manifest.yaml \
  --server 'mail=npx -y @acme/mail-mcp' --server 'files=npx -y @modelcontextprotocol/server-filesystem /srv/docs'
cloakpipe tools diff --lock cloakpipe.tools.lock \
  --server 'mail=npx -y @acme/mail-mcp' --server 'files=npx -y @modelcontextprotocol/server-filesystem /srv/docs'
cloakpipe mcp-proxy --manifest cloakpipe.manifest.yaml --tools-lock cloakpipe.tools.lock \
  --server 'mail=npx -y @acme/mail-mcp' --server 'files=npx -y @modelcontextprotocol/server-filesystem /srv/docs'
```

`cloakpipe tools pin` starts the servers, lists their tools and writes `cloakpipe.tools.lock` (`--out` to change it):

```json
{
  "schema": "cloakpipe.tools-lock/v1",
  "digest": "sha256:…",
  "servers": { "mail": { "send": "sha256:…", "search": "sha256:…" }, "files": { "read": "sha256:…" } }
}
```

- A tool's hash is SHA-256 over the RFC 8785 (JCS) canonical JSON of its `name`, `description`, `inputSchema` and `annotations`. Other members, such as `title`, are not pinned.
- `digest` covers the whole lock. A lock edited by hand does not match it, and `mcp-proxy` refuses to start on it (exit 2): pin again instead.
- `cloakpipe tools diff` prints each tool as `added`, `removed` or `changed` against the lock, comparing with what the servers list now or with another lock (`--against new.lock`). It exits 1 when anything changed and 0 when nothing did, so it can gate CI.

With `--tools-lock`, a tool whose definition does not match its pin, or that has no pin, is left out of the agent's `tools/list`, and every call to it is refused as `tool_drift` (`-32001`) and recorded in the ledger. Decision entries carry the lock digest. `--tools-lock` works with a single `--upstream` too, which the lock names `default`.

Without a lock, the first definition the gate sees for each tool in a session is its baseline. If the server later lists the tool differently, for example after `notifications/tools/list_changed`, the tool is hidden and refused as `tool_drift` until the gate restarts. Drift is refused in shadow mode too. Each drifted tool raises a `tool.drift` event; see [Alerts & events](/docs/events).

## Limits

- In v0.12.0, one upstream server per gate, over stdio: run one `mcp-proxy` per server. <span class="badge unreleased">Unreleased</span> adds HTTP and several stdio servers, as above.
- In v0.12.0, `tools/list` is passed through unchanged: tool descriptions are not pinned or diffed. <span class="badge unreleased">Unreleased</span> adds pinning and drift detection.
- The task context is a file read at start-up, so one gate process serves one task context. Restart the gate, or run one per task, when the task changes.

See the [threat model](/docs/threat-model) for what the gate cannot see.

## Source

The gate is in [`crates/cloakpipe-mcp`](https://github.com/rohansx/cloakpipe/tree/main/crates/cloakpipe-mcp) (`gate.rs`, `proxy.rs`, `operations.rs`), the manifest in `crates/cloakpipe-release` and the Cedar evaluation in `crates/cloakpipe-policy`.
