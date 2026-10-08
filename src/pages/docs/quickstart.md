---
layout: ../../layouts/Docs.astro
title: Quick start
description: Install the CloakPipe CLI, write a release manifest, hash and validate it, import an evaluation, certify the release and verify the certification offline.
---

# Quick start

This walks one sample release through **validate → hash → import an eval → certify → verify**. Everything runs offline on your machine; no account is needed.

## 1. Install the CLI

The CLI is the Cargo package **`cloakpipe-cli`**; it installs a binary named **`cloakpipe`**. You need a Rust toolchain (`rustup`).

Everything on this page is on `main`:

```bash
cargo install --git https://github.com/rohansx/cloakpipe cloakpipe-cli --locked
```

Check it: `cloakpipe --help` should list `release` and `eval` among the commands.

## 2. Write a release manifest

A release pins every behaviour-affecting component to an immutable version. Save this as `release.yaml`:

```yaml
apiVersion: cloakpipe.co/v1alpha1
kind: AgentRelease
metadata:
  agent: support-agent
  version: "184"
  labels:
    team: support
spec:
  code:
    repository: acme/support
    commit: 8fd29ac
  prompts:
    - ref: prompt:support-answer@31
  model:
    ref: model:openai/gpt-5@2026-08-01
  parameters:
    temperature: 0.2
    max_tokens: 1200
  tools:
    - ref: tool:lookup-customer@7
    - ref: tool:refund@4
  mcpServers:
    - ref: mcp:crm@12
  retrieval:
    ref: retrieval:support@22
  policies:
    - ref: policy:support-prod@11
  runtime:
    image: registry.acme.dev/support-agent@sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08
    region: in-south
  dependencies:
    - name: orchestrator
      version: 2.4.1
```

The field rules are in [Agent releases](/docs/releases#manifest).

## 3. Validate and hash it

```bash
cloakpipe release validate release.yaml
# valid  sha256:28b40cf5db41c164624094de4df3943e3a5f1d7238e78727af9eb5c88be2efea  support-agent@184

cloakpipe release hash release.yaml
# sha256:28b40cf5db41c164624094de4df3943e3a5f1d7238e78727af9eb5c88be2efea
```

A manifest with a moving reference is refused with the field path, exit code 1:

```text
invalid: 1 issue(s)
  spec.prompts[0].ref: "prompt:support-answer@latest" is not pinned to an immutable version
```

## 4. Import an evaluation

Run your tests however you already do, writing JUnit XML (`pytest --junitxml=report.xml`, Jest, Go, cargo-nextest). Then bind the report to the release:

```bash
cloakpipe eval import --junit report.xml --release release.yaml \
  --suite support-critical@23 --covers privacy,functional --critical 'privacy::*' --out run.json
```

`run.json` is a native `EvaluationRun` whose `release` is the manifest hash. Braintrust and Langfuse are covered in [Evaluation import](/docs/evaluation).

## 5. Certify

Create a signing key, write a policy, and certify:

```bash
cloakpipe release keygen --out key.json   # mode 0600; prints only keyid and publicKey
```

`policy.yaml`:

```yaml
apiVersion: cloakpipe.co/v1alpha1
kind: CertificationPolicy
name: support-prod
version: "11"
validityDays: 30
rules:
  maxNewCriticalFailures: 0
  blockPersistingCriticalFailures: true
  minPassRate: 0.95
  minCoverage: 1.0
  metrics:
    - metric: latency_ms
      aggregate: p95
      op: lte
      value: 2000
```

```bash
cloakpipe release certify release.yaml --policy policy.yaml --run run.json \
  --require privacy,functional --environment production --issuer ci:acme/support --key key.json
```

```text
CERTIFIED
release   sha256:28b40cf5…2efea  support-agent@184
policy    support-prod@11  sha256:…
required  functional, privacy
runs      1
envelope  release.cert.dsse.json
```

Exit code 0 means certified; a `BLOCKED` decision exits 1 and lists one reason per line. With a previous release, pass `--baseline previous.yaml --baseline-run previous-run.json` and the required suites come from the diff. See [Certification](/docs/certification).

## 6. Verify the certification

Anyone with the public key can check the envelope offline:

```bash
cloakpipe release verify-cert release.cert.dsse.json --trust key.json --release release.yaml
```

```text
VALID
outcome    certified
release    sha256:28b40cf5…2efea
statement  78ba8788…
certified  yes
```

## Next

- Gate an agent's tool calls on this certification: [MCP tool gate](/docs/mcp-gate).
- Run certification in CI: [the GitHub Action](/docs/certification#github-action).
- Register the release with CloakPipe Cloud: [`cloakpipe release register`](/docs/releases#register).

## Just want the privacy proxy?

The proxy is on `main`. From a clone of the repository:

```bash
git clone https://github.com/rohansx/cloakpipe
cd cloakpipe
export OPENAI_API_KEY=sk-...
cargo run -p cloakpipe-cli -- start      # listens on 127.0.0.1:8900
export OPENAI_BASE_URL=http://127.0.0.1:8900/v1
```
