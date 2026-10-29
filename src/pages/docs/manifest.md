---
layout: ../../layouts/Docs.astro
title: Manifest reference
description: The cloakpipe.manifest.yaml format, key by key - tools, argument rules, one_of_context, side effects, idempotency keys, conditional approval, the Cedar policy reference and the manifest digest.
---

# Manifest reference

<span class="badge oss">v0.12</span> One file, `cloakpipe.manifest.yaml`, declares everything an agent release may do at its tools. The gate is **closed by default**: a tool the manifest does not list cannot be called, and an argument a tool does not list cannot be sent.

```yaml
release: support-agent
version: 2026.10.3
policy: ./policies/support.cedar      # optional
tools:
  read_ticket:
    args:
      ticket_id: { type: string, pattern: "^T-[0-9]{4,}$", one_of_context: ["ticket.id"], required: true }
  send_email:
    args:
      ticket_id: { type: string, one_of_context: ["ticket.id"], required: true }
      to:   { type: string, one_of_context: ["ticket.customer_email"], or_pattern: "@ourcompany\\.com$", required: true }
      body: { type: string, max_len: 4000, required: true }
    side_effect: true
    idempotency_key: "{ticket_id}:{sha256(body)}"
  issue_refund:
    args:
      ticket_id: { type: string, one_of_context: ["ticket.id"], required: true }
      amount: { type: integer, min: 0, max: 500, required: true }
    side_effect: true
    approval:
      when: "amount > 100"
      approvers: ["slack:#support-leads"]
      ttl: 15m
```

The file is YAML (JSON also works). Unknown keys and duplicate keys are errors. Every rule is checked when the gate starts, so a bad pattern, template or condition stops the gate instead of misbehaving on a live call. A JSON Schema for editors is in the repository at [`schemas/cloakpipe.manifest.schema.json`](https://github.com/rohansx/cloakpipe/tree/main/schemas).

## Top level

| Key | Required | Meaning |
|---|---|---|
| `release:` | yes | the release name. It is the Cedar principal (`Release::"support-agent"`) and keys the policy counters, so a new version does not reset them. |
| `version:` | yes | your version label, such as `2026.10.3`. |
| `policy:` | no | path to a Cedar policy file, relative to the manifest. See [Policy](/docs/policy). Without it the gate checks the contract only. |
| `tools:` | no | a map from tool name (as in `tools/call`) to its rules. A manifest with no tools allows no calls. |

## Tools

| Key | Meaning |
|---|---|
| `args:` | a map from argument name to its rules. Without `args`, the tool takes no arguments. An argument not listed is refused as `undeclared_argument`, without echoing its name. |
| `side_effect:` | `true` when a call changes something outside the agent (sends, writes, pays). The gate then tracks each call as an operation, so a retry is never run twice silently. Needs `--operations-db`. |
| `effect:` | `read`, `write` or `irreversible`, instead of or alongside `side_effect` (`side_effect: true` means `write`; the two must agree). `write` and `irreversible` are side effects. |
| `idempotency_key:` | a template that names the operation, so retries of "the same email" are recognized. Side-effecting tools only. |
| `approval:` | when a call needs a signed approval receipt. |

### Argument rules

Each argument is optional unless it has `required: true`; a missing required argument is `argument_missing`. A rule must restrict the value somehow (at least a `type`).

| Key | Applies to | Meaning |
|---|---|---|
| `type:` | any | `string`, `number`, `integer`, `boolean`, `object` or `array` |
| `required: true` | any | the call must carry it |
| `enum:` | any | the value must equal one of these |
| `const:` | any | the value must equal this |
| `pattern:` | string | a regular expression the **whole** value must match (it is anchored for you) |
| `min_len:` / `max_len:` | string, array | length in characters, or number of items |
| `min:` / `max:` | number, integer | inclusive bounds |
| `items:` | array | the rules for every item |
| `properties:` | object | the rules for each member; members not listed are refused, and `required: true` works inside too |
| `one_of_context:` | any | a list of dotted paths into the task context (`ticket.customer_email`; a `task.` prefix is accepted). The value must equal one of the values found there; a context value that is an array matches any of its items. |
| `or_pattern:` | string, with `one_of_context` | a regular expression (unanchored: it may match anywhere) that also lets the value through when no context value matches. |

A value that breaks a rule is `argument_invalid`; the refusal names the path (`/patch/stage`) and never the value. For `one_of_context`, no match is `scope_mismatch`, and a path missing from the task context (with no `or_pattern` match) is `task_context_missing`.

### The task context

`one_of_context` is how a manifest ties a call to the job the agent was given. The task context is a JSON object your orchestrator writes for the current task, passed with `--task-context` (or `CLOAKPIPE_TASK_CONTEXT`). The model never writes it:

```json
{ "taskId": "t-1042", "ticket": { "id": "T-1042", "customer_email": "dana@customer.example" } }
```

`taskId` is also what approval receipts and derived operation ids are bound to.

### idempotency_key

Literal text with `{...}` placeholders:

| Placeholder | Renders as |
|---|---|
| `{ticket_id}`, `{patch.stage}` | the argument at that dotted path: a string as itself, any other value as canonical JSON |
| `{task.taskId}` | a value from the task context |
| `{sha256(body)}` | the lowercase hex SHA-256 of the value |

Every argument a template uses must be declared under `args`. The operation id is `op-` and 32 hex digits of an HMAC, keyed by a random key kept in the operations database, over the release name, the tool and the rendered key. So `"{ticket_id}:{sha256(body)}"` makes a retry of the same email for the same ticket the same operation: it is answered from the store, never sent twice, and the same key with different arguments is refused as `operation_conflict`. Without a template, the id is derived from the task's `taskId` and the call fingerprint.

### approval

```yaml
approval:
  when: "amount > 100 && currency == 'EUR'"
  approvers: ["slack:#support-leads", "pagerduty:refunds"]
  ttl: 15m
  show: [amount]   # v0.14: the only value an approval broker may see
```

- **`when`**: a condition over the call's arguments. Comparisons `path OP literal`, with `OP` one of `>` `>=` `<` `<=` `==` `!=` and a literal that is a number, a quoted string or `true`/`false`, joined by `&&` and `||` (`&&` binds tighter) with parentheses. `path` is a dotted path into the arguments, and each one must be a declared argument (here, `amount` and `currency`); ordering operators take numbers only. Without `when`, every call needs approval. Evaluation fails closed: if a comparison meets a missing value or a value of another type, the condition holds and approval is required.
- **`approvers`**: free-form routing strings. The gate does not contact anyone itself; it returns them in the `approval_required` refusal, with the call fingerprint, and puts them in the request it files with an approval broker, if you run one, for routing.
- **`ttl`**: the longest validity a receipt may have, such as `15m` or `1h30m` (units `d`, `h`, `m`, `s`). A receipt whose `notAfter` minus `approvedAt` is longer is refused as `approval_invalid`.
- **`show`** <span class="badge next">v0.14</span>: the top-level arguments (declared under `args`) whose values an approval broker may see in a request, so the approver can decide: `[amount, ticket_id]`. Scalar values only: an argument declared `type: object` or `type: array` makes the manifest invalid, and an object or array value of an untyped argument is left out. The default is none, and no other value is ever sent. Keep it short: the request also carries the call fingerprint, and a fingerprint over low-entropy arguments can be brute-forced by anyone who can guess the other arguments. See [Approvals](/docs/approvals#approvalshow).

Receipts are signed with `cloakpipe approve` by a key the gate trusts through `--approver-key`, or <span class="badge next">v0.14</span> fetched from an approval broker and verified against those keys ([Approvals](/docs/approvals)). See [MCP tool gate](/docs/mcp-gate#approval-receipts). A call that needs approval is refused with one of these reasons:

| `reason` | Why |
|---|---|
| `approval_required` | no receipt for this exact call |
| `approval_invalid` | a receipt that fails a check: signature, approver, release, tool, task, call or `ttl` |
| `approval_expired` | a receipt past its `notAfter` |
| `approval_denied` | <span class="badge next">v0.14</span> an approver denied this exact call through an approval broker, and the denial still holds |

## Check and hash a manifest

```bash
cloakpipe manifest validate cloakpipe.manifest.yaml
cloakpipe manifest hash cloakpipe.manifest.yaml --json
```

```json
{
  "release": "support-agent",
  "version": "2026.10.3",
  "manifest_digest": "sha256:c55889deb72d677a13ef2962ba7d6ae97d7a13391c9e484484fde9bb084fb0fa",
  "policy_digest": "sha256:fef22029e4619812be1ee292c7aa4b83a1acf754d21b5f59d19658d8fcb1ba3b"
}
```

The **manifest digest** is `sha256:` over the canonical JSON (RFC 8785) of the parsed manifest, so comments, formatting and key order do not change it. The **policy digest** is the SHA-256 of the policy file's bytes. Every refusal carries the manifest digest as `release`, and every ledger entry records both, so an auditor can tell which rules decided each call.

`validate` also parses the Cedar policy and reports a syntax error with its line. Run it in CI.

## The legacy format

v0.11 configured the gate with two files: an `AgentRelease` (`apiVersion: cloakpipe.co/v1alpha1`, `kind: AgentRelease`) and a `ToolContract` passed with `--tool-contract`. v0.12 and v0.13 still read them, with a deprecation warning on stderr, and tells the formats apart by the top-level key (`release` or `apiVersion`). The legacy names map as: `arguments` → `args`, `maxLength` → `max_len`, `minimum`/`maximum` → `min`/`max`, `bindTo: task.x` → `one_of_context: ["x"]`, `sideEffect` → `side_effect`, `requiresApproval: true` → `approval: {}`. The legacy denial `argument_not_allowed` is now `undeclared_argument` in both formats.
