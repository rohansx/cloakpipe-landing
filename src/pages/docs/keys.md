---
layout: ../../layouts/Docs.astro
title: Keys
description: The keys CloakPipe uses - the gate signing key, approver keys and the anchoring trust roots - where each lives, who should hold it, and how to rotate it.
---

# Keys

<span class="badge oss">v0.12</span> The gate uses three kinds of key material. All signing keys are Ed25519 and are files in the format `cloakpipe release keygen` writes: `{ "keyid": "ed25519:…", "publicKey": "<64 hex>", "privateKey": "<hex>" }`. Keys are identified by `keyid`, which is derived from the public key.

```bash
cloakpipe release keygen --out approver.json     # written 0600, never overwrites; prints only the public part
```

| Key | Signs | Held by | Given to the gate with |
|---|---|---|---|
| Gate signing key | every ledger entry, every epoch head, every audit pack, and the Rekor entries | the gate host | `--signing-key`, `CLOAKPIPE_SIGNING_KEY`, or `$CLOAKPIPE_HOME/gate.key` |
| Approver keys | approval receipts (`cloakpipe approve`) | the people or service that approve calls | public part only, `--approver-key` (repeatable) |
| Anchoring trust roots | nothing: they check TSA and Rekor answers | the verifier | `--tsa-root`, `--rekor-key` (built-in defaults) |

## The gate signing key

Without `--signing-key` or `CLOAKPIPE_SIGNING_KEY`, the gate uses `$CLOAKPIPE_HOME/gate.key` (`~/.cloakpipe/gate.key`). On first use it creates that file, readable by its owner only, and prints the public key once on stderr. Print it again any time:

```bash
cloakpipe ledger public-key
```

```json
{ "keyid": "ed25519:96ab1aee2dfe4290", "publicKey": "863852d34f35d104ed1b5462887caeef5de458330f62d6c328acfde0ff8243de" }
```

Give auditors the public key out of band, before they need it, so they can pin it: `cloakpipe verify audit-pack.tar --key 8638…43de`, or save the output above as `gate.pub.json` and pass `--key gate.pub.json`. A pack verified without `--key` is only checked against the key inside it, and the report says `not pinned`.

The same key also derives the HMAC key behind each entry's `args_fingerprint`, so whoever holds it can test guesses of arguments against the ledger. Treat it as secret:

- keep it on the gate host only, owner-readable, out of backups that others can read and out of synced folders;
- for a gate that runs in a container, mount it as a secret and point `CLOAKPIPE_SIGNING_KEY` at it, rather than letting each container create its own;
- use one key per gate deployment, so a ledger's `signer` tells you which gate wrote it.

### Rotating it

1. Generate a new key with `cloakpipe release keygen --out gate-2026-11.key` and publish its public key to your auditors.
2. Anchor what the old key signed: run the gate with anchoring until the last epoch is anchored, then export a pack (`cloakpipe ledger export`).
3. Restart the gate with `--signing-key gate-2026-11.key`. New entries are signed by the new key and name it in `signer`; old entries keep their old signatures.
4. Auditors verify with both keys pinned: `cloakpipe verify audit-pack.tar --key <old> --key <new>`.

If a key may have leaked, entries signed after that point cannot be trusted on the signature alone. Anchored epochs before the leak still stand, which is why anchoring often matters. See the [threat model](/docs/threat-model#host-compromise). Revoking a key inside the ledger, so a verifier refuses its later entries automatically, is <span class="badge building">Roadmap</span>.

## Approver keys

Each approver has their own key and keeps the private part; the gate only needs the public part:

```bash
cloakpipe release keygen --out alice.json
jq '{keyid, publicKey}' alice.json > alice.pub.json      # give this to the gate
cloakpipe mcp-proxy … --approvals approvals/ --approver-key alice.pub.json --approver-key bob.pub.json
```

A receipt is accepted only if one of the `--approver-key` keys signed it and its `approver` field names that key. To rotate, add the new public key, restart the gate, then remove the old one; receipts signed by a key that is no longer listed are refused as `approval_invalid`. Receipts are short-lived by design (`--expires`, capped by the tool's `ttl`), so a receipt signed with a key that later leaks is only usable until it expires; new ones from that key stop working once you remove it.

Approver identities are key ids, not names like `slack:@alice`. Mapping people to keys, and keeping approver keys in a broker or hardware token, is up to you today; an approval broker is <span class="badge building">Roadmap</span>.

## Anchoring trust roots

Anchors are checked against roots the verifier chooses, never against anything in the pack:

- **RFC 3161**: the timestamp authority's certificate must chain to a root in `--tsa-root` (PEM). Built in: the freetsa.org root and the DigiCert root.
- **Rekor**: the log's entries and checkpoints must verify under `--rekor-key` (PEM). Built in: the public key of `rekor.sigstore.dev`.

Pass `--tsa-root` and `--rekor-key` to the gate when you use your own TSA or Rekor instance, and to `cloakpipe verify` when you check a pack from such a gate. Fetch roots once, check their fingerprints out of band, and pin them. The verifier does not check TSA certificate revocation.

## Roadmap

- <span class="badge building">Roadmap</span> Gate signing keys in a KMS or HSM (AWS KMS, GCP KMS, PKCS#11), so a host compromise does not expose the key.
- <span class="badge building">Roadmap</span> Signed key rotation and revocation records in the ledger.
- <span class="badge building">Roadmap</span> Approver keys held by an approval broker, with human identities bound to keys.
- <span class="badge building">Roadmap</span> Signed manifests, verified by the gate at start-up.
