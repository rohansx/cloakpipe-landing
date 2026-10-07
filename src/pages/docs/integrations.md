---
layout: ../../layouts/Docs.astro
title: Integrations
description: Providers, frameworks, gateways, MCP, evaluation tools and CI that CloakPipe works with, and where their source lives.
---

# Integrations

The full catalogue, with what is shipped and what is planned, is on the **[Integrations page](/integrations)**. This page is the short version for developers.

## LLM providers

The privacy proxy speaks the OpenAI API dialect, so most clients only change their base URL:

- **Self-hosted** <span class="badge oss">Main</span>: `cloakpipe start` listens on `127.0.0.1:8900`; set `OPENAI_BASE_URL=http://127.0.0.1:8900/v1`. See the [quick start](/docs/quickstart#just-want-the-privacy-proxy).
- **CloakPipe Cloud** <span class="badge cloud">Cloud</span>: base URL `https://api.cloakpipe.co/v1` with `X-CloakPipe-Key`. See [Runtime enforcement](/docs/runtime#the-proxy).

The open-source proxy also supports the Anthropic Messages API.

## Python, LangChain and LlamaIndex

<span class="badge oss">Main</span> Source packages in the open-source repository (install from source; they are not published to PyPI yet):

- [`integrations/python`](https://github.com/rohansx/cloakpipe/tree/main/integrations/python): the `cloakpipe` Python package, with LangChain and LlamaIndex integrations.
- [`integrations/langchain-cloakpipe`](https://github.com/rohansx/cloakpipe/tree/main/integrations/langchain-cloakpipe): `ChatCloakPipe`, a drop-in replacement for `ChatOpenAI`.
- [`integrations/llamaindex-cloakpipe`](https://github.com/rohansx/cloakpipe/tree/main/integrations/llamaindex-cloakpipe): a drop-in replacement for LlamaIndex's `OpenAI` LLM.

## MCP

- `cloakpipe mcp` runs CloakPipe as an MCP server with the tools `pseudonymize`, `rehydrate`, `detect`, `vault_stats`, `configure` and `session_context`.
- `cloakpipe mcp-proxy` fronts any upstream MCP server, masking tool-call arguments, and with a release manifest gates tool calls on certification. See [MCP tool gate](/docs/mcp-gate).

## Evaluation tools and CI

<span class="badge oss">Main</span>

- JUnit XML (pytest, Jest, Go, JUnit, cargo-nextest), Braintrust and Langfuse: [Evaluation import](/docs/evaluation).
- GitHub Actions: [the certify action](/docs/certification#github-action).
- <span class="badge cloud">Cloud</span> Uploading the same reports to CloakPipe Cloud from CI or the dashboard: [Evaluation import](/docs/evaluation#upload-to-cloakpipe-cloud).

## Try it in the browser

The [playground](/playground) runs CloakPipe's detection on text you paste and shows the masked output.
