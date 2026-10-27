---
layout: ../../layouts/Docs.astro
title: Policy (Cedar)
description: Cedar policies in the tool gate - the principal, action, resource and context of each call, persistent rate counters, time, @approval, @id and how a policy decision combines with the manifest.
---

# Policy (Cedar)

<span class="badge next">v0.12</span> The manifest says what a single call may look like. A [Cedar](https://www.cedarpolicy.com) policy adds rules that need more than one call or more than the call itself: rate limits, tiers, time windows, and rules over the task. The gate evaluates it with the official `cedar-policy` crate (4.x) for every call that passed the manifest's contract.

Reference the policy file from the manifest:

```yaml
release: support-agent
version: 2026.10.3
policy: ./policies/support.cedar
```

The policy is parsed when the gate starts. A policy that does not parse stops the gate, and `cloakpipe manifest validate` reports the error with its line. Without `policy:`, the gate checks the contract only.

## Default deny

A call is allowed only when at least one `permit` holds for it, and any `forbid` that holds wins. So once a manifest has a policy, every tool needs a permit:

```cedar
@id("read-ticket")
permit (principal == Release::"support-agent", action == Action::"read_ticket", resource);

@id("send-email")
permit (principal == Release::"support-agent", action == Action::"send_email", resource);

// At most 50 emails an hour, across restarts: the counters are persistent.
@id("email-rate-limit")
forbid (principal, action == Action::"send_email", resource)
when { context.counters.send_email_1h >= 50 };

// Refunds up to 100 go through.
@id("refund-small")
permit (principal == Release::"support-agent", action == Action::"issue_refund", resource)
when { resource.args.amount <= 100 };

// Refunds over 100 and up to 500 need a signed approval receipt.
@id("refund-large")
@approval("slack:#support-leads")
permit (principal == Release::"support-agent", action == Action::"issue_refund", resource)
when { resource.args.amount > 100 && resource.args.amount <= 500 };
```

A refusal is `policy_denied`, and `data.policies` lists the forbids that decided it by their `@id` (Cedar's positional `policy0`, `policy1`, … for a policy without one). The same ids go into the ledger entry.

## What a policy sees

| Cedar | Value |
|---|---|
| `principal` | `Release::"<release>"`, the manifest's `release` name |
| `action` | `Action::"<tool>"`, the tool name. `Tool::"<tool>"` is accepted too and means the same. |
| `resource` | `Call::"<fingerprint>"`, with the call's arguments in `resource.args` |
| `context.task` | the trusted task context from `--task-context` |
| `context.counters.<tool>_1h`, `context.counters.<tool>_24h` | how many calls to that tool the gate forwarded for this release in the last hour and day, for every tool the manifest declares |
| `context.time.unix` | the call's time, Unix seconds |
| `context.time.hour_utc` | 0 to 23 |
| `context.time.weekday` | ISO weekday, 1 = Monday to 7 = Sunday |

Arguments and the task context map from JSON as: string to String, boolean to Bool, a whole number to Long, any other number to `decimal` (at most four fractional digits), array to Set and object to Record. `null` members are left out. Values are built directly, never through Cedar's JSON entity format, so an argument cannot smuggle in an entity reference or extension value. Declare money as an integer in whole units (`type: integer`) if a policy compares it, since Cedar compares Longs.

## Persistent counters

The counters live in a SQLite state database: `--state-db`, else `CLOAKPIPE_STATE_DB`, else `$CLOAKPIPE_HOME/state.db`. Each forwarded call adds a row (release name, tool, time), and rows older than a day are pruned. Because they are stored, restarting the gate does not reset a rate limit, and because they are keyed by the release name rather than the manifest digest, publishing a new version does not reset them either.

Only calls the gate forwards are counted. A refused call, or a retry answered from the operations store, is not.

## @approval

When every permit that holds for a call carries `@approval("<route>")`, the call needs a signed approval receipt, exactly as if the manifest's `approval.when` held. Either one is enough to require approval, and their routes are merged into the `approvers` of the `approval_required` refusal. If some permit without `@approval` also holds, no approval is needed.

In the example, a 350 refund matches only `refund-large`, so it needs a receipt; a 40 refund matches `refund-small` and goes through.

## Decision order

1. The manifest contract: undeclared tools and arguments, argument rules, `one_of_context`.
2. Cedar: `policy_denied` if no permit holds or a forbid does.
3. Approval: from the manifest's `approval` or `@approval`.
4. Side-effect state, then the ledger entry, then the call is forwarded.

The first refusal wins. Any error while evaluating the policy (comparing a string with a number, say, or the state database failing) refuses the call as `fail_closed`.

## Examples

No refunds at weekends:

```cedar
@id("no-weekend-refunds")
forbid (principal, action == Action::"issue_refund", resource)
when { context.time.weekday >= 6 };
```

Only during business hours (UTC):

```cedar
@id("business-hours-email")
forbid (principal, action == Action::"send_email", resource)
when { context.time.hour_utc < 8 || context.time.hour_utc >= 18 };
```

A daily refund budget by count:

```cedar
@id("refund-daily-cap")
forbid (principal, action == Action::"issue_refund", resource)
when { context.counters.issue_refund_24h >= 20 };
```

A rule over the task: refunds only for tickets marked refundable by the orchestrator:

```cedar
@id("refund-needs-flag")
forbid (principal, action == Action::"issue_refund", resource)
unless { context.task has refundable && context.task.refundable == true };
```

## Limits

- Counters count calls, not amounts. A budget in money (sum of refunds per day) is <span class="badge building">Roadmap</span>.
- There is no Cedar schema validation yet: a typo in an attribute name is found when a call evaluates it, and that call is refused as `fail_closed`.
- One policy file per manifest.
