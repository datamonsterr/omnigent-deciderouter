# Bun runtime pinned by version and digest (matches packageManager in package.json).
FROM oven/bun:1.3.14-slim@sha256:d56a2534ffd262e92c12fd3249d3924d296d97086da773f821d7d0477435ea04

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY tsconfig.json ./
COPY src ./src

USER bun
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s \
  CMD bun -e "const r = await fetch('http://localhost:8080/healthz'); if (!r.ok) process.exit(1);"

CMD ["bun", "run", "src/index.ts"]
