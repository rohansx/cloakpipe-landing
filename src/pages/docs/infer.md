---
layout: ../../layouts/Docs.astro
title: Drafting a contract
description: Draft a cloakpipe.manifest.yaml from the tool calls your agent really makes, captured in shadow mode, with cloakpipe infer, and check new traffic for drift in CI with infer --diff.
---

# Drafting a contract

<span class="badge next">v0.15</span> Writing the first manifest is the hardest part of adopting the gate. `cloakpipe infer` drafts it from what your agent actually does: run the gate in shadow mode with capture on, use the agent as usual, and infer a draft in which every rule cites its evidence. The draft is a file for a person to review. It is never activated for you.

```bash
# 1. Capture: shadow mode (or no manifest at all), local files only
cloakpipe mcp-proxy --upstream "<server command>" --task-context task.json \
    --capture ./captures/

# 2. Use the agent normally, or run your test suite through it

# 3. Draft
cloakpipe infer ./captures/ --release my-agent --out cloakpipe.manifest.draft.yaml

# 4. Later, in CI: does new traffic still fit the active contract?
cloakpipe infer ./captures/ --diff cloakpipe.manifest.yaml     # exit 1 on drift
```

## Capture

The decision ledger never stores argument values, so it cannot be used to draft rules. `--capture DIR` writes a separate file per proxy run with the trusted task context, every `tools/list` reply and every `tools/call` with its raw arguments, before the gate decides.

| Property | How |
|---|---|
| Opt-in | Off unless `--capture` is given. |
| Shadow only | Refused with an enforcing gate (`--manifest` without `--mode shadow`). Works without a manifest. |
| Local | Directory `0700`, files `0600`. Never sent anywhere, never in an audit pack. |
| Short-lived | `--capture-max-age DAYS` deletes older capture files at start-up; `infer --delete-after` deletes what it read. |
| Reducible | `--capture-shapes` stores each string as its shape only: length, pattern class (`email`, `url`, `uuid`, `digits`, `id`, `text`, `token`) and a salted hash. |

With `--capture-shapes`, equal strings still hash equal under the capture directory's salt, so binding an argument to the task still works: a recipient that equals the task's customer email is found without either value being stored. Enums, email domains and URL hosts are lost, and the draft says so. Shapes are not encryption: whoever can read the captures can test guesses for low-entropy strings against the hashes, so protect the directory and delete it after inferring.

## What gets drafted

| Rule | From |
|---|---|
| Declared tools | Tools that were called. Tools offered but never called stay undeclared, so refused, and are listed. |
| `type`, `required` | Every observed value; required when present in every kept call. |
| `min` / `max`, `max_len` | The observed range or length, with headroom, rounded up. |
| `enum`, `pattern` | A few recurring values; one shared class such as `T-[0-9]{4,}`, UUIDs or up to three email domains. |
| `one_of_context` | The task-context field the value equals in at least `--bind-threshold` (0.9) of calls, with an `or_pattern` for recurring internal domains. |
| `side_effect: true` | Guessed from the tool name (`send`, `refund`, `delete`, …). |
| `approval` | **Suggested only**, commented out: a money-moving tool gets `when: "<arg> > <top of observed values>"`. |

Each rule carries a comment with how many calls support it, a confidence level and a redacted example (`d***@customer.example`).

## Safety rules

- **Observed is not legitimate.** If the agent was tricked during capture, the draft could encode the attack. A call whose values break the pattern the rest follow is an outlier: it is excluded from every rule of its tool and listed for review, never widened into a rule.
- **Minimum support.** Below `--min-support` calls (default 5), an argument gets only its type and the exact observed bounds, and is flagged.
- **Tight by default.** When unsure, the narrower rule. A refused legitimate call in shadow mode is cheap to fix; a loose rule is invisible.
- **A person activates it.** Before writing the draft, `infer` loads it with the gate's own parser and checks every captured call against it (`Self-check: 40/41 captured calls pass this draft`). The review list at the top names every low-support rule, excluded outlier, `or_pattern`, suggested approval and undeclared tool.

## Drift in CI

`cloakpipe infer ./captures/ --diff cloakpipe.manifest.yaml` checks captured traffic against the active contract instead of drafting. It reports **new tools** (called but not declared), **drift** (calls the contract refuses, by tool, reason and path), rules that **could be tightened**, and declared tools or arguments that are **unused**. New tools or drift exit 1; `--json` prints the report for a CI step.

## Flags

| Flag | Default | |
|---|---|---|
| `--out FILE` | stdout | Refuses to overwrite without `--force`. |
| `--release NAME` | `draft-agent` | The draft's `release`. |
| `--min-support N` | 5 | Calls an argument needs before more than its type and exact bounds is drafted. |
| `--bind-threshold X` | 0.9 | Between 0.5 and 1. |
| `--delete-after` | off | Delete the capture files once the draft is written. |
| `--diff MANIFEST`, `--json` | | Diff mode. |

Exit codes: 0 drafted or no drift, 1 drift or a malformed capture, 2 usage or I/O error.

## Source

[docs/INFER.md](https://github.com/rohansx/cloakpipe/blob/v0.15.0/docs/INFER.md) in the repository.
