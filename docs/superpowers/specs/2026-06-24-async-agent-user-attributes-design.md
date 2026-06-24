# Async Agent USER.md Attribute Extraction Design

## Context

The current plugin extracts public USER.md tags with local code heuristics in
`src/user-md-attributes.ts`. This works for simple technical tokens such as
`P2P`, but it can also publish weak or irrelevant tags from natural language,
for example `专注于`, `了解`, or `随时告诉我`.

The desired behavior is to let OpenClaw use the user's configured agent/API
model to extract more precise public attributes, while keeping libp2p discovery
fast and reliable.

## Goals

- Do not block peer discovery or connection setup on model calls.
- Use the OpenClaw-configured agent/model path for USER.md extraction.
- Keep libp2p-mesh from storing provider API keys or selecting models directly.
- Preserve the existing `instance-announce` upsert model.
- Keep `user-profile.json` manual attributes and USER.md-derived tags in one
  public attribute snapshot.
- Make model failure non-fatal.
- Update agent-facing prompt guidance so tools interpret public and local
  attributes correctly.

## Non-Goals

- Add a separate attribute-delta protocol message.
- Let ordinary conversation agents read USER.md and decide what to publish.
- Add first-version per-plugin model override settings.
- Change local peer labels or `scope="local"` behavior.

## Recommended Flow

### 1. Send a Fast Base Announce

When the gateway starts or connects to a peer, it immediately sends a normal
`instance-announce` with identity and network fields only:

```json
{
  "instanceId": "ypp-n206-System-Product-Name@MCowBQYDK2Vw.ea04bf61",
  "peerId": "12D3KooWJG3qqCpaQCtkMpXvVyttFVr916dfVnEC5kVTGCUvTwRd",
  "instanceName": "ypp-n206-System-Product-Name",
  "pubkey": "MCowBQYDK2Vw...",
  "multiaddrs": ["/ip4/127.0.0.1/tcp/37967/p2p/12D3Koo..."],
  "announcedAt": 1782303636721
}
```

The base announce omits `userPublicAttributes`. It must not send an empty array
as a placeholder, because an absent field means "attributes were not included in
this announce", while an empty array means "the current public attribute
snapshot is intentionally empty."

### 2. Extract USER.md Attributes Asynchronously

After base announce, the gateway starts an asynchronous refresh job:

1. Read `~/.openclaw/workspace/USER.md` or the `OPENCLAW_STATE_DIR` equivalent.
2. Compute a stable content hash.
3. If the hash matches a valid cache entry, reuse cached USER.md attributes.
4. If the hash changed, call the OpenClaw runtime's configured agent/model
   extraction capability.
5. Validate the returned JSON attributes.
6. Store the validated result in a cache file, keyed by USER.md hash.

The plugin should request extraction through an OpenClaw runtime capability. It
should not read provider credentials, choose providers, or call OpenAI-compatible
APIs directly. By default, extraction uses the current OpenClaw configured
agent/API model.

The first implementation should introduce a small injectable extractor
interface. Production wiring calls the OpenClaw runtime capability when it is
available. Tests can inject a deterministic extractor. If the current OpenClaw
SDK does not yet expose the needed runtime method, production wiring should
return "unavailable" and skip USER.md-derived tags instead of calling model
providers directly.

### 3. Merge USER.md Tags and Profile Attributes

After USER.md extraction completes, rebuild the public attribute snapshot:

- USER.md extracted tags use `source: "USER.md"`.
- `user-profile.json` structured attributes use `source: "profile"`.
- Existing normalization and dedupe rules still apply.

Example snapshot:

```json
[
  { "kind": "tag", "value": "P2P", "label": "P2P", "source": "USER.md" },
  {
    "kind": "structured",
    "key": "group",
    "value": "实验室",
    "label": "group: 实验室",
    "source": "profile"
  }
]
```

### 4. Broadcast a Full Attribute Announce

When the merged snapshot is ready, send another complete `instance-announce`.
This second announce includes all identity/network fields and the complete
`userPublicAttributes` snapshot:

```json
{
  "instanceId": "ypp-n206-System-Product-Name@MCowBQYDK2Vw.ea04bf61",
  "peerId": "12D3KooWJG3qqCpaQCtkMpXvVyttFVr916dfVnEC5kVTGCUvTwRd",
  "instanceName": "ypp-n206-System-Product-Name",
  "pubkey": "MCowBQYDK2Vw...",
  "multiaddrs": ["/ip4/127.0.0.1/tcp/37967/p2p/12D3Koo..."],
  "userPublicAttributes": [
    { "kind": "tag", "value": "P2P", "label": "P2P", "source": "USER.md" },
    {
      "kind": "structured",
      "key": "group",
      "value": "实验室",
      "label": "group: 实验室",
      "source": "profile"
    }
  ],
  "announcedAt": 1782303636721
}
```

Receivers continue to upsert by `instanceId`. This keeps the protocol
idempotent, handles deletion naturally by replacing the whole snapshot, and
avoids new delta merge rules.

### 5. Refresh After Profile Changes

When a user runs:

```bash
openclaw libp2p-mesh profile
```

and saves changes to `user-profile.json`, the gateway should refresh public
attributes and rebroadcast a full `instance-announce` snapshot. The refresh uses
cached USER.md extraction when the USER.md hash has not changed, then merges the
new profile attributes.

The first implementation should refresh immediately when the profile command
runs in the same plugin runtime as the gateway. If the CLI process cannot reach
the running gateway, the saved profile still takes effect on the next startup,
peer connection, or scheduled attribute refresh. This keeps profile updates
eventually consistent without requiring a new cross-process control channel in
the first version.

## Validation and Safety

Model output must be treated as untrusted data:

- Parse only strict JSON.
- Accept only `UserPublicAttribute[]`-compatible entries.
- For USER.md extraction, accept only tag attributes in the first version.
- Enforce max count and max value length.
- Drop empty, sentence-like, duplicate, or schema-invalid values.
- Normalize values using existing `user-attributes.ts` helpers.
- Never allow model output to set `source: "profile"`.
- Never fail peer connection because extraction failed.

On extraction failure, log a warning and use the best available fallback:

1. Existing valid USER.md extraction cache for the same file hash, if present.
2. No USER.md tags.

Profile attributes should still be included when available.

The current heuristic extractor should remain only as a local implementation
utility until it is replaced, but the async agent extraction flow should not use
heuristic USER.md tags as its public fallback. This avoids publishing the same
low-value tags the feature is meant to remove.

## Prompt Guidance Changes

`src/prompt-config.ts` should be updated to explain the new behavior:

- `source="USER.md"` means gateway asynchronously extracted public tags from
  USER.md using the OpenClaw-configured agent/API model.
- `source="profile"` means the user manually configured public structured
  attributes with `openclaw libp2p-mesh profile`.
- A base announce may omit `userPublicAttributes`; this means attributes were
  not included in that announce, not necessarily that the user has no public
  attributes.
- `scope="public"` matches remote `userPublicAttributes`, including USER.md
  extracted tags and profile attributes.
- `scope="local"` matches only local labels from `openclaw libp2p-mesh labels`.
- `scope="all"` matches both public attributes and local labels.
- Ordinary conversation agents should not read USER.md themselves to decide
  public attributes. Extraction is a gateway background responsibility.

## Testing Strategy

- Unit test base announce construction omits `userPublicAttributes`.
- Unit test asynchronous refresh sends a second full announce with merged
  attributes.
- Unit test USER.md hash cache avoids repeated extractor calls.
- Unit test extractor failure does not block base announce.
- Unit test invalid model output is dropped.
- Unit test profile changes rebuild and rebroadcast the full snapshot.
- Prompt tests should assert the updated source and scope guidance.

## First-Version Decisions

- Define a local injectable extractor interface inside libp2p-mesh and wire it
  to an OpenClaw runtime extraction capability when available.
- Do not add direct provider API calls or plugin-owned model credentials.
- Do not publish heuristic USER.md tags as the async extraction fallback.
- Keep profile updates eventually consistent when the CLI cannot notify the
  running gateway process.
