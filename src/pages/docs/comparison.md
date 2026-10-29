---
layout: ../../layouts/Docs.astro
title: Comparison
description: How CloakPipe compares with Microsoft's Agent Governance Toolkit, Pipelock and observability tools - where each runs, what it decides on, and what evidence it keeps - as of October 2026.
---

# Comparison

People ask how CloakPipe relates to two other open-source projects, Microsoft's **Agent Governance Toolkit** and **Pipelock**, and to agent observability tools. They overlap in places but sit at different points and make different trade-offs. This page states what each does, as of October 2026.

**How we wrote this.** Everything said here about the other projects comes from their own public README files, read on 27 October 2026 and linked under [Sources](#sources). We have not benchmarked or audited them, and we do not say what they lack, only what their docs say they do. Projects move fast: check their docs for the current state, and if we got something wrong, [open an issue](https://github.com/rohansx/cloakpipe/issues) and we will fix it.

## In one paragraph each

**CloakPipe** is a narrow, self-hosted gate for MCP tool calls. It runs as a separate process between an agent host and one stdio MCP server, checks each `tools/call` against a manifest (closed tool and argument lists, value rules, arguments bound to an orchestrator-supplied task context), an optional Cedar policy and signed approval receipts, tracks side effects, and writes a signed decision ledger that an auditor verifies offline. One Rust binary, MIT.

**Agent Governance Toolkit (AGT)**, from Microsoft, describes itself as "Policy enforcement, identity, sandboxing, and SRE for autonomous AI agents". It is a family of SDKs (Python, TypeScript, .NET, Rust, Go) with adapters for many agent frameworks; its quick start wraps a tool function in process with `govern(my_tool, policy="policy.yaml")`. Its README lists an MCP Security Gateway, identity, execution sandboxing, SRE tooling and compliance mappings. It is MIT-licensed and marked "Public Preview".

**Pipelock** describes itself as an "Open-source AI agent firewall for Verifiable Egress Control". It is a Go binary that sits between agents and the network and, per its README, inspects "HTTP, WebSocket, MCP, and A2A traffic" for "secret exfiltration, prompt injection, SSRF, tool poisoning, and risky tool-call chains", wraps MCP servers over stdio and Streamable HTTP, offers process containment, and emits signed action receipts. Its core is Apache-2.0, with Pro and Enterprise features under the Elastic License 2.0.

## At a glance

| | CloakPipe | Agent Governance Toolkit | Pipelock |
|---|---|---|---|
| **Scope** | tool calls to MCP servers | policy, identity, sandboxing, SRE and compliance across an agent system | network egress and MCP/A2A traffic of an agent |
| **Where it runs** | a separate process in front of one stdio MCP server | in the agent's process, as SDK middleware or framework adapters; the README notes that "the policy engine and agents share the same process boundary" | a separate proxy / MCP wrapper in front of the network and MCP servers |
| **What decides a call** | per-tool argument contracts, task-context binding, Cedar policy, signed approval receipts | YAML policy rules (the README's diagram also names OPA and Cedar), with `allow`, `deny` and `require_approval` actions | built-in and configured scanners: DLP patterns, injection patterns, URL and SSRF checks, 30 built-in tool-policy rules, tool-chain patterns |
| **Human approval** | signed receipt bound to the exact call's fingerprint, with a `ttl`; <span class="badge next">v0.14</span> requests can go to an approval broker over an open protocol, with receipts verified locally | `require_approval` with `approvers` in policy | lists human-in-the-loop modes, and an `ask` action for response findings |
| **Evidence** | per-entry Ed25519-signed, hash-chained decision ledger; epochs anchored with RFC 3161 and Sigstore Rekor; offline `cloakpipe verify` of a tar pack | "tamper-evident" decision records; an Audit and Compliance spec covering "Merkle audit" | Ed25519-signed action receipts; a hash-chained flight recorder with signed checkpoints; receipt checkpoints anchored to a local backend or Rekor |
| **Packaging** | one Rust binary (crates.io), container image | Python, npm, NuGet, crates.io and Go packages; a Claude Code plugin | one Go binary, container image, Helm chart |
| **Licence** | MIT | MIT | Apache-2.0 core; ELv2 for Pro and Enterprise features |
| **Status (Oct 2026)** | v0.14.0 released 29 Oct 2026; most features on these docs are new in <span class="badge oss">v0.12</span>, <span class="badge oss">v0.13</span> or <span class="badge next">v0.14</span> | v4.1.0, "Public Preview" | v3.7.1 |

## Where they differ

**Breadth.** CloakPipe does much less than either project. AGT covers identity, sandboxing, SRE and compliance mappings across an agent system, and its README lists adapters for over a dozen frameworks. Pipelock covers network egress, content scanning for secrets and injection, MCP and A2A, process containment and a kill switch. CloakPipe only decides tool calls to MCP servers: in v0.12.0 over stdio, one server per gate, and in the next release also over Streamable HTTP and with several servers per gate <span class="badge oss">v0.13</span>.

**Where the check runs.** AGT's README says its policy engine runs in the agent's process and recommends running each agent in its own container for OS-level isolation. CloakPipe and Pipelock run as separate processes the agent's traffic passes through. An in-process SDK can see richer context, such as the framework's own objects; a separate process cannot be switched off from inside the agent's process, but sees only what crosses the wire, and only if the agent's traffic is routed through it.

**What a decision is based on.** Pipelock's README centres on scanning content (patterns for secrets and injections, URL checks, tool-chain patterns) and on learned behaviour (its "learn-and-lock" contracts). CloakPipe centres on rules you write per tool and per argument: each argument is declared, typed and bounded, and values such as the recipient of an email can be bound to the task the orchestrator assigned (`one_of_context`), so "email the customer on this ticket" is enforceable even when the email address itself looks harmless. Content scanning and contract checking catch different failures and can be layered.

**Side effects.** CloakPipe tracks side-effecting calls as operations with states (`in_flight`, `done`, `failed`, `unknown`), replays a completed call instead of running it twice, and refuses to retry a call whose outcome is unknown until an operator reconciles it. See [MCP tool gate](/docs/mcp-gate#side-effects-and-reconciliation).

**Evidence.** All three keep signed, tamper-evident records. CloakPipe signs every decision entry, seals entries into numbered epochs that are anchored with both an RFC 3161 timestamp authority and Sigstore Rekor, and verifies a whole pack offline, reporting gaps between epochs. Pipelock's README describes Rekor anchoring of receipt checkpoints, and says that "operator-independent verification against that anchor is still being proven end to end". Read each project's evidence docs for the exact guarantees.

## Observability tools

Tracing and observability platforms for LLM applications record what an agent did (prompts, tool calls, latencies, costs) and help you debug and evaluate it. They are a different job from a gate: a trace is written after the call happens, while the gate decides before it happens and refuses calls that break the rules. Many teams will want both. If an observability product you use also offers inline blocking, compare it on the points in the table above.

## Choosing

- If you want one toolkit for identity, policy, sandboxing and SRE across many frameworks, and in-process enforcement suits you, read the Agent Governance Toolkit docs.
- If your main risk is an agent leaking secrets or being steered through the network, and you want content scanning and containment, read the Pipelock docs.
- If you want a small, separate gate that checks every MCP tool call against per-argument rules tied to the task, asks a human for exact calls, refuses unsafe retries, and leaves anchored evidence an auditor can verify offline, that is CloakPipe. Start with the [quick start](/docs/quickstart).

They work at different points, so combining them is possible. We have not tested specific combinations.

## Sources

Read on 27 October 2026:

- Agent Governance Toolkit: [https://github.com/microsoft/agent-governance-toolkit](https://github.com/microsoft/agent-governance-toolkit) (README, latest release v4.1.0), its [documentation site](https://microsoft.github.io/agent-governance-toolkit/) and its [MCP Security Gateway specification](https://github.com/microsoft/agent-governance-toolkit/blob/main/docs/specs/MCP-SECURITY-GATEWAY-1.0.md).
- Pipelock: [https://github.com/pipelab-org/pipelock](https://github.com/pipelab-org/pipelock) (README, latest release v3.7.1; formerly `luckyPipewrench/pipelock`) and its [comparison hub](https://pipelab.org/compare/).
- CloakPipe: [rohansx/cloakpipe](https://github.com/rohansx/cloakpipe) and these docs.
