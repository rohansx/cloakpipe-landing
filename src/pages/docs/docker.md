---
layout: ../../layouts/Docs.astro
title: Docker
description: Run the gate as a container that serves MCP over HTTP in front of your tool server, configured with CLOAKPIPE_* variables, with its ledger and key on a volume.
---

# Docker

<span class="badge oss">v0.13</span> The image built from the repository's `Dockerfile`, released as `ghcr.io/rohansx/cloakpipe:0.14.0`, runs the gate over HTTP by default: agents connect to `http://<host>:8900/mcp`, and the gate checks each tool call before it reaches your MCP server.

Up to v0.12.0, the image's default command was the PII proxy; that is now `start`, below.

## Run it

```bash
git clone https://github.com/rohansx/cloakpipe && cd cloakpipe
docker build -t cloakpipe-gate .
openssl rand -hex 32 > listen.token
docker run --rm -p 127.0.0.1:8900:8900 \
  -v "$PWD/cloakpipe.manifest.yaml:/app/cloakpipe.manifest.yaml:ro" \
  -v "$PWD/listen.token:/run/secrets/listen.token:ro" \
  -v cloakpipe-data:/data \
  -e CLOAKPIPE_UPSTREAM_URL=https://tools.example.com/mcp \
  -e CLOAKPIPE_LISTEN_TOKEN_FILE=/run/secrets/listen.token \
  cloakpipe-gate
```

The image's entrypoint, `cloakpipe-entrypoint` ([docker/gate-entrypoint.sh](https://github.com/rohansx/cloakpipe/blob/v0.14.0/docker/gate-entrypoint.sh)), turns the variables below into flags and runs `cloakpipe mcp-proxy --listen 0.0.0.0:8900 --manifest /app/cloakpipe.manifest.yaml --upstream-url $CLOAKPIPE_UPSTREAM_URL …`. Every decision is the same as with the binary; see [MCP over HTTP](/docs/mcp-gate#mcp-over-http).

Then point the agent at the gate, for example Claude Code:

```bash
claude mcp add --transport http support-tools http://localhost:8900/mcp \
  --header "Authorization: Bearer $(cat listen.token)"
```

## Variables

| Variable | Becomes |
|---|---|
| `CLOAKPIPE_UPSTREAM_URL` | `--upstream-url`: your MCP server over Streamable HTTP. This or `CLOAKPIPE_UPSTREAM` is required. |
| `CLOAKPIPE_UPSTREAM` | `--upstream`: a stdio server command run inside the container. The image has no Node.js or Python, so build on top of it to add your server's runtime. |
| `CLOAKPIPE_UPSTREAM_HEADER` | one `--upstream-header`, `Name: value`; a value `env:VAR` is read from `VAR` |
| `CLOAKPIPE_MANIFEST` | `--manifest`, default `/app/cloakpipe.manifest.yaml`. Mount yours there. |
| `CLOAKPIPE_LISTEN` | `--listen`, default `0.0.0.0:8900` |
| `CLOAKPIPE_LISTEN_TOKEN_FILE` | `--listen-token-file`: the bearer token agents must send |
| `CLOAKPIPE_INSECURE_NO_TOKEN` | set to `1` to listen on a non-loopback address without a token, on a private network only |
| `CLOAKPIPE_TOOLS_LOCK` | `--tools-lock`, with `CLOAKPIPE_UPSTREAM` only (a tools lock does not combine with an HTTP upstream yet) |
| `CLOAKPIPE_WEBHOOK_URL`, `CLOAKPIPE_WEBHOOK_SECRET_FILE`, `CLOAKPIPE_WEBHOOK_FORMAT` | `--webhook`, `--webhook-secret-file`, `--webhook-format`. See [Alerts & events](/docs/events). |
| `CLOAKPIPE_OTEL_ENDPOINT`, `CLOAKPIPE_EVENTS_LOG` | `--otel-endpoint`, `--events-log` |

The gate reads a few more itself: `CLOAKPIPE_TASK_CONTEXT` (the task context file), and `CLOAKPIPE_HOME` and `CLOAKPIPE_OPERATIONS_DB`, which the image sets.

Arguments after `gate` are added to the flags, for example `docker run … cloakpipe-gate gate --mode shadow` to start in [shadow mode](/docs/mcp-gate#shadow-mode).

The entrypoint refuses to start, with exit code 2, when there is no manifest at `CLOAKPIPE_MANIFEST` (no manifest is mounted), when both or neither of `CLOAKPIPE_UPSTREAM_URL` and `CLOAKPIPE_UPSTREAM` are set, and when the gate would listen on a non-loopback address without `CLOAKPIPE_LISTEN_TOKEN_FILE` (unless `CLOAKPIPE_INSECURE_NO_TOKEN=1`). The binary on its own only warns about a missing token; the image is stricter because it listens on `0.0.0.0` by default.

## State and health

The image sets `CLOAKPIPE_HOME=/data` and `CLOAKPIPE_OPERATIONS_DB=/data/operations.db`, and declares `/data` a volume. The decision ledger, the gate signing key (created on first start) and the operations store all live there, so mount a named volume to keep them across restarts. Any command other than `gate` runs `cloakpipe` itself, so this exports the ledger from the volume:

```bash
docker run --rm -v cloakpipe-data:/data cloakpipe-gate ledger export --out /data/audit-pack.tar
```

The health check asks `GET /health` on the listen port, which needs no token.

## Compose example

[docker/compose.example.yaml](https://github.com/rohansx/cloakpipe/blob/v0.14.0/docker/compose.example.yaml) runs the gate in front of the support-agent example's tools, served over HTTP by `examples/support-agent/mock_http_upstream.py`:

```bash
openssl rand -hex 32 > docker/listen.token
docker compose -f docker/compose.example.yaml up --build
```

The gate enforces `examples/support-agent/cloakpipe.manifest.yaml`, so the injected email from the [quick start](/docs/quickstart) is refused as `scope_mismatch` over HTTP too. Replace the `tools` service and the manifest with yours. The file publishes the port on `127.0.0.1` only; put a reverse proxy with TLS in front for agents on other machines.

## The PII proxy

Any command other than `gate` runs `cloakpipe` itself. `start` runs the OpenAI- and Anthropic-compatible PII proxy with the bundled config, as the image did by default up to v0.12.0:

```bash
docker run -p 8900:8900 -e OPENAI_API_KEY=sk-... cloakpipe-gate start
```

The repository's root `docker-compose.yml` runs it that way.
