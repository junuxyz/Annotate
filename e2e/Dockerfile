FROM node:22-bookworm
ARG OBSIDIAN_VERSION=1.14.4
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends \
    xvfb xauth procps libgtk-3-0 libnss3 libasound2 libgbm1 libxss1 libsecret-1-0 libnotify4 fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*
RUN arch="$(dpkg --print-architecture)"; suffix=""; \
    if [ "$arch" = arm64 ]; then suffix="-arm64"; fi; \
    mkdir -p /opt/obsidian && \
    curl -fsSL --retry 3 "https://github.com/obsidianmd/obsidian-releases/releases/download/v${OBSIDIAN_VERSION}/obsidian-${OBSIDIAN_VERSION}${suffix}.tar.gz" -o /tmp/obsidian.tar.gz && \
    tar -xf /tmp/obsidian.tar.gz -C /opt/obsidian --strip-components=1 && rm /tmp/obsidian.tar.gz
ENV OBSIDIAN_BIN=/opt/obsidian/obsidian
ENV E2E_OUTPUT=/evidence
WORKDIR /workspace
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
ENTRYPOINT ["xvfb-run", "-a", "-s", "-screen 0 1280x900x24", "sh", "-c", "npm run lint && npm run build && npm test && exec node e2e/dev-check.mjs \"$@\"", "--"]
