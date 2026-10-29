---
layout: ../../layouts/Docs.astro
title: Approvals
description: Route a call that needs approval to a human through an approval broker, with approval.show, the gate's broker flags, cloakpipe approvals keys and the open, signed broker protocol.
---

# Approvals

<span class="badge next">v0.14</span> A call the manifest holds for approval is refused as `approval_required` until a signed receipt for that exact call is in the gate's approvals directory. You can sign receipts by hand with `cloakpipe approve`, or point the gate at an **approval broker**: a service that routes the request to a person and hands back the receipt they sign. The gate files the request in the background, polls for finished ones, and verifies every receipt against the approver keys you pinned before it writes it. The protocol is open: two signed HTTP calls that any service can implement.

| Capability | Status |
|---|---|
| Signed approval receipts for one exact call, made by hand with `cloakpipe approve` | <span class="badge oss">v0.11</span> |
| Conditional approval (`approval.when`, `approvers`, `ttl`) and Cedar `@approval` | <span class="badge oss">v0.12</span> |
| The `approval.requested` event, to your webhook ([Alerts & events](/docs/events)) | <span class="badge oss">v0.13</span> |
| Approvals through a broker: `approval.show`, `--approvals-url`, `cloakpipe approvals keys`, `approval_denied` | <span class="badge next">v0.14</span> |
| CloakPipe Cloud as a broker, with approval cards in Slack | <span class="badge building">Roadmap</span> coming soon, not deployed yet |
| Approve with an edit (an approver changing an argument) | <span class="badge building">Roadmap</span> |

## How it works

```
 agent ──tools/call──> gate ──refused: approval_required──> agent (retries later)
                        │  └─ POST /approvals (background, signed) ──> broker ──> a person
                        │                                                     │ approves: the broker signs a receipt
                        └── poller: GET /approvals?since= (signed) <──────────┘
                              verify locally ──> approvals/<fingerprint hex>.approval.json
 agent ──same tools/call──> gate finds the receipt, verifies it again ──> tool
```

- **The decision path never waits on the network.** Filing a request is queued and sent in the background, once per fingerprint while it is open; the poller runs on its own thread. The agent retries, and the gate finds the receipt on disk exactly as it would one made by `cloakpipe approve`.
- **Every receipt is verified twice**: by the poller before it is written (signature by a pinned approver key, release, tool, task id, fingerprint, `approval.ttl`), and by the gate again on the call. A receipt that does not verify is never written; it is logged and raises an `approval.mismatch` event.
- **If the broker is down**, approvals simply do not arrive. A call that needs one stays refused, so it expires to deny.

The broker holds the approver keys, so it can approve whatever the manifest and the Cedar policy already allow. It can never widen them, every receipt names its approver, and a broker you stop trusting is revoked by removing its keys from `--approver-key`. See [Keys](/docs/keys#approver-keys-held-by-a-broker) and the [threat model](/docs/threat-model).

<span class="badge building">Roadmap</span> CloakPipe Cloud is a broker that implements this protocol, with approval cards in Slack: coming soon, not deployed yet. Until then, run your own broker or approve by hand; if you want the hosted one, [tell us on the waitlist](/waitlist).

## `approval.show`

A request carries no argument value unless the manifest lists it under `approval.show`, so the approver can see what they are deciding:

```yaml
tools:
  issue_refund:
    args:
      ticket_id: { type: string, one_of_context: ["ticket.id"], required: true }
      amount: { type: integer, min: 0, max: 500, required: true }
    side_effect: true
    approval:
      when: "amount > 100"
      approvers: ["slack:#support-leads"]
      ttl: 15m
      show: [amount]   # the approver sees the amount; ticket_id never leaves the host
```

`show` lists top-level arguments the tool declares under `args`. The default is none, and no other value is ever sent. Only scalar values are shown (string, number, boolean, null): an argument declared `type: object` or `type: array` cannot be listed and the manifest is refused, and an object or array value of an untyped argument is left out of the request. See [Manifest reference](/docs/manifest#approval).

### Keep it short

A request also carries the call **fingerprint**: SHA-256 over the manifest digest, the tool and every argument. A broker that can guess the other arguments' likely values can test guesses against it by brute force, so treat a fingerprint as revealing, at most, the low-entropy arguments of a call (an amount, a ticket id, a yes/no flag), and `show` as revealing what it lists. Use `show` sparingly: list what a person needs to decide, nothing more.

"Approve with an edit" is not possible: the broker never sees the arguments it would have to fingerprint.

## Running the gate with a broker

```bash
cloakpipe approvals keys --approvals-url https://broker.example/v1/gates/$GATE_ID \
  --approvals-secret-file gate.secret --out approver-keys
cloakpipe mcp-proxy --upstream "python3 mock_upstream.py" --manifest cloakpipe.manifest.yaml \
  --task-context task-context.json \
  --approvals approvals --approver-key approver-keys/9dbc2c0b722f399a.approver.json \
  --approvals-url https://broker.example/v1/gates/$GATE_ID --approvals-secret-file gate.secret \
  --approvals-poll-interval 5s
```

| Flag | Meaning |
|---|---|
| `--approvals DIR` | the approvals directory. Verified receipts from the broker are written here, as `<fingerprint hex>.approval.json`, next to any you make by hand. |
| `--approver-key FILE` | a pinned approver public key (repeatable). A receipt must be signed by one of these keys, whoever delivered it. |
| `--approvals-url URL` | the gate's base URL at the broker, such as `https://broker.example/v1/gates/<gate id>`. Needs `--approvals`, at least one `--approver-key`, `--approvals-secret-file`, and a task context with a `taskId` (every receipt is signed for it); the gate checks this at start-up and refuses to start without them. |
| `--approvals-secret-file FILE` | the HMAC secret both directions are signed with. The webhook secret file (`--webhook-secret-file`, [Alerts & events](/docs/events)) may be reused. |
| `--approvals-poll-interval DURATION` | how often finished requests are fetched: `5s` (default), `1m`, … |
| `--task-context FILE` | the trusted task context. Its `taskId` goes into each request and must match each receipt. |

### `cloakpipe approvals keys`

`cloakpipe approvals keys` fetches the broker's approver public keys (`GET <url>/approver-keys`) and writes each one into `--out` as `<keyid hex>.approver.json`, the format `--approver-key` reads. It refuses any key whose `keyid` is not its own (`ed25519:` and the first 16 hex characters of SHA-256 over the key), and then writes nothing. Review the keys before you pin them: whoever holds a pinned key can approve any call the manifest and the policy allow. When the broker rotates a key, pin the new one; keep the old one until its receipts have expired.

### What the agent sees

The refusal tells the agent what is going on (a real one, abridged):

```json
{"jsonrpc":"2.0","id":2,"error":{"code":-32001,"message":"tool call refused by CloakPipe: approval_required","data":{"reason":"approval_required","tool":"issue_refund","release":"sha256:7d60…","approvers":["slack:#support-leads"],"fingerprint":"sha256:d6a9…","approval_request":"requested","hint":"approval requested; retry the same call after approval"}}}
```

`data.approval_request` is `requested` (filed now, or being filed), `pending` (the broker has it and nobody has decided yet) or `denied`. The reason stays `approval_required` until an approver denies the call. The `approval.requested` event still goes to your webhooks as before.

## Denied and expired

| The broker reports | The gate |
|---|---|
| `approved` | verifies the receipt and writes `<fingerprint hex>.approval.json` atomically; the agent's retry is forwarded |
| `denied` | refuses that exact call as `approval_denied`, with the hint "an approver denied this exact call; it will not be approved", until the denial's `not_after` (else the request's ttl). It keeps the denial in memory and as a marker, `<fingerprint hex>.denied.json`, which it honours after a restart. No new request is filed meanwhile. A call with any other arguments is another call. |
| `expired` (nobody decided in time) | nothing is written; the call stays `approval_required`, and the next retry files a new request |

`approval_expired` keeps its meaning: a receipt past its `notAfter`. A denial is a `decision.deny` event with reason `approval_denied`.

## The broker protocol (v1)

Everything is JSON over HTTPS, under the gate's base URL `<url>`, such as `https://broker.example/v1/gates/<gate id>`. Anyone can implement a broker.

**Signing.** Every request carries the header

```
CloakPipe-Signature: t=<unix seconds>,v1=<hex>
```

where `<hex>` is HMAC-SHA256 under the shared secret of `"<t>." + body` for a `POST`, and of `"<t>." + "GET <target>"` for a `GET`. The signed string for a `GET` is `GET <target>`, where `<target>` is the path and query exactly as sent, such as `GET /v1/gates/g1/approvals?since=c-42` (no `?` when there is no query). This is how gate webhooks are signed ([Alerts & events](/docs/events)). A broker should reject a `t` more than five minutes from its clock.

### `POST <url>/approvals`: file a request

```json
{
  "schema": "cloakpipe.approval-request/v1",
  "fingerprint": "sha256:d6a9…",
  "release": "support-agent",
  "version": "2026.10.3",
  "release_digest": "sha256:7d60…",
  "tool": "issue_refund",
  "approvers": ["slack:#support-leads"],
  "task_id": "t-1042",
  "ttl_secs": 900,
  "requested_at": "2026-10-29T10:00:00Z",
  "expires_at": "2026-10-29T10:15:00Z",
  "ledger_seq": 12,
  "shown": { "amount": 350 }
}
```

`ttl_secs` is the tool's `approval.ttl` (900 when it sets none), and `expires_at` is when the request lapses. `ledger_seq` names the decision ledger entry of the refusal (null without a ledger). A broker must store no argument value other than those in `shown`, and should be idempotent per `fingerprint` and `task_id`: filing an open request again returns it. Several gate processes, each with its own task context, may share one gate URL, so the same call from another task is a request of its own. Reply with any 2xx, such as `{"request_id": "…", "status": "pending"}`. The gate retries a 429, a 5xx or a connection error, and files the request again on the agent's next retry if every try failed.

### `GET <url>/approvals?since=<cursor>`: poll for finished requests

```json
{
  "cursor": "c-43",
  "approvals": [
    { "request_id": "…", "fingerprint": "sha256:d6a9…", "task_id": "t-1042", "status": "approved", "envelope": { "payloadType": "application/vnd.in-toto+json", "payload": "…", "signatures": [] } },
    { "request_id": "…", "fingerprint": "sha256:8b70…", "status": "denied", "decided_at": "2026-10-29T10:03:00Z", "not_after": "2026-10-29T10:15:00Z" },
    { "request_id": "…", "fingerprint": "sha256:77d0…", "status": "expired" }
  ]
}
```

The poll records are the requests that finished after `cursor`, in order, and the `cursor` to ask from next, which is opaque to the gate. The first poll has no `since`; the broker may then return whatever it still holds, and the gate skips what it already has. `not_after` on a denial is optional. `task_id` is optional too: a gate quietly skips records for another task, which belong to another process sharing the gate URL.

**The receipt** (`envelope`) is a DSSE envelope, the same as `cloakpipe approve` makes ([MCP tool gate](/docs/mcp-gate#approval-receipts)): its subject digest is the request's fingerprint; the predicate's `release` is `release_digest`, `tool` and `taskId` are the request's, `operationId` is any valid operation id (a fresh UUID v4 is fine), `approver` is the signing key's keyid, and `notAfter - approvedAt` is at most `ttl_secs`. Sign for each approver with a key of their own.

### `GET <url>/approver-keys`: the approver public keys

```json
{ "keys": [ { "keyid": "ed25519:9dbc2c0b722f399a", "publicKey": "<64 hex chars>" } ] }
```

This is what `cloakpipe approvals keys` reads. List a rotated-out key until its receipts have expired.

Nothing the broker sends reaches the approvals directory unless it verifies, and only a 64-hex fingerprint ever becomes a file name. Beyond what its keys can sign, a broker can only withhold approvals or report denials, and both refuse.

## Without a broker

Everything still works offline, with no network and no broker: an approver signs the receipt by hand and puts it in the approvals directory.

```bash
cloakpipe action fingerprint --manifest cloakpipe.manifest.yaml --tool issue_refund --args refund.json
cloakpipe approve --manifest cloakpipe.manifest.yaml --tool issue_refund --args refund.json \
  --task-context task-context.json --key approver.json --expires 15m --out approvals/
```

The gate picks it up on the agent's next retry.

A denial marker, `<fingerprint hex>.denied.json`, is honoured with or without a broker. This is the one the gate wrote for a denied call; one you write by hand is honoured if its `fingerprint` is the call's, its `status` is `denied` and its `notAfter` is still ahead:

```json
{
  "schema": "cloakpipe.approval-denial/v1",
  "fingerprint": "sha256:8b704be6f47ed616f8b6930d8fe2ce9684a268405ae34234161064da00de9f9a",
  "status": "denied",
  "decidedAt": "2026-10-29T10:03:00Z",
  "notAfter": "2026-10-29T10:18:00Z"
}
```

The [quick start](/docs/quickstart) walks through approving a refund by hand, and [MCP tool gate](/docs/mcp-gate#approval-receipts) describes the receipt.
