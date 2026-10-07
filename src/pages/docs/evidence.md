---
layout: ../../layouts/Docs.astro
title: Evidence & verification
description: The hash-chained, signed evidence ledger, the standalone offline verifier, external anchoring with RFC 3161 and Sigstore Rekor, and cloud export and verify endpoints.
---

# Evidence & verification

Every hop CloakPipe handles produces evidence: a record in a **hash-chained ledger** whose batches are signed with Ed25519. An exported **bundle** can be checked by anyone with the standalone verifier, offline, without trusting CloakPipe.

## The ledger

<span class="badge oss">Main</span>

- **Hash chain.** Each record includes the hash of the one before it, with no sequence gaps. Editing, removing or reordering a record breaks the chain at that point.
- **Signatures.** Batch heads are signed with Ed25519, and the bundle's signed manifest authenticates the whole chain.
- **No PII.** A privacy hop records entity categories, a count and a random token, never raw text or PII.
- **Release binding**. Hops from [`mcp-proxy`](/docs/mcp-gate#evidence) with `--manifest` or `CLOAKPIPE_RELEASE` carry `release_hash` inside the signed bytes, so an auditor can see which release called which tool. In CloakPipe Cloud, release lifecycle events (for example `ReleasePromoted`, `CertificationRevoked`) and `POLICY_BLOCK` records are bound the same way.

## The offline verifier

<span class="badge oss">Main</span> `cloakpipe-verify` is a separate binary (crate `cloakpipe-verify`, Apache-2.0) with no dependency on `cloakpipe-ledger` or any other CloakPipe crate. A third party can clone only this crate, build it, and verify any bundle CloakPipe produces.

```bash
git clone https://github.com/rohansx/cloakpipe
cd cloakpipe
cargo build -p cloakpipe-verify      # binary: target/debug/cloakpipe-verify
```

```text
cloakpipe-verify chain    <bundle.json>   # hash chain unbroken, no seq gaps
cloakpipe-verify sigs     <bundle.json>   # Ed25519 batch-head signatures valid
cloakpipe-verify anchors  <bundle.json> [--tsa-root PEM] [--rekor-key PEM]   # anchor receipts, offline
cloakpipe-verify proofs   <bundle.json>   # inclusion proofs
cloakpipe-verify manifest <bundle.json>   # signed manifest
cloakpipe-verify all      <bundle.json> [--trust-key KEYID=HEX]... [--tsa-root PEM] [--rekor-key PEM]
cloakpipe-verify release-pack <pack.json> --trust KEYFILE ...                  # see Audit packs
```

Exit codes: **0** bundle verified, **1** verification failed (tamper, gap, bad signature), **2** usage error or the bundle could not be read.

On the sample bundle in the repository:

```text
$ cloakpipe-verify all crates/cloakpipe-verify/tests/fixtures/sample.bundle.json
OK  records=10 batch_signatures=0 anchors=0 inclusion_proofs=0 chain_tip=fe2c8f0b… WARNING signer not pinned (pass --trust-key to verify who signed)
```

### Pinning the signer

Without a pinned key, `all` checks the bundle against the key it carries: that proves integrity, not who produced it. `all` takes `--trust-key KEYID=HEX` (repeatable; HEX is the 64-hex-char Ed25519 public key), and the manifest must be signed by one of them:

```bash
cloakpipe-verify all bundle.json --trust-key "$KEYID=$PUBHEX"
```

## Export and verify in the cloud

<span class="badge cloud">Cloud</span>

| Endpoint | Auth | Does |
|---|---|---|
| `GET /api/evidence/export` | dashboard session | a signed evidence bundle of the caller's tenant ledger |
| `POST /api/evidence/verify` | none (public) | verifies a bundle; `200` with a summary (`records`, `signatures`, `anchors`, `proofs`, `manifest_ok`, `chain_tip`, `bundle_version`), or `400` naming the failure (e.g. `chain: record #1: hash mismatch`) |

The ledger signing key is set with `LEDGER_SIGNING_KEY` (hex, 32 bytes); without it the API uses an ephemeral key, which still verifies within a run because the public key is embedded in every bundle. `LEDGER_DB_PATH` sets where the ledger is stored. In the dashboard, the Compliance page exports and verifies the same bundles. The per-release [audit pack](/docs/audit-pack#cloakpipe-cloud) is a separate download.

## External anchoring

<span class="badge oss">Main</span> The chain and signed manifest prove records were not edited after the bundle was signed, but the operator holds the signing key. Anchoring proves **when** it was signed, with evidence from two independent services, so history cannot be back-dated or rewritten without detection.

`cloakpipe anchor` seals an exported, not yet sealed bundle under one **batch head** (a Merkle root over the record hashes, signed by the operator key, with an inclusion proof per record) and anchors the head at:

| Anchor | Proves | Default endpoint | Trust input |
|---|---|---|---|
| RFC 3161 timestamp | a timestamp authority signed the head's SHA-256 at `genTime` | `https://freetsa.org/tsr` | the TSA's root certificate, `--tsa-root` |
| Sigstore Rekor (v1 API) | a public append-only log integrated the head at `integratedTime`, covered by a signed tree head | `https://rekor.sigstore.dev` | the log's public key, `--rekor-key` |

```bash
# Trust inputs: fetch once and check the fingerprints out of band.
curl -sS https://freetsa.org/files/cacert.pem -o freetsa-root.pem
curl -sS https://rekor.sigstore.dev/api/v1/log/publicKey -o rekor.pub

# --key is the operator key that signed the bundle's manifest (release keygen format).
cloakpipe anchor bundle.json --key key.json \
  --tsa-root freetsa-root.pem --rekor-key rekor.pub --out anchored.json

cloakpipe-verify all anchored.json --tsa-root freetsa-root.pem --rekor-key rekor.pub \
  --trust-key "$KEYID=$PUBHEX"
```

`cloakpipe anchor` checks both answers offline and re-verifies the whole bundle before writing `--out`; it exits **0** anchored, **1** refused (nothing written), **2** usage or I/O. Other options: `--tsa-url` (for DigiCert, `http://timestamp.digicert.com` with the DigiCert Trusted Root G4), `--rekor-url`, `--no-tsa`, `--no-rekor`, `--batch-id`, `--timeout-secs`, `--clock-skew-secs` (default 60: the seal time is backed off so a slightly fast host clock does not look like back-dating). Each Rekor entry is **public and permanent**: it holds a hash of the head, a signature and the operator's public key, never record content.

Receipts carry the raw evidence (the DER timestamp response, the Rekor entry verbatim), so verification is entirely offline, and the verifier never takes the TSA or log identity from the bundle. It fails closed:

- A bundle with RFC 3161 (Rekor) receipts **fails** without `--tsa-root` (`--rekor-key`). Missing trust is never a skip.
- Supplying a trust input means the bundle must be anchored there: every batch head needs a verified receipt of that kind, and every record must lie in a head with a valid inclusion proof.
- **Back-dating**: no record time and no head seal time may be later than the anchored time, with no tolerance.
- **RFC 3161**: status granted, CMS signature (RSA ≥ 2048 or ECDSA P-256/P-384, SHA-2), message imprint equal to the head hash, nonce equal to the request's, a signer with the critical `timeStamping` extended key usage, and a certificate path to a `--tsa-root` CA where every certificate is valid at `genTime`.
- **Rekor**: log ID matches the key, signed entry timestamp, `hashedrekord` body signed (Ed25519ph) by the head's signer, RFC 6962 inclusion proof to the tree root, and a checkpoint signed by the log key naming the same root.

Not checked: certificate revocation (CRL/OCSP needs the network, so pin a specific root and check revocation out of band), and consistency between Rekor checkpoints (that the log did not fork; a monitor or witness does that). Rekor v2 and sealing new records incrementally in further batches are <span class="badge building">Building</span>. CloakPipe Cloud does not anchor its ledger yet; whoever holds the ledger signing key can anchor an exported bundle with the CLI. The full specification is [docs/ANCHORING.md](https://github.com/rohansx/cloakpipe/blob/main/docs/ANCHORING.md).

## Release audit packs

<span class="badge oss">Main</span> <span class="badge cloud">Cloud</span> A release audit pack is one signed JSON file per release with the manifest, evaluation runs, certifications, governance history and runtime ledger, verified offline with `cloakpipe-verify release-pack`. See [Audit packs](/docs/audit-pack).

## Source

- Ledger: [`crates/cloakpipe-ledger`](https://github.com/rohansx/cloakpipe/tree/main/crates/cloakpipe-ledger)
- Verifier: [`crates/cloakpipe-verify`](https://github.com/rohansx/cloakpipe/tree/main/crates/cloakpipe-verify)
- Anchoring clients: [`crates/cloakpipe-anchor`](https://github.com/rohansx/cloakpipe/tree/main/crates/cloakpipe-anchor)
- Specifications: [docs/ANCHORING.md](https://github.com/rohansx/cloakpipe/blob/main/docs/ANCHORING.md), [docs/AUDIT_PACK.md](https://github.com/rohansx/cloakpipe/blob/main/docs/AUDIT_PACK.md)
