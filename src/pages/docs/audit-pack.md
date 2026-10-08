---
layout: ../../layouts/Docs.astro
title: Audit packs
description: The signed per-release audit pack - producing it with the CLI or downloading it from CloakPipe Cloud, verifying it offline with cloakpipe-verify release-pack, and what it does not prove.
---

# Release audit packs <span class="badge oss">Main</span>

A **release audit pack** is the one file a security reviewer gets for an Agent Release: a signed JSON document with the manifest, the evaluation runs, the certifications, the governance history and the runtime evidence ledger of that exact release. It verifies offline, with no network access and no CloakPipe account.

| Section | Content |
|---|---|
| `spec.release` | the manifest and its `sha256:` hash |
| `spec.evaluationRuns` | native `EvaluationRun`s of this release |
| `spec.certifications` | DSSE certification envelopes, blocked decisions included |
| `spec.governance.events` | registration, promotions, supersedes, certification revocations and sentinel breaches, in time order |
| `spec.ledgerExports` | signed ledger exports (`cloakpipe.bundle` v4), unmodified, with any anchor receipts |
| `spec.limitations` | caveats the exporter declares |

The pack is signed with Ed25519 over the [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785) canonical form of `apiVersion`, `kind` and `spec` (`cloakpipe.co/v1alpha1`, `ReleaseAuditPack`), so nothing in the file is outside the signature. Packs issued under the legacy `cloakpipe.dev/v1alpha1` still verify.

## Produce a pack with the CLI

```bash
cloakpipe release keygen --out exporter.key.json > exporter.pub.json   # prints only the public part
cloakpipe release audit-pack --manifest release.yaml \
  --run run.json --certification release.cert.dsse.json \
  --ledger-export ledger.json --events events.json \
  --key exporter.key.json --out release.audit-pack.json
```

`--run`, `--certification`, `--ledger-export` and `--limitation` are repeatable; `--exporter` names who assembled the pack (default `cloakpipe-cli`) and `--now` sets its creation time. `events.json` is a JSON array of governance events and must include the `release_registered` event, for example:

```json
[{ "type": "release_registered", "at": "2026-10-07T10:00:00Z", "actor": "ci:acme/support",
   "agent": "support-agent", "version": "184" }]
```

Other event types are `release_promoted`, `release_superseded`, `certification_revoked` and `sentinel_breach`. The command refuses inputs that could never verify (a run or certification for another release, a ledger export with no hop bound to this release, an event after the creation time). Exit **0** written (prints the digest), **1** refused, **2** usage or I/O.

## Verify a pack

```bash
cloakpipe-verify release-pack release.audit-pack.json \
  --trust exporter.pub.json --ledger-trust ledger.pub.json --cert-trust issuer.pub.json
```

Each role has its own keys, and each flag takes one key file (`release keygen` format; `{"keyid", "publicKey"}` is enough), repeated for more keys. One key may not hold two roles, so the exporter cannot certify its own promotions and a ledger key cannot sign governance history.

| Flag | Trusts | Without it |
|---|---|---|
| `--trust` | the exporter that signed the pack | required |
| `--ledger-trust` | ledger export signers | a pack with ledger exports fails |
| `--cert-trust` | certification issuers | no certification verifies, so a normal production promotion fails |

`--now RFC3339` verifies as of a given time (default: now), `--json` prints a machine-readable report. Exit **0** pass, **1** failed, **2** usage, an unreadable file, or a pack over 256 MiB.

What is checked, all in one run with every failure reported:

- **Document and signature**: strict JSON, no unknown fields, the digest recomputes and the signature verifies under a `--trust` key.
- **Release**: the manifest is certifiable and hashes to `release.hash`; every run and certification is for this release.
- **Certifications** verify against `--cert-trust`. An invalid one fails the pack; expired or revoked ones are reported as history.
- **Governance**: events in time order, exactly one registration first, known environment names spelled exactly, every revocation names a certification in the pack.
- **Promotions**: a promotion to `production` needs a certification valid at that instant, or `breakGlass` with a reason (passes with a warning).
- **Sentinels**: a revoking sentinel breach must be matched by revocations of every certification it should have revoked.
- **Ledger**: each export's chain, signatures, anchor receipts, inclusion proofs and manifest verify, its signer is a `--ledger-trust` key, and at least one hop is bound to this release.

The report starts with `PASS` or `FAIL`, then the release, the environment status and a timeline of registration, promotions, certifications, revocations, breaches and runtime hops.

## What a pack does not prove

- **Governance is exporter-attested.** Registrations, promotions, revocations and sentinel breaches are signed only by the exporter's pack signature, not by the people or keys they name. The pack says so and the verifier prints it. Certifications and ledger hops are signed by their own issuers.
- **Completeness.** An exporter can leave out runs, certifications, events or whole ledger exports.
- **Revocations** are exporter-attested events; there is no signed revocation statement format yet.
- **When the pack was made.** The pack itself is not anchored; anchor receipts exist only inside the embedded ledger exports.

The full format and every check are in [docs/AUDIT_PACK.md](https://github.com/rohansx/cloakpipe/blob/main/docs/AUDIT_PACK.md).

## CloakPipe Cloud

<span class="badge cloud">Cloud</span> CloakPipe Cloud builds a pack for any registered release on demand, with core's own builder, and verifies it with core's verifier against its published keys before serving it. A pack that would not verify is not served.

```text
GET /v1/agents/{agent}/releases/{hash}/audit-pack     X-CloakPipe-Key (unscoped key)
GET /api/agents/{agent}/releases/{hash}/audit-pack    dashboard session
GET /v1/audit-pack/keys                               public: exporter, ledger and certification keys
```

In the dashboard, open **Agents → Releases** and click **Audit pack** on a release. Save the bytes exactly as served.

- **Pin the keys once**, through a channel you trust, and verify every later pack against the pinned copy. Fetching the keys from the same server just before verifying proves only that the server agrees with itself.
- **The ledger export is the whole chain** of the account: a hash chain cannot be cut to one release. It holds no prompt text or personal data, but it shows the timing, entity categories and policy decisions of every agent and release of the account. Share a pack only with someone you would show that timeline to.
- **No anchoring.** CloakPipe Cloud does not anchor its ledger yet, so cloud packs carry no anchor receipts; each pack with a ledger export says so in `spec.limitations`.
- A pack whose embedded chain exceeds 100,000 records is refused (`422 audit_pack_too_large`).
