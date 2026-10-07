---
layout: ../../layouts/Docs.astro
title: Evaluation import
description: Turn JUnit XML, Braintrust experiments and Langfuse dataset runs into EvaluationRuns bound to an Agent Release, with the exact flags and scoring rules.
---

# Evaluation import <span class="badge oss">Main</span>

CloakPipe does not replace your evaluation tool. `cloakpipe eval import` turns its report into a native **`EvaluationRun`** bound to one release's manifest hash, which [`cloakpipe release certify`](/docs/certification) then uses as evidence. It is on `main` of the open-source repository. CloakPipe Cloud can also [take the raw results and convert them on the server](#upload-to-cloakpipe-cloud), with the same importer.

## Usage

```text
cloakpipe eval import (--junit FILE | --braintrust FILE | --langfuse-run FILE --langfuse-scores FILE)
    --release <manifest | sha256:hex> --suite NAME@VERSION --covers a,b
    [--critical PATTERN]... [--pass-threshold T] [--score NAME]... [--run-id ID] [--tool NAME]
    [--dataset REF] [--out FILE]
```

| Flag | Meaning |
|---|---|
| `--junit FILE` | JUnit XML report |
| `--braintrust FILE` | Braintrust experiment events: `/v1/experiment/{id}/fetch` output, an array of events, or JSONL |
| `--langfuse-run FILE` | Langfuse dataset run: `/api/public/datasets/{dataset}/runs/{run}` output; requires `--langfuse-scores` |
| `--langfuse-scores FILE` | Langfuse scores for the run: `GET /api/public/v2/scores` output (a page, or an array of every page) |
| `--release` | the evaluated release: a manifest path (must be certifiable; it is replaced by its hash) or `sha256:<hex>` |
| `--suite NAME@VERSION` | the evaluation suite |
| `--covers a,b` | required. The assurance suites this run is evidence for, comma-separated (e.g. `privacy,functional`) |
| `--critical PATTERN` | case ids that are critical: `prefix*` or an exact id; repeatable |
| `--pass-threshold T` | score-based sources only: a case passes iff every score is `>=` T, within `0..=1`, default `0.5`. Not accepted with `--junit` |
| `--score NAME` | score-based sources only: count only this score name; repeatable |
| `--run-id ID` | run id, default `NAME@VERSION` |
| `--tool NAME` | producing tool, e.g. `pytest` |
| `--dataset REF` | dataset reference (Langfuse default: the run's `datasetName`) |
| `--out FILE` | write the run here instead of stdout |

Exactly one source is required. An invalid report or run exits **1** with the issues on stderr; a missing file or a bad argument exits **2**.

## JUnit XML

JUnit XML from pytest, Jest, Go, JUnit or cargo-nextest.

- A `<testsuites>` root with any number of `<testsuite>` children, or a bare `<testsuite>` root. Nested suites are walked.
- Each `<testcase>` is one case with id `{classname}::{name}`, or just `name` when `classname` is absent or empty.
- Status: a `<failure>` child is `fail`, `<error>` is `error`, `<skipped>` is `skipped`, otherwise `pass`. If several are present, error beats failure beats skipped.
- `time="<seconds>"` becomes `durationMs`.
- Case-level properties: `cloakpipe.critical` (`true`/`false`), `cloakpipe.score` (number) and `cloakpipe.metric.<name>` (number, becomes `metrics[<name>]`). Unknown properties are ignored.

```xml
<testcase classname="refunds" name="requires_identity" time="0.412">
  <properties>
    <property name="cloakpipe.critical" value="true"/>
    <property name="cloakpipe.metric.latency_ms" value="412"/>
  </properties>
</testcase>
```

```bash
cloakpipe eval import --junit report.xml --release release.yaml \
  --suite support-critical@23 --covers privacy,functional --critical 'privacy::*' --out run.json
```

## Scoring rules for score-based sources

Braintrust and Langfuse report per-case scores, not verdicts. CloakPipe decides each case:

- **pass** iff every counted score is `>=` `--pass-threshold` (default `0.5`), else **fail**.
- An explicit error, or **no numeric score at all, is `error`**. An unscored case is not evidence, so it fails closed. Nothing is `skipped`.
- With `--score NAME` (repeatable), only the named scores count; any other score (a 1–5 user-feedback rating, a latency score) is ignored without validation, and a case missing a named score is `error`.
- `score` is the mean of the case's scores, and each score is kept as `metrics["score.<name>"]`, so a policy can put a threshold on one scorer (`metric: score.Factuality`).
- Scores must lie in `0..=1`, and a scorer name may appear only once per case.
- Duplicate case ids, malformed JSON, or a JSON key the importer reads appearing twice are rejected.

## Braintrust

Pass an experiment's events: the `/fetch` output, an array of events, or JSONL.

- Each **root span** is one case. Its scores are the root's own `scores` plus those of its scorer spans (`span_attributes.type: "score"`), which is where the SDK's `Eval()` logs each scorer's result. Other child spans (task, LLM calls) are ignored.
- The case id is `metadata.cloakpipe_case_id`, else `metadata.case_id`, else the dataset record (`origin.id` of a dataset `origin`, or `dataset_record_id` from older SDKs). Row ids change between runs, so an event with none of these is rejected.
- Run the experiment with **one trial** (`trial_count`/`trialCount` 1): every trial is its own root span with the same case id, which is rejected as a duplicate.
- `metadata.critical: true` marks a case critical.
- `error` on the root or a scorer span, or a scorer that crashed (`metadata.scorer_errors`), makes the case `error`.
- `metrics.start`/`metrics.end` become `durationMs`; token counts become `metrics.tokens.*`.

Fetch with the REST API (bearer token; follow `cursor` for more than one page, or flatten pages to JSONL):

```bash
curl -sf -H "Authorization: Bearer $BRAINTRUST_API_KEY" \
  "https://api.braintrust.dev/v1/experiment/$EXPERIMENT_ID/fetch?limit=1000" > experiment.json
# More pages: repeat with &cursor=<.cursor of the previous page>, then
#   jq -c '.events[]' page-*.json > experiment.jsonl
cloakpipe eval import --braintrust experiment.json --release release.yaml \
  --suite support-critical@23 --covers privacy,functional --critical 'privacy::*' --out run.json
```

## Langfuse

Pass a dataset run and the scores of its traces.

- Each run item is one case with id `datasetItemId`.
- A score joins an item by `traceId` (trace scores, or scores of the item's own `observationId`).
- `NUMERIC` scores count as-is, `BOOLEAN` scores count as 0/1; `CATEGORICAL`, `TEXT` and `CORRECTION` scores are ignored.
- Scores must come from `GET /api/public/v2/scores`; v3 output is rejected.
- Every page the listing's `meta.totalPages` announces must be included. A missing page is rejected, since it could hold a failing score. A score id repeated with different contents (pages fetched at different times) is rejected: fetch again.
- Langfuse has no critical flag: use `--critical`.

Fetch with the public API (basic auth `public key:secret key`; URL-encode dataset and run names). Scores are listed at most 100 per page; fetch every page of each trace's scores and pass them as an array of pages (`jq -s`):

```bash
set -o pipefail
lf() { curl -sSf -u "$LANGFUSE_PUBLIC_KEY:$LANGFUSE_SECRET_KEY" "$LANGFUSE_HOST$1"; }
lf "/api/public/datasets/support-golden/runs/support-agent-184-golden" > lf-run.json
jq -r '.datasetRunItems[].traceId' lf-run.json | sort -u | while read -r t; do
  page=1
  while :; do
    lf "/api/public/v2/scores?traceId=$t&limit=100&page=$page" > lf-page.json || exit 1
    cat lf-page.json
    [ "$page" -ge "$(jq '.meta.totalPages' lf-page.json)" ] && break
    page=$((page + 1))
  done
done | jq -s . > lf-scores.json
cloakpipe eval import --langfuse-run lf-run.json --langfuse-scores lf-scores.json \
  --release release.yaml --suite support-critical@23 --covers privacy,functional \
  --critical 'privacy::*' --pass-threshold 0.7 --score correctness --score pii_leak_free --out run.json
```

> **Langfuse deprecation.** `GET /api/public/datasets/{dataset}/runs/{run}` is deprecated by Langfuse: on Langfuse Cloud it is scheduled for removal on 2026-11-16 (self-hosted: with the v4 upgrade), when dataset runs become experiments (`/api/public/experiments`). The importer does not read the experiments API yet <span class="badge building">Building</span>; until it does, `--langfuse-run` needs a deployment that still serves dataset runs.

## Upload to CloakPipe Cloud

<span class="badge cloud">Cloud</span> Instead of running the importer yourself, upload the raw report to the release in CloakPipe Cloud. The server converts it with the same importer and the same rules as `cloakpipe eval import`, and stores the run against the release.

```text
POST /v1/agents/{agent}/releases/{hash}/runs/import    X-CloakPipe-Key (unscoped key, CI)
POST /api/agents/{agent}/releases/{hash}/runs/import   dashboard session
```

The body is JSON or `multipart/form-data`. `format` is `junit`, `braintrust`, `langfuse` or `native`; the other fields mirror the CLI flags (`suite`, `covers`, `critical`, `passThreshold`, `scoreNames`, `runId`, `tool`, `dataset`), with the report in `content` (Langfuse: `runContent` and `scoresContent`). From CI:

```bash
RELEASE=$(cloakpipe release hash release.yaml)
cloakpipe release register release.yaml       # CLOAKPIPE_API_URL, CLOAKPIPE_API_KEY
curl -fsS -X POST "$CLOAKPIPE_API_URL/v1/agents/support-agent/releases/$RELEASE/runs/import" \
  -H "X-CloakPipe-Key: $CLOAKPIPE_API_KEY" \
  -F format=junit -F suite=support-critical@23 \
  -F covers=functional -F covers=privacy -F 'critical=privacy::*' \
  -F tool=pytest -F content=@report.xml
```

- `201` stored, `200` the identical run was already stored (re-uploading is idempotent). The response lists warnings that do not block the upload, such as skipped cases or a `critical` pattern that matched nothing.
- `422` the importer rejected the content, with the issues; nothing is stored. A Braintrust upload must contain every page of the experiment: a single fetch page that still has a `cursor` is refused.
- `400` an ambiguous request (a missing or whitespace-padded field, a field that does not apply to the format), `403 runtime_key` for a key scoped to an agent and environment (runtime keys cannot supply evidence), `413` over 8 MiB.

For Braintrust and Langfuse, the score rules used (`passThreshold`, `scoreNames`) are recorded on the stored run, so a certification built on it shows how scores were read.

In the dashboard: **Releases → Details → Upload evaluation**.

## Next

Feed the runs to [`cloakpipe release certify`](/docs/certification#certify).
