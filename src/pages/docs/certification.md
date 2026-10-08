---
layout: ../../layouts/Docs.astro
title: Certification
description: Certification policies, deterministic decisions, Ed25519 signing, keygen, offline verification, revocation and the certify GitHub Action.
---

# Certification <span class="badge oss">Main</span>

Certification turns evaluation evidence about one exact Agent Release into a deterministic decision and a signed, scoped, expiring attestation that anyone can verify offline. The commands are on `main` of the open-source repository.

```text
release manifest ─┐
evaluation runs ──┼─> decide(policy) ─> Decision ─> sign ─> DSSE(in-toto) ─> verify(now, trust, revocations)
baseline runs  ───┘
```

All commands are offline and deterministic given their inputs (`--now` pins time). Exit codes: **0** ok / certified, **1** invalid input, a `BLOCKED` decision or an attestation that does not certify, **2** usage or I/O error.

## Policy

A `CertificationPolicy` is YAML, or JSON when the file ends in `.json`. Unknown fields are rejected.

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

| Field | Default | Meaning |
|---|---|---|
| `validityDays` | `30` | the certification expires this many days after issue; at least 1 |
| `rules.maxNewCriticalFailures` | `0` | critical cases failing in the candidate but not in the baseline |
| `rules.blockPersistingCriticalFailures` | `true` | also block on critical cases that fail in both candidate and baseline |
| `rules.minPassRate` | none | per suite: passed / executed must be `>=` this (`0..=1`) |
| `rules.maxPassRateRegression` | none | per suite: baseline pass rate minus candidate pass rate must be `<=` this (`0..=1`) |
| `rules.minCoverage` | `0.99` | per suite: executed / total cases must be `>=` this (`0..=1`) |
| `rules.metrics[]` | none | a threshold on a per-case metric aggregated over a suite's executed cases |

A metric rule has `metric`, `aggregate` (`mean`, `p50`, `p95`, `min`, `max`), `op` (`lte` or `gte`), `value`, and an optional `suite` to restrict it to runs of one suite. Imported scores are metrics too (`score.<name>`, see [Evaluation import](/docs/evaluation#scoring-rules-for-score-based-sources)).

### Decision reasons

The decision checks input validity, release binding, required assurance, coverage, pass rate, regression against the baseline, critical failures (new and persisting) and metric thresholds. Each failed check is a reason with one of these codes:

`invalid_input`, `release_mismatch`, `no_evidence`, `missing_suite`, `no_cases`, `new_critical_failure`, `persisting_critical_failure`, `coverage_below_minimum`, `pass_rate_below_minimum`, `pass_rate_regression`, `metric_threshold`.

## Keygen

```text
cloakpipe release keygen [--out FILE]
```

Generates an Ed25519 signing key and prints `{"keyid", "publicKey", "privateKey"}` (hex; `privateKey` is the 32-byte seed). `keyid = "ed25519:" + first 16 hex chars of SHA-256(public key)`. With `--out`, the full key is written to `FILE` with mode `0600` (an existing file is never overwritten) and only `keyid` and `publicKey` are printed: publish those to verifiers.

## Certify

```text
cloakpipe release certify MANIFEST --policy FILE --run FILE...
    [--baseline MANIFEST --baseline-run FILE...] [--require a,b]
    --environment ENV --issuer ID [--key KEYFILE] [--now RFC3339]
    [--limitation TEXT]... [--id ID] [--out FILE] [--json]
```

- **Required suites** are the suites the [release diff](/docs/releases#diff) between `--baseline` and the candidate requires, plus `--require`. Without `--baseline` only `--require` applies; an empty set is allowed but warned about on stderr.
- **Decision**: the policy is applied to the candidate's manifest hash, the runs and the baseline runs. Structurally invalid runs or policies become `invalid_input` reasons; unparseable files exit 1.
- **Signing** (`--key`): a certification with `issuedAt = --now` (default: current UTC), `validUntil = issuedAt + validityDays`, the manifest's agent, `--environment`, `--issuer` and each `--limitation`, signed into a DSSE envelope written to `--out` (default `<manifest stem>.cert.dsse.json` in the working directory). `BLOCKED` decisions are signed too: an attestation of a block.
- `--id` pins the certification id (default: random). Pin it only for reproducible output; two issuances must never share an id.
- **Output**: `CERTIFIED` or `BLOCKED`, the release hash, the policy, the required suites, then one line per reason. `--json` prints `{"decision", "envelope"?, "envelopePath"?}`.
- Exit 0 iff the decision is `certified`.

## Signing format

The certification is an in-toto v1 Statement (`predicateType` `https://cloakpipe.co/attestations/certification/v1alpha1`, subject the release's SHA-256) in a DSSE envelope with payload type `application/vnd.in-toto+json`, signed with Ed25519 over the DSSE PAE. Policies, runs and manifests all have canonical hashes (RFC 8785) with their own domains, `cloakpipe.co/certification-policy/v1` and `cloakpipe.co/evaluation-run/v1`, the same scheme as [release manifests](/docs/releases#hash). Policies, runs and certifications issued under the legacy `cloakpipe.dev` identifiers are still accepted and keep their original hashes and signatures.

## Verify-cert

```text
cloakpipe release verify-cert ENVELOPE [--trust KEYFILE]... [--trust-key KEYID=PUBHEX]...
    [--release <manifest | sha256:hex>] [--require-run HASH]...
    [--revoked-statement HEX]... [--revoked-key KEYID]... [--now RFC3339] [--json]
```

Prints the status, the decision outcome, release, statement digest and reasons (`--json`: the full report). Key files from `keygen` are accepted as trust anchors; only their public part is used and a declared `keyid` must match the key. Exit 0 iff the certification is valid (possibly with limitations) **and** the decision is `certified`.

The status is the most severe that applies, in the order `INVALID` > `REVOKED` > `EXPIRED` > `INCOMPLETE` > `VALID_WITH_LIMITATIONS` > `VALID`, with every reason found:

| Status | When |
|---|---|
| `INVALID` | no signature verifies under a trusted key with a matching `keyid`; a malformed envelope, statement or certification; the subject is not the certification's release (or not `--release` when given); bad timestamps, or `--now` before `issuedAt` |
| `REVOKED` | the statement digest is a `--revoked-statement`, or the verifying key is a `--revoked-key` |
| `EXPIRED` | `--now` is at or after `validUntil` |
| `INCOMPLETE` | a `--require-run` hash is not among the runs the decision cites |
| `VALID_WITH_LIMITATIONS` | valid, and the certification declares limitations |
| `VALID` | none of the above |

## Revocation

Verification is offline, so revocations are inputs:

- `--revoked-statement HEX` revokes one certification by its statement digest (SHA-256 hex of the payload; `verify-cert` prints it as `statement`).
- `--revoked-key KEYID` revokes a signer and everything it signed.

The same flags work on the [MCP tool gate](/docs/mcp-gate). In CloakPipe Cloud <span class="badge cloud">Cloud</span>, `POST /api/agents/{agent}/certifications/{id}/revoke` revokes a certification, and the signing keys and revocations are published without authentication at `GET /v1/certification/keys` and `GET /v1/certification/revocations`, so anyone can verify offline.

## End to end

```bash
cloakpipe release keygen --out key.json
cloakpipe eval import --junit report.xml --release release.yaml \
  --suite support-critical@23 --covers privacy,functional --critical 'privacy::*' --out run.json
cloakpipe release certify release.yaml --policy policy.yaml --run run.json \
  --baseline previous.yaml --baseline-run previous-run.json \
  --environment production --issuer ci:acme/support --key key.json
cloakpipe release verify-cert release.cert.dsse.json --trust key.json --release release.yaml
```

## GitHub Action

`.github/actions/certify` in the open-source repository wraps `release certify` for workflows. It installs the CLI (`cargo install --git https://github.com/rohansx/cloakpipe … cloakpipe-cli --locked` at `cloakpipe-ref`), certifies, writes a job summary and sets the outputs `outcome`, `envelope` and `decision`. It uploads nothing.

One-time setup:

```bash
cloakpipe release keygen --out certify-key.json   # mode 0600; prints keyid + publicKey
gh secret set CLOAKPIPE_CERT_KEY < certify-key.json
```

Publish the printed `keyid` and `publicKey` to whoever verifies your certifications; keep `certify-key.json` out of the repository.

```yaml
jobs:
  certify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable

      # … run your evaluation suites, producing JUnit XML …

      - name: Import evaluation results
        run: |
          cloakpipe eval import --junit reports/support-critical.xml \
            --release release.yaml --suite support-critical@23 \
            --covers privacy,functional --critical 'privacy::*' \
            --tool pytest --out runs/support-critical.json

      - id: cert
        uses: rohansx/cloakpipe/.github/actions/certify@main
        with:
          manifest: release.yaml
          policy: certification-policy.yaml
          runs: |
            runs/support-critical.json
          baseline-manifest: releases/previous.yaml   # optional: required suites from the diff
          baseline-runs: |
            runs/previous/support-critical.json
          require: privacy
          environment: production
          signing-key: ${{ secrets.CLOAKPIPE_CERT_KEY }}

      - uses: actions/upload-artifact@v4
        if: always() && steps.cert.outputs.envelope != ''
        with:
          name: certification
          path: ${{ steps.cert.outputs.envelope }}
```

The `eval import` step needs the CLI on `PATH` before the action runs; either install it in an earlier step or run the action first with `runs` produced by your own tooling.

| Input | Required | Description |
|---|---|---|
| `manifest` | yes | Candidate release manifest; must be certifiable. |
| `policy` | yes | `CertificationPolicy` (YAML or JSON). |
| `runs` | yes | Newline-separated `EvaluationRun` JSON paths. |
| `baseline-manifest` | no | Baseline release; the diff sets the required suites. |
| `baseline-runs` | no | Newline-separated baseline `EvaluationRun` JSON paths. |
| `require` | no | Extra required assurance suites, comma-separated. |
| `environment` | yes | Certification scope, e.g. `production`. |
| `issuer` | no | Defaults to `github:<owner/repo>/<workflow>@<ref>`. |
| `signing-key` | no | Key file contents from `keygen` (a secret). Empty: decide without signing. |
| `out` | no | Envelope path; default `<manifest stem>.cert.dsse.json`. |
| `fail-on-blocked` | no | Fail the step on `BLOCKED` (default `true`). |
| `install` | no | `false` to use a `cloakpipe` already on `PATH` (default `true`). |
| `cloakpipe-ref` | no | Branch, tag or commit to install from (default `main`). |

| Output | Description |
|---|---|
| `outcome` | `certified` or `blocked`. |
| `envelope` | Path of the signed envelope (empty when unsigned). |
| `decision` | Path of the `{decision, envelope?}` JSON. |

The signing key is written to a `0600` file under `$RUNNER_TEMP`, removed when the step ends, and never printed.

## What a certification does not claim

A valid certification proves that a named issuer applied a named policy to named evaluation runs of an exact release and reached the stated decision. It does not prove the evaluators measured the right property, that the suites are representative, or that the release is safe outside the certified scope and validity window.
