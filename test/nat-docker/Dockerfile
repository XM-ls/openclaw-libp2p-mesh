# NAT-test Dockerfile for openclaw + openclaw-libp2p-mesh.
#
# Build context = /home/zkr/openclaw_add/ (parent of both repos).
# Built image bundles a complete openclaw + libp2p-mesh runtime so the
# resulting container can be started with `gateway run` and behaves like a
# real-world openclaw instance (CLI, plugin loader, channel registry, etc.).
#
# The image is heavy (full pnpm install + build) — expect ~5–10 min on the
# first build. Subsequent builds with Docker layer cache are fast.

FROM node:22-bookworm-slim AS build

# Switch apt to a Chinese mirror (清华 TUNA) — the default deb.debian.org is
# extremely slow from many CN networks (observed 17 kB/s during early dev),
# making the apt step the dominant cost of the whole build. Toggle back to
# the upstream by passing --build-arg APT_MIRROR=http://deb.debian.org/debian
ARG APT_MIRROR=http://mirrors.tuna.tsinghua.edu.cn/debian
RUN sed -i "s|http://deb.debian.org/debian|${APT_MIRROR}|g; s|http://deb.debian.org/debian-security|${APT_MIRROR}-security|g" /etc/apt/sources.list.d/debian.sources \
 || sed -i "s|http://deb.debian.org/debian|${APT_MIRROR}|g; s|http://deb.debian.org/debian-security|${APT_MIRROR}-security|g" /etc/apt/sources.list

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        git build-essential ca-certificates python3 openssh-client \
    && rm -rf /var/lib/apt/lists/*

# openclaw has a transitive git+ssh:// dependency (whiskeysockets/libsignal-node).
# Container has no ssh key, so rewrite git+ssh and ssh URLs to https so the
# anonymous clone works.
RUN git config --global url."https://github.com/".insteadOf "git@github.com:" \
 && git config --global url."https://github.com/".insteadOf "ssh://git@github.com/" \
 && git config --global url."https://github.com/".insteadOf "git+ssh://git@github.com/"

# pnpm version must match the openclaw repo's packageManager field
RUN npm install -g pnpm@11.1.0

# Use the npmmirror.com registry to dodge upstream npmjs.org timeouts when
# building from a network where US/EU registries are slow (common for CN
# campus / home broadband). Switch back to the upstream registry by passing
# --build-arg NPM_REGISTRY=https://registry.npmjs.org/
ARG NPM_REGISTRY=https://registry.npmmirror.com/
ENV npm_config_registry=${NPM_REGISTRY} \
    npm_config_fetch_timeout=600000 \
    npm_config_fetch_retries=10 \
    npm_config_fetch_retry_maxtimeout=600000 \
    NPM_CONFIG_REGISTRY=${NPM_REGISTRY}

WORKDIR /app

# ---- Plugin ----
# Copy plugin source first because it's tiny and rarely changes — keeps the
# openclaw layer cache hot.
COPY openclaw-libp2p-mesh/ /app/openclaw-libp2p-mesh/
# --ignore-scripts sidesteps pnpm 10/11's ERR_PNPM_IGNORED_BUILDS when run
# in a fresh container (the host already has approvals; CI/docker doesn't).
# Our build only uses tsc; we don't need any dep's postinstall to fire.
# rm -f pnpm-lock.yaml so the registry override actually takes effect — pnpm
# otherwise honours URLs baked into the lockfile (registry.npmjs.org).
RUN cd /app/openclaw-libp2p-mesh \
    && rm -rf node_modules dist pnpm-lock.yaml \
    && pnpm install --frozen-lockfile=false --ignore-scripts \
        --registry=${NPM_REGISTRY} \
    && pnpm build

# ---- OpenClaw ----
COPY openclaw/ /app/openclaw/
# openclaw's pnpm-workspace.yaml sets minimumReleaseAge=2880 (supply-chain
# protection) which rejects packages younger than 48h. In a test image we
# don't care; sed it to 0 in place. CLI --config.minimumReleaseAge=0 does
# NOT override workspace-level settings (verified empirically).
#
# Replace the bundled extensions/libp2p-mesh with our updated standalone
# source so openclaw's existing discovery/build logic picks up the
# NAT-traversal version. This is more robust than `npm link` (which is not
# reliably honoured by pnpm workspaces).
RUN sed -i 's/^minimumReleaseAge: .*/minimumReleaseAge: 0/' /app/openclaw/pnpm-workspace.yaml \
 && rm -rf /app/openclaw/extensions/libp2p-mesh \
 && cp -a /app/openclaw-libp2p-mesh /app/openclaw/extensions/libp2p-mesh \
 && cd /app/openclaw \
    && rm -rf node_modules dist dist-runtime pnpm-lock.yaml \
    && pnpm install --frozen-lockfile=false --ignore-scripts \
        --registry=${NPM_REGISTRY} \
    && pnpm run build

# Make the plugin discoverable to openclaw via npm link
# (kept for safety even though extensions/libp2p-mesh is now the canonical copy)
RUN cd /app/openclaw/extensions/libp2p-mesh && npm link \
 && cd /app/openclaw && npm link openclaw-libp2p-mesh 2>/dev/null || true

# -------------------------------------------------------------
# Runtime stage — drop apt build deps to keep image lean(er).
# -------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime

# Same apt-mirror trick as the build stage, so the runtime install is also fast.
ARG APT_MIRROR=http://mirrors.tuna.tsinghua.edu.cn/debian
RUN sed -i "s|http://deb.debian.org/debian|${APT_MIRROR}|g; s|http://deb.debian.org/debian-security|${APT_MIRROR}-security|g" /etc/apt/sources.list.d/debian.sources \
 || sed -i "s|http://deb.debian.org/debian|${APT_MIRROR}|g; s|http://deb.debian.org/debian-security|${APT_MIRROR}-security|g" /etc/apt/sources.list

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        iproute2 iputils-ping netcat-openbsd dnsutils \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /app /app
# Re-create global symlink in the runtime image. node:22 puts global
# packages under /usr/local/lib/node_modules (not /usr/lib/...).
COPY --from=build /usr/local/lib/node_modules /usr/local/lib/node_modules
COPY --from=build /usr/local/bin /usr/local/bin

WORKDIR /app/openclaw

# Each container will bind-mount its own openclaw.json into /root/.openclaw/
# at startup (see docker-compose.yml).
ENV HOME=/root \
    OPENCLAW_ALLOW_ROOT=1
RUN mkdir -p /root/.openclaw

ENTRYPOINT ["node", "/app/openclaw/openclaw.mjs"]
CMD ["gateway", "run"]
