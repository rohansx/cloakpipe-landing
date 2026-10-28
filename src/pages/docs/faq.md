---
layout: ../../layouts/Docs.astro
title: FAQ & limitations
description: Common questions about the CloakPipe gate, and an honest list of what it does not do yet.
---

# FAQ & limitations

## Is CloakPipe open source?

Yes. Everything on these pages is in [rohansx/cloakpipe](https://github.com/rohansx/cloakpipe) under the MIT licence <span class="badge next">v0.12</span> (v0.11.0 had two crates under Apache-2.0). There is no paid edition of the gate, and no feature on these pages needs an account.

## Do I need an account or a service?

No. Hosted alerts and approvals (Slack and Discord cards, escalation, digests) are an idea we are testing and are not built. If you would use them, [tell us on the waitlist](/waitlist). The gate is self-hosted by design: it never needs to send arguments, credentials or results anywhere.

## Why not just tell the model the rules in the prompt?

Because a prompt is input to the same model an attacker is trying to steer. The manifest and policy are checked by code outside the model, on the call it actually proposed, against values (the task context) the model cannot write. A prompt injection can change what the model asks for; it cannot change what the gate allows.

## Does it slow tool calls down?

The contract and Cedar checks are fast: the test suite asserts p99 under 5ms on the example manifest, with 2ms as the target. Each decision also writes and signs a ledger entry in SQLite before the call is forwarded. Anchoring runs on a background thread, off the request path. Tool calls usually take far longer than either.

## What happens when the gate refuses a call?

The agent gets a JSON-RPC error (`-32001`) with a reason such as `scope_mismatch` or `undeclared_tool`, the tool never sees the call, and the refusal is a signed ledger entry. Most hosts pass the error back to the model as a failed tool call. See [MCP tool gate](/docs/mcp-gate#refusals).

## Can I try it without blocking anything?

Yes: `--mode shadow` forwards every call and records what enforce mode would have decided. See [shadow mode](/docs/mcp-gate#shadow-mode).

## Do I have to write Cedar?

No. A manifest without `policy:` is enforced on its own: closed tool and argument lists, value rules, `one_of_context`, side-effect tracking and conditional approval. Add a [Cedar policy](/docs/policy) when you need rate limits, time windows or rules over the task.

## Where did evaluation import and release sign-off go?

CloakPipe used to sign off agent releases from evaluation results. That is out of scope now: the product is the gate on tool calls. The old commands are behind a source-only cargo feature that published binaries do not include, and they will be removed. The old manifest format still works for one more release; see [the legacy format](/docs/manifest#the-legacy-format).

## What about PII?

The binary can pseudonymize personal data in allowed calls (`mcp-proxy --transform pii`) and in LLM traffic (`cloakpipe start`). It is optional and off by default; the gate never rewrites an allowed call unless you ask it to.

## Known limitations

- **One server per gate, stdio only.** HTTP/SSE MCP and several upstreams behind one gate are <span class="badge building">Roadmap</span>.
- **`tools/list` is not pinned.** A server that changes its tool descriptions is not detected. <span class="badge building">Roadmap</span>
- **Static task context.** `--task-context` is read once at start-up; run one gate per task when tasks change. A per-task channel from the orchestrator is <span class="badge building">Roadmap</span>.
- **No approval broker.** `approval_required` carries the approver routes and the call fingerprint, but nothing sends the request or delivers the receipt. <span class="badge building">Roadmap</span>
- **No alerts.** Webhooks, OpenTelemetry and hosted alerts are <span class="badge building">Roadmap</span>; the ledger and stderr are the record today.
- **The LLM proxy does not gate tool calls.** `cloakpipe start` transforms PII only. <span class="badge building">Roadmap</span>
- **Counters count calls, not amounts.** Money budgets are <span class="badge building">Roadmap</span>.
- **Keys are files.** KMS and HSM support and in-ledger key rotation are <span class="badge building">Roadmap</span>. See [Keys](/docs/keys).
- **Verifier gaps.** TSA revocation (CRL/OCSP) and Rekor log consistency are not checked. See [Evidence & verification](/docs/evidence#what-the-evidence-does-and-does-not-prove).

## Still stuck?

Email [rohan@cloakpipe.co](mailto:rohan@cloakpipe.co) or open an issue on [GitHub](https://github.com/rohansx/cloakpipe/issues).
