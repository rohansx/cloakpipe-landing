---
layout: ../../layouts/Docs.astro
title: Integrations
description: Put the gate in front of an MCP server in Claude Code, Cursor or Codex, use it with any stdio MCP host, and what the Python, LangChain and LlamaIndex packages and the LLM proxy do today.
---

# Integrations

The gate works with any MCP host that starts servers as a command over stdio: you replace the server's command with `cloakpipe mcp-proxy`, and give the original command to `--upstream`. Nothing about the host or the server changes. This page shows the config for Claude Code, Cursor and Codex, then lists what else exists and what does not yet.

| Integration | Status |
|---|---|
| Claude Code, Cursor, Codex and any stdio MCP host, by config | <span class="badge oss">v0.11</span>, with the v1 manifest in <span class="badge oss">v0.12</span> |
| One-command install for Claude Code, Cursor and Codex | <span class="badge building">Roadmap</span> |
| Hosts that connect to the gate over HTTP (`--listen`), and HTTP MCP servers behind it (`--upstream-url`) | <span class="badge oss">v0.13</span> |
| Webhooks (Slack, Discord, any HTTPS receiver) and OpenTelemetry | <span class="badge oss">v0.13</span> |
| Approval brokers: any service that implements the open protocol ([Approvals](/docs/approvals)) | <span class="badge next">v0.14</span> |

In every snippet below, `npx -y @acme/support-mcp` stands for your server's original command. Use **absolute paths**: hosts start servers from a directory you do not control. The gate logs to stderr, which hosts show in their MCP logs.

## Claude Code

Add the gated server from the command line (`--scope project` writes `.mcp.json` in the project, to share with your team):

```bash
claude mcp add --scope project support -- \
  cloakpipe mcp-proxy --upstream "npx -y @acme/support-mcp" \
  --manifest /srv/agent/cloakpipe.manifest.yaml \
  --task-context /srv/agent/task-context.json \
  --operations-db /srv/agent/ops.db
```

### Claude Code over HTTP

<span class="badge oss">v0.13</span> Or run the gate as an HTTP server and give Claude Code its URL. One gate can then serve several agents, and the host needs no command of its own:

```bash
mkdir -p ~/.cloakpipe && openssl rand -hex 32 > ~/.cloakpipe/listen.token
cloakpipe mcp-proxy --listen 127.0.0.1:8900 --listen-token-file ~/.cloakpipe/listen.token \
  --manifest /srv/agent/cloakpipe.manifest.yaml \
  --task-context /srv/agent/task-context.json \
  --operations-db /srv/agent/ops.db \
  --upstream "npx -y @acme/support-mcp"
claude mcp add --transport http support http://127.0.0.1:8900/mcp \
  --header "Authorization: Bearer $(cat ~/.cloakpipe/listen.token)"
```

Keep the gate running (as a service, or in [Docker](/docs/docker)) while Claude Code uses it. The task context is the gate's, so every session that connects shares it. See [MCP over HTTP](/docs/mcp-gate#mcp-over-http).

### `.mcp.json`

Or write `.mcp.json` yourself:

```json
{
  "mcpServers": {
    "support": {
      "command": "cloakpipe",
      "args": [
        "mcp-proxy",
        "--upstream", "npx -y @acme/support-mcp",
        "--manifest", "/srv/agent/cloakpipe.manifest.yaml",
        "--task-context", "/srv/agent/task-context.json",
        "--operations-db", "/srv/agent/ops.db"
      ],
      "env": { "CLOAKPIPE_HOME": "/srv/agent/.cloakpipe" }
    }
  }
}
```

## Cursor

Cursor reads the same shape from `.cursor/mcp.json` in the project (or `~/.cursor/mcp.json` for every project):

```json
{
  "mcpServers": {
    "support": {
      "command": "cloakpipe",
      "args": [
        "mcp-proxy",
        "--upstream", "npx -y @acme/support-mcp",
        "--manifest", "/srv/agent/cloakpipe.manifest.yaml",
        "--task-context", "/srv/agent/task-context.json",
        "--operations-db", "/srv/agent/ops.db"
      ]
    }
  }
}
```

## Codex

Codex reads MCP servers from `~/.codex/config.toml`:

```toml
[mcp_servers.support]
command = "cloakpipe"
args = [
  "mcp-proxy",
  "--upstream", "npx -y @acme/support-mcp",
  "--manifest", "/srv/agent/cloakpipe.manifest.yaml",
  "--task-context", "/srv/agent/task-context.json",
  "--operations-db", "/srv/agent/ops.db",
]

[mcp_servers.support.env]
CLOAKPIPE_HOME = "/srv/agent/.cloakpipe"
```

Or from the command line: `codex mcp add support -- cloakpipe mcp-proxy --upstream "npx -y @acme/support-mcp" --manifest /srv/agent/cloakpipe.manifest.yaml`, plus the other flags as above.

## Any other stdio MCP host

Wherever a host takes a server command, use `cloakpipe` as the command and `mcp-proxy --upstream "<original command>" --manifest …` as the arguments. Wrap **every** server the agent can reach: a server configured without the gate is not gated. Up to v0.12.0, run one `mcp-proxy` per server. <span class="badge oss">v0.13</span> One gate can front several stdio servers with `--server NAME=COMMAND`; see [Several servers](/docs/mcp-gate#several-servers).

A host that takes a server URL instead can connect to a gate started with `--listen` <span class="badge oss">v0.13</span>.

## Things to know

- **Task context.** `--task-context` is read when the gate starts. In an IDE session that is fine for a fixed project context. For an orchestrator that runs many tasks, start one gate per task with that task's context file (or set `CLOAKPIPE_TASK_CONTEXT`).
- **Start in shadow mode.** Add `--mode shadow` to see what the manifest would refuse without blocking anyone, then remove it. See [MCP tool gate](/docs/mcp-gate#shadow-mode).
- **Ledger location.** By default every gate writes to `~/.cloakpipe/ledger.db` and signs with `~/.cloakpipe/gate.key`. Set `CLOAKPIPE_HOME` (as above) or `--ledger-db` to keep each agent's evidence apart.
- **Refusals are visible to the model.** A refused call comes back as a JSON-RPC error with the reason (`scope_mismatch`, `undeclared_tool`, …). The host passes it back to the model like any other tool error.

## Python, LangChain and LlamaIndex

<span class="badge oss">v0.11</span> The repository has Python packages under [`integrations/`](https://github.com/rohansx/cloakpipe/tree/main/integrations): `cloakpipe` (Python), `langchain-cloakpipe` (`ChatCloakPipe`, a drop-in for `ChatOpenAI`) and `llamaindex-cloakpipe` (a drop-in for LlamaIndex's `OpenAI` LLM). They are **clients of the PII proxy** below: they route model traffic through `cloakpipe start` so personal data is pseudonymized on the way out and restored on the way back. They do **not** gate tool calls. To gate a LangChain or LlamaIndex agent's tools today, expose the tools through an MCP server and put `cloakpipe mcp-proxy` in front of it. Install them from source; they are not published to PyPI yet.

Gating wrappers for LangGraph, CrewAI and the OpenAI Agents SDK are <span class="badge building">Roadmap</span>.

## OpenAI- and Anthropic-compatible LLM proxy

<span class="badge oss">v0.11</span> `cloakpipe start` runs a local proxy for the OpenAI and Anthropic APIs: set your client's base URL to it and personal data in prompts is pseudonymized before it reaches the provider, then restored in responses. It is a PII transform only: it does **not** inspect or gate the tool calls in model responses. Checking `tool_calls` / `tool_use` blocks against the manifest in this proxy is <span class="badge building">Roadmap</span>.

## Events and telemetry

- <span class="badge oss">v0.13</span> Webhooks (HMAC-signed) for denials, approval requests, drift and unknown side effects, as raw JSON or as Slack and Discord messages. See [Alerts & events](/docs/events).
- <span class="badge oss">v0.13</span> OpenTelemetry spans, one per gate decision, allows included.
- <span class="badge next">v0.14</span> Approval requests filed with an approval broker you run, which hands back signed receipts the gate verifies. See [Approvals](/docs/approvals).
- <span class="badge building">Roadmap</span> Hosted alerts and approvals in Slack, Discord or PagerDuty (grouped issues, routing, approval buttons). This is not built; [tell us on the waitlist](/waitlist) if you want it.

Without any of these, the record of every decision is the [ledger](/docs/evidence), and the gate's log is on stderr, as it was up to v0.12.0.

## CI

Validate the manifest and its policy on every change, so a broken rule fails the build instead of stopping the gate at start-up:

```bash
cloakpipe manifest validate cloakpipe.manifest.yaml
cloakpipe manifest hash cloakpipe.manifest.yaml --json
```
