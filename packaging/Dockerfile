# syntax=docker/dockerfile:1
ARG TEST_UBUNTU=24.04
FROM ubuntu:24.04 AS dependencies
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl xz-utils dpkg-dev && rm -rf /var/lib/apt/lists/*
ARG NODE_VERSION=24.21.0
ARG NODE_SHA256=fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6
RUN curl -fsSL --retry 3 "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" -o /tmp/node.tar.xz \
    && echo "${NODE_SHA256}  /tmp/node.tar.xz" | sha256sum --check --status \
    && mkdir -p /opt/node && tar -xJf /tmp/node.tar.xz -C /opt/node --strip-components=1 && rm /tmp/node.tar.xz
ENV PATH="/opt/node/bin:${PATH}"
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS build
COPY . .
RUN npm run build

FROM build AS verify
RUN npx vitest run test/online.test.ts test/online_address.test.ts test/lan.test.ts && node --test packaging/test-*.mjs

# A test-only launcher applies real socket-family seccomp restrictions without
# privileged Docker or a host systemd/cgroup mount. Never shipped in the package.
FROM dependencies AS sandbox-tool
RUN apt-get update && apt-get install -y --no-install-recommends gcc libc6-dev
COPY packaging/restrict-address-families.c /tmp/
RUN gcc -Wall -Wextra -Werror -O2 /tmp/restrict-address-families.c -o /tmp/restrict-address-families

FROM build AS package
RUN npm ci --omit=dev --ignore-scripts \
    && bash packaging/assemble.sh /src /pkg /opt/node \
    && mkdir /artifacts \
    && dpkg-deb --root-owner-group --build /pkg /artifacts/scorchedearth-html5_0.0.0-1_amd64.deb \
    && cd /artifacts && sha256sum *.deb > SHA256SUMS

FROM scratch AS artifact
COPY --from=package /artifacts/ /

FROM ubuntu:${TEST_UBUNTU} AS smoke
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends systemd init-system-helpers passwd libstdc++6 libgcc-s1 curl iproute2 ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=package /artifacts/ /artifacts/
COPY packaging/docker-smoke.sh packaging/package-smoke.mjs /tests/
COPY --from=sandbox-tool /tmp/restrict-address-families /tests/restrict-address-families
CMD ["bash", "/tests/docker-smoke.sh"]

FROM smoke AS deployment-test
COPY deploy/install-game.sh packaging/deploy-smoke.sh packaging/deploy-systemctl /tests/
RUN mv /usr/bin/systemctl /usr/bin/systemctl.real && install -m 755 /tests/deploy-systemctl /usr/bin/systemctl
CMD ["bash", "/tests/deploy-smoke.sh"]

FROM caddy:2.10.2 AS caddy

FROM dependencies AS browser
RUN npx playwright install --with-deps chromium && apt-get install -y --no-install-recommends systemd init-system-helpers passwd openssl libstdc++6 libgcc-s1
COPY --from=caddy /usr/bin/caddy /usr/local/bin/caddy
COPY --from=build /src /src
COPY --from=package /artifacts/ /artifacts/
CMD ["bash", "packaging/browser-smoke.sh"]
