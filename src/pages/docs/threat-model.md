---
layout: ../../layouts/Docs.astro
title: Threat model
description: What the CloakPipe gate defends against, what it trusts, what it cannot see and what is out of scope, stated plainly so you can decide where it fits in your defences.
---

# Threat model

<span class="badge oss">v0.12</span> This page says what the gate is built to stop, which inputs it trusts, and where it stops helping. It describes `cloakpipe mcp-proxy` with a v1 manifest.

## The setting

An agent's model proposes tool calls. Those proposals can be wrong because the model erred, or because text the agent read (a ticket, a web page, a tool result, an email) steered it: prompt injection. The gate sits on the path from the agent to an MCP server and decides each call with rules that do not come from the model.

## What it defends against

**A model that proposes calls outside the contract**, whatever the reason:

- calling a tool the release never declared (`undeclared_tool`);
- sending arguments the tool does not list (`undeclared_argument`), or values outside their rules (`argument_invalid`);
- aiming a call at someone other than the current task's subject, such as an email to an address the ticket does not name (`scope_mismatch` through `one_of_context`);
- exceeding a rate or tier the policy sets (`policy_denied`);
- performing an action that needs a human without a valid approval, or reusing an approval for a different call (`approval_required`, `approval_invalid`): a receipt is bound to the fingerprint of one exact call;
- repeating a side effect whose first attempt has an unknown outcome (`reconcile_before_retry`), or reusing an operation id for a different call (`operation_conflict`).

**Malformed or ambiguous input** meant to slip past a checker that reads JSON differently from the tool server: unparseable lines, batches, out-of-range numbers, duplicate or case-variant keys. The gate refuses what it cannot read in full and forwards a re-serialized message, never the raw line.

**After-the-fact tampering with the record**: editing, deleting, reordering or back-dating ledger entries. The chain, per-entry signatures and anchoring epochs make this detectable by an auditor with the gate's public key, offline.

## What it trusts

- **The manifest and the policy file.** Whoever can edit them decides what is allowed. Review them like code; their digests are in every refusal and ledger entry.
- **The task context.** `one_of_context`, the Cedar `context.task` and approval receipts all rely on the task context the orchestrator writes. If the model, or text it read, can influence that file, the bindings mean nothing. Write it from your system of record, not from the conversation.
- **The approver keys** passed with `--approver-key`, and the people holding them.
- **The host the gate runs on**, its clock, the gate signing key and the databases under `$CLOAKPIPE_HOME`.
- **The roots and keys** used to check anchors (`--tsa-root`, `--rekor-key`, or the built-in defaults).
- <span class="badge oss">v0.13</span> **Whoever can reach an HTTP listener.** With `--listen`, anyone who can connect to the address, and holds the `--listen-token-file` token if there is one, can make calls as the agent. The gate checks the token in constant time and rejects a browser `Origin` that is not loopback or its own, but it serves plain HTTP: bind loopback, or put a TLS reverse proxy in front, and always use a token on any other address.
- <span class="badge oss">v0.13</span> **Webhook and OpenTelemetry receivers** see each event's tool, reason, contract path, release and fingerprint, never an argument value. Anyone who learns the webhook secret can forge alerts, not decisions.
- <span class="badge next">v0.14</span> **An approval broker** (`--approvals-url`, optional) is trusted to route requests and sign receipts with the approver keys it holds, so it can approve whatever those keys can: pin only the keys you mean to trust. It cannot widen the manifest or the policy, and it cannot make the gate write a receipt that does not verify: the poller checks each one against the pinned keys, the release, the tool, the task id, the fingerprint and the ttl, and only a 64-hex fingerprint becomes a file name. Its outage only delays approvals, which expire to deny, and a denial it reports refuses that one call (`approval_denied`) and cannot let anything through. Requests and polls are HMAC-signed with the gate's secret; responses are trusted only as far as the receipts in them verify. The broker sees the call fingerprint and only the values `approval.show` lists. A fingerprint over low-entropy arguments can be guessed by brute force, so treat it as revealing them, and use `show` sparingly. See [Approvals](/docs/approvals).

## What it cannot see

- **Calls that do not go through it.** The gate only sees what the host sends through `mcp-proxy`. A tool configured without the gate, a shell tool, a direct HTTP request or another MCP server bypasses it, and leaves no entry. Wrap every server the agent can reach, and remove the ones you cannot wrap.
- **What a tool does with an allowed call.** If `send_email` to the customer is allowed, the gate does not inspect the body for leaked data or check what the tool server actually does. Constrain arguments as tightly as the job allows (`enum`, `pattern`, `max_len`, `one_of_context`).
- **Tool results and descriptions.** Results come back unchanged, so a tool server that returns injected text is not detected. Up to v0.12.0, `tools/list` also passes through without pinning. <span class="badge oss">v0.13</span> With a tools lock, or within a session even without one, a tool whose description or schema changes is hidden and refused as `tool_drift`; a tool that was already malicious when you pinned it is not detected.
- **The model's intent.** The gate judges the call, not why it was made. A call that is within the contract but still wrong for the situation goes through. Approval exists for the cases where that matters.
- **Other transports.** Up to v0.12.0, only MCP over stdio is gated. <span class="badge oss">v0.13</span> MCP over Streamable HTTP is gated too. Tool calls inside LLM API responses are <span class="badge building">Roadmap</span>.

## Host compromise

An attacker with control of the gate's host can stop the gate, change its configuration, read the operations database (which keeps completed results for replay) and use the gate signing key. The evidence limits what such an attacker can hide:

- entries signed **before** the compromise cannot be changed without breaking the chain and signatures;
- entries already sealed in an **anchored epoch** cannot be replaced or back-dated without contradicting the TSA timestamp and the public Rekor entry;
- entries written **after** the compromise, or not yet anchored, can be forged with the stolen key. Anchor often (`--anchor-interval`) to shrink that window, and use `cloakpipe verify --require-anchors` when you need everything anchored.

Keeping the signing key in a KMS or HSM, so a host compromise does not reveal it, is <span class="badge building">Roadmap</span>. See [Keys](/docs/keys).

## Failure behaviour

The gate fails closed. A manifest or policy that does not load, a missing operations database, or a ledger or key that cannot be opened stops it from starting. During a run, an evaluation error, a store error or a ledger write that fails refuses the call as `fail_closed`. A crash leaves in-flight side effects `unknown`, and they cannot be retried until an operator reconciles them.

**Shadow mode is not protection.** `--mode shadow` forwards every call it can read and only records what enforce mode would have done. Use it to roll out a manifest, then switch to enforce.

## Out of scope

- Sandboxing tool servers or agent code: use OS or container isolation for that.
- Detecting prompt injection in text, or scanning content for secrets: the gate constrains actions instead. Content scanners can sit alongside it.
- Identity, authentication and credential management for tools.
- Availability: if the gate stops, the agent's tools stop with it. That is deliberate.
- Proving the operator ran the gate at all. The evidence shows what a gate holding a given key decided, not that every agent action passed through it.

## Reporting a vulnerability

See [SECURITY.md](https://github.com/rohansx/cloakpipe/blob/main/SECURITY.md) in the repository.
