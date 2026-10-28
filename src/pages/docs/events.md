---
layout: ../../layouts/Docs.astro
title: Alerts & events
description: Gate events for refusals, approvals, drift and unknown side effects, delivered as HMAC-signed webhooks (generic, Slack, Discord), OpenTelemetry spans and a JSONL log, off the decision path.
---

# Alerts & events

<span class="badge next">v0.13</span> After stopping an out-of-contract call, the gate's next job is telling a human. `cloakpipe mcp-proxy` raises a **gate event** for every decision that needs attention and delivers it three ways: HMAC-signed webhooks (raw JSON, or a Slack or Discord message), OpenTelemetry spans, and an append-only JSONL file. This is new in v0.13.0; v0.12.0 has the ledger and stderr only.

Delivery is off the decision path. Events go on a bounded queue that a background thread drains, so a slow or dead endpoint never delays a decision or changes it. Everything runs on your machines: the gate sends events only to the endpoints you give it.

## Event kinds

| kind | when |
|---|---|
| `decision.deny` | a call was refused in enforce mode, including `fail_closed` and an expired receipt (`approval_expired`) |
| `approval.requested` | a call needs an approval receipt and has none |
| `approval.mismatch` | a receipt was presented that does not cover this exact call (other arguments, release or tool, or a bad signature) |
| `shadow.finding` | shadow mode forwarded a call that enforce mode would have refused |
| `side_effect.replayed` | a retry of a completed side effect was answered from the operations store |
| `side_effect.unknown` | a forwarded side effect never got its reply: [reconcile it](/docs/mcp-gate#side-effects-and-reconciliation) |
| `tool.drift` | a tool's definition does not match its pin, or changed during the session (see [pinning](/docs/mcp-gate#pinning-tool-definitions)) |
| `anchor.failed` | anchoring a ledger epoch failed (`reason` is `rfc3161` or `rekor`) |

An allowed call raises no event, but it does get an OpenTelemetry span.

## What is in an event

Each event is one JSON object with `"schema": "cloakpipe.event/v1"`. The injected `send_email` from the [quick start](/docs/quickstart) raises this one. The attacker's address appears nowhere in it:

```json
{
  "schema": "cloakpipe.event/v1",
  "kind": "decision.deny",
  "fingerprint": "sha256:…",
  "ts": "2026-10-28T09:14:03Z",
  "release": "support-agent",
  "release_digest": "sha256:…",
  "policy_version": "sha256:…",
  "tool": "send_email",
  "server": null,
  "reason": "scope_mismatch",
  "path": "/to",
  "decision": "deny",
  "mode": "enforce",
  "operation_id": null,
  "ledger_seq": 2,
  "entry_hash": "sha256:…"
}
```

`policy_version` is the Cedar policy digest, `path` the contract path of an argument refusal, `server` the upstream server (for `tool.drift`), and `ledger_seq` and `entry_hash` name the decision ledger entry the event follows. An event never carries an argument value, a tool result or a credential.

**Fingerprint.** `fingerprint` is `sha256:` plus the hex SHA-256 of `kind|reason|tool|path|policy_version`, where an absent member counts as an empty string. For `tool.drift`, the tool part is `<server>/<tool>`. The same failure gets the same fingerprint on every run and every gate, so an alerting pipeline can group repeats into one issue; a policy change starts a new one.

## The flags

The flags need `--manifest`, since without the gate there are no events. They are checked at start-up: an unreadable secret, a URL that is not HTTP(S) or a log path that cannot be written stops the gate with exit code 2.

```bash
cloakpipe mcp-proxy \
  --manifest cloakpipe.manifest.yaml \
  --upstream "python3 server.py" \
  --events-log ~/.cloakpipe/events.jsonl \
  --webhook https://alerts.example.com/cloakpipe \
  --webhook-secret-file ~/.cloakpipe/webhook.secret \
  --otel-endpoint http://localhost:4318
```

| Flag | Meaning |
|---|---|
| `--events-log PATH` | append each event to `PATH` as one JSON line; an existing file is never truncated |
| `--webhook URL` | POST each event to `URL`; repeatable |
| `--webhook-secret-file FILE` | sign webhook requests with this secret (one trailing newline is ignored) |
| `--webhook-format generic\|slack\|discord` | the payload for every `--webhook` (default `generic`, the event JSON) |
| `--otel-endpoint URL` | an OTLP/HTTP collector; spans go to `URL/v1/traces` |
| `--otel` | use `OTEL_EXPORTER_OTLP_ENDPOINT` as the endpoint |

`OTEL_EXPORTER_OTLP_ENDPOINT` on its own exports nothing. Pass `--otel` to use it, so a variable set for some other program never starts sending the gate's decisions anywhere.

## Webhooks

Each webhook request is a `POST` with `Content-Type: application/json` and these headers:

- `CloakPipe-Event: <kind>`
- `CloakPipe-Fingerprint: <fingerprint>`
- `CloakPipe-Signature: t=<unix seconds>,v1=<hex>`, when a secret is set. Without one the request is unsigned, and the gate warns at start-up.

**Delivery.** Each `--webhook` has its own queue of 1024 events and its own thread. A full queue drops new events and counts them, with a warning on stderr. Each event gets three tries, 5 s timeout each, with a backoff of 0.5 s and then 1 s; a connection error, a timeout, `429` or `5xx` is retried, and each try is signed again with a fresh `t`. When the gate stops, it waits up to 5 s for queued events. The queue is in memory, so events queued when the process dies are lost; the signed [ledger](/docs/evidence) still has every decision.

### Verifying the signature

```text
v1 = hex( HMAC-SHA256( secret, "<t>" + "." + <raw request body> ) )
```

A receiver should:

1. Split the header on `,` and read `t` and every `v1`.
2. Compute `v1` over the **raw** body bytes. Re-serialized JSON will not match.
3. Compare it in constant time with each `v1` in the header. Any match is enough, which lets you rotate secrets.
4. Reject a `t` more than about five minutes from its own clock, so an old request cannot be replayed.

`cloakpipe events verify-signature` does exactly this, so you can test your receiver's code against it. Here `openssl` computes a signature and the gate checks it:

```bash
printf 'whsec-example-secret' > webhook.secret
printf '{"kind":"decision.deny","reason":"scope_mismatch"}' > body.json
t=$(date +%s)
v1=$(printf '%s.%s' "$t" "$(cat body.json)" | openssl dgst -sha256 -hmac "$(cat webhook.secret)" | sed 's/^.* //')
cloakpipe events verify-signature --secret-file webhook.secret --header "t=$t,v1=$v1" --body-file body.json
# signature ok
```

A changed body or another secret exits 1 with `signature does not match the body`. So does a `t` more than `--tolerance` seconds away (default 300; `--tolerance 0` turns the age check off).

### Slack

1. In Slack, create an app with **Incoming Webhooks** turned on, add a webhook to the channel you want, and copy its URL.
2. Send a sample event to check the wiring:

   ```bash
   cloakpipe events test --webhook "$SLACK_WEBHOOK_URL" --webhook-format slack
   ```

3. Run the gate with the same webhook:

   ```bash
   cloakpipe mcp-proxy --manifest cloakpipe.manifest.yaml --upstream "python3 server.py" \
     --webhook "$SLACK_WEBHOOK_URL" --webhook-format slack
   ```

Each event becomes a Block Kit message. Its header names the kind and the tool, such as "Tool call denied: send_email". Fields follow for the reason, the tool, the contract path, the release and the mode, plus the ledger seq and the operation when there is one. A context line shows the kind and the fingerprint. Slack ignores the signature header, so a secret is optional here.

### Discord

Create a webhook in the channel's **Integrations** settings, then run with `--webhook "$DISCORD_WEBHOOK_URL" --webhook-format discord`. Each event becomes one embed with the same fields, coloured red for a refusal, amber for something that needs a human and blue for a replay. The fingerprint goes in the embed's footer.

`cloakpipe events test` sends a sample `decision.deny` in any of the three formats, and exits 0 on a 2xx answer and 1 otherwise.

## OpenTelemetry

`--otel-endpoint http://collector:4318` exports one span named `cloakpipe.decision` for every tool-call decision, allows included, as OTLP/HTTP JSON, in batches from a background thread. The resource's `service.name` is `cloakpipe-gate`.

| Attribute | Value |
|---|---|
| `cloakpipe.decision` | `allow`, `deny` or `require_approval` |
| `cloakpipe.reason` | the reason code (`ok` for an allow) |
| `cloakpipe.tool`, `cloakpipe.path` | the tool, and the contract path of an argument refusal |
| `cloakpipe.release`, `cloakpipe.manifest_digest`, `cloakpipe.policy_digest` | the release, its manifest digest and its Cedar policy digest |
| `cloakpipe.mode`, `cloakpipe.forwarded` | `enforce` or `shadow`, and whether the call reached the tool |
| `cloakpipe.operation_id` | the side-effect operation, if any |
| `cloakpipe.ledger.seq`, `cloakpipe.ledger.entry_hash` | the decision's ledger entry |
| `cloakpipe.event`, `cloakpipe.fingerprint` | the event the decision raised, if any |

A refused call is an error span. Spans carry no argument values, and a span's duration is the time the gate took to decide, ledger write included.

## In Docker

The [Docker image](/docs/docker) takes the same settings as variables: `CLOAKPIPE_WEBHOOK_URL`, `CLOAKPIPE_WEBHOOK_SECRET_FILE`, `CLOAKPIPE_WEBHOOK_FORMAT`, `CLOAKPIPE_OTEL_ENDPOINT` and `CLOAKPIPE_EVENTS_LOG`.

## Not built

- <span class="badge building">Roadmap</span> A different secret and format for each webhook. Today one `--webhook-secret-file` and one `--webhook-format` apply to every `--webhook`.
- <span class="badge building">Roadmap</span> Delivery that survives a restart.
- <span class="badge building">Roadmap</span> A hosted plane on top of these events: grouping repeats into issues, routing by tool, approval cards, escalation and digests. It is not built, and nothing is sent to a hosted service; if you want it, [tell us on the waitlist](/waitlist).
