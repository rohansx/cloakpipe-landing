---
layout: ../../layouts/Docs.astro
title: Evidence & verification
description: The signed decision ledger, its entry format, anchoring epochs with RFC 3161 and Sigstore Rekor, the tar audit pack and how an auditor verifies it offline with cloakpipe verify.
---

# Evidence & verification

<span class="badge oss">v0.12</span> Every decision the gate makes is one entry in a **decision ledger**: hash-chained, signed with Ed25519 one entry at a time, and free of argument values. On a schedule, the gate seals new entries into numbered **epochs** and has each one timestamped by an RFC 3161 authority and logged in Sigstore Rekor. An auditor gets one tar file and checks all of it offline, without trusting the operator.

## The decision ledger

`cloakpipe mcp-proxy` writes the ledger **by default**, to `$CLOAKPIPE_HOME/ledger.db` (`~/.cloakpipe/ledger.db`), or to `--ledger-db` / `CLOAKPIPE_LEDGER_DB`. `--no-ledger` turns it off, with a warning.

An entry is written **before** its call is forwarded or answered. If it cannot be written, the call is refused as `fail_closed` and never reaches the tool, in shadow mode too.

What gets an entry:

- every `tools/call` decision: `allow`, `deny` or `require_approval`, including messages refused unread;
- side-effect outcomes: `committed`, `failed`, or `unknown` when the tool went away before answering;
- replays answered from the operations store;
- each `cloakpipe operations reconcile`.

An entry is one flat JSON object (`cloakpipe ledger entries` prints them one per line):

```json
{"kind":"cloakpipe.decision/v1","seq":1,"ts":"2026-10-27T11:24:34Z","event":"call",
 "release":"sha256:c55889deb72d677a13ef2962ba7d6ae97d7a13391c9e484484fde9bb084fb0fa","tool":"send_email",
 "args_fingerprint":"hmac-sha256:3a0a0a2fca96274d768bba367ae4a1ca2598a0aef1e4bf8eb5b219d16c08fec8",
 "decision":"deny","reason":"scope_mismatch","path":"/to",
 "policy_version":"sha256:c55889deb72d677a13ef2962ba7d6ae97d7a13391c9e484484fde9bb084fb0fa",
 "policy_digest":"sha256:fef22029e4619812be1ee292c7aa4b83a1acf754d21b5f59d19658d8fcb1ba3b",
 "mode":"enforce","task_id":"t-1042","operation_id":null,"approval":null,"outcome":null,"forwarded":false,
 "signer":"ed25519:96ab1aee2dfe4290","prev_hash":"8234f9f5…","entry_hash":"290a7223…","sig":"c178e976…"}
```

| Field | Meaning |
|---|---|
| `seq`, `ts` | position in the ledger (from 0, no gaps) and time |
| `event` | `call`, `replay`, `outcome` or `reconcile` |
| `release`, `policy_version` | the manifest digest |
| `policy_digest` | the SHA-256 of the Cedar policy file, or null without one |
| `tool`, `path` | the tool name, and the argument path a refusal names (never a value) |
| `args_fingerprint` | the call fingerprint keyed with HMAC-SHA256 under a key derived from the gate signing key. A plain hash of low-entropy arguments could be guessed; keyed, only the key holder can link an entry to a call. |
| `decision`, `reason` | `allow`, `deny` or `require_approval`, and the refusal code (or `ok`) |
| `mode`, `forwarded` | `enforce` or `shadow`, and whether the call reached the tool |
| `task_id`, `operation_id`, `approval` | the task, the side-effect operation, and the SHA-256 of the approval receipt that allowed the call |
| `outcome` | `committed`, `failed`, `unknown`, or null |
| `prev_hash`, `entry_hash`, `sig`, `signer` | the chain and the signature (below) |

`entry_hash` is SHA-256 of `cloakpipe.decision.v1`, a newline, and the entry without `entry_hash` and `sig` as JSON with sorted keys and no whitespace. `prev_hash` is the previous entry's `entry_hash` (64 zeros for `seq` 0). `sig` is an Ed25519 signature over the 32 bytes of `entry_hash` by the gate signing key that `signer` names. Editing, removing or reordering an entry breaks the chain; forging one needs the gate key. See [Keys](/docs/keys).

The ledger never holds argument values, results, or a plain hash of the arguments.

## Anchoring epochs

The chain and signatures show that entries were not changed after they were signed. They do not show **when** they were signed, and the operator holds the key. Anchoring adds evidence from two outside services:

```bash
cloakpipe mcp-proxy --upstream "…" --manifest cloakpipe.manifest.yaml \
  --anchor-every 500 --anchor-interval 10m
```

- A background thread, never the request path, seals the entries no epoch covers yet into the next epoch once N are waiting (`--anchor-every`) or the interval has passed with anything new (`--anchor-interval`).
- Epoch `n` covers `seq` `first_seq..last_seq`, starting right after epoch `n-1`. Its head records the `entry_hash` of its last entry (which commits to every earlier entry through the chain), the previous epoch's hash and the seal time, and is signed by the gate key.
- Each head is timestamped by an RFC 3161 authority (default `https://freetsa.org/tsr`, `--tsa`) and logged in Sigstore Rekor (default `https://rekor.sigstore.dev`, `--rekor`). `--no-tsa` or `--no-rekor` skips one. The answers are verified before they are kept, and stored with the epoch in the ledger database.
- A failed anchor prints `cloakpipe: anchor.failed epoch=<n> seq=<a>..<b> anchor=rfc3161|rekor error=…` on stderr and is retried, also by the next run if the gate stops first. Success prints `anchor.ok`.

What leaves your machine: the SHA-256 of each signed epoch head goes to the timestamp authority, and the head's hash, its signature and the gate's public key go to Rekor. **A Rekor entry is public and permanent.** No arguments, results or entry contents are sent. Use your own TSA and Rekor instance with `--tsa`, `--tsa-root`, `--rekor` and `--rekor-key` if you do not want public entries.

## Audit pack

`cloakpipe ledger export` writes one plain tar file for an auditor:

```bash
cloakpipe ledger export --out audit-pack.tar                 # everything
cloakpipe ledger export --out audit-pack.tar --since 30d     # or --since 2026-10-01 --until 2026-10-31
```

| File | Contents |
|---|---|
| `pack.json` | the pack manifest: every file with its SHA-256, signed by the gate key |
| `entries.jsonl` | the decision entries, one per line |
| `gate.pub.json` | the gate public key |
| `manifests.json` | the manifest and policy digests the entries name |
| `anchors/epoch-<n>.json` | each epoch head with its RFC 3161 token and Rekor entry |

A `--since` / `--until` range widens to whole epochs, so every epoch in the pack can be checked against its entries.

## Verifying a pack

```bash
cloakpipe verify audit-pack.tar --key <gate public key: 64 hex chars, or a key file>
```

On a pack with three anchored epochs, the report looks like this:

```text
pack: 7 files, signed by ed25519:… (pinned), OK
entries: 1204 (seq 0..1203), chain OK, signatures OK
anchors: 3 epochs (seq 0..1203), RFC3161 OK (3/3), Rekor OK (3/3 inclusion proofs)
gaps: none
denials: 41, approvals: 6 required, 5 granted, unknown side effects: 1, reconciled: 1
manifests: sha256:…
result: OK
```

`cloakpipe verify` trusts nothing in the pack:

- **Pin the key.** Without `--key` it checks against the pack's own key and says `not pinned`, which proves integrity but not who signed. Get the gate's public key from the operator out of band (`cloakpipe ledger public-key` prints it). Repeat `--key` for rotated keys.
- **Anchors** must chain to `--tsa-root` (default: the freetsa.org and DigiCert roots built in) and verify under `--rekor-key` (default: the rekor.sigstore.dev key built in), with an RFC 6962 inclusion proof for each Rekor entry. No entry and no seal time in an epoch may be later than that epoch's anchor time, plus `--clock-skew-secs` (default 60).
- **Gaps** are a missing epoch number, entries no epoch covers before or between epochs, or an epoch with no anchor. Entries after the last epoch are listed as `unanchored` and fail only with `--require-anchors`.

Any failure or gap exits 1. The same checks are in the standalone `cloakpipe-verify` binary (`cloakpipe-verify pack audit-pack.tar`), built from the `cloakpipe-verify` crate alone, so an auditor does not need the gate:

```bash
git clone https://github.com/rohansx/cloakpipe && cd cloakpipe
cargo build --release -p cloakpipe-verify
./target/release/cloakpipe-verify pack audit-pack.tar --key <gate public key>
```

To check just the entries, without a pack: `cloakpipe ledger entries > entries.jsonl`, then `cloakpipe-verify decisions entries.jsonl --key <gate public key>`.

## What the evidence does and does not prove

It proves that the holder of the gate key recorded these decisions in this order, that none was changed or removed afterwards, and, with anchors, that each epoch existed by its anchor time. It does not prove that the gate saw every call the agent made (a call that bypassed the gate leaves no entry), or that the operator ran the gate honestly. See the [threat model](/docs/threat-model).

Not checked by the verifier: certificate revocation for the TSA (CRL/OCSP needs the network) and consistency between Rekor checkpoints (that the log did not fork; a log monitor does that).

## Older evidence bundles

<span class="badge oss">v0.11</span> v0.11 recorded gate hops in the ledger's PII-hop records and exported JSON evidence bundles that `cloakpipe anchor` sealed under one batch head. Those still verify with `cloakpipe-verify all bundle.json` (and `chain`, `sigs`, `anchors`, `proofs`, `manifest`). In v0.12, those hop records are written only with `--transform pii`, and gate decisions go to the decision ledger above. The format is specified in [docs/ANCHORING.md](https://github.com/rohansx/cloakpipe/blob/main/docs/ANCHORING.md).

## Source

- Ledger, epochs and export: [`crates/cloakpipe-ledger`](https://github.com/rohansx/cloakpipe/tree/main/crates/cloakpipe-ledger)
- Verifier: [`crates/cloakpipe-verify`](https://github.com/rohansx/cloakpipe/tree/main/crates/cloakpipe-verify)
- TSA and Rekor clients: [`crates/cloakpipe-anchor`](https://github.com/rohansx/cloakpipe/tree/main/crates/cloakpipe-anchor)
