FROM oven/bun:1

WORKDIR /app

COPY package.json ./
COPY tsconfig.json ./
COPY src ./src

USER bun
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s \
  CMD bun -e "const r = await fetch('http://localhost:8080/healthz'); if (!r.ok) process.exit(1);"

CMD ["bun", "run", "src/index.ts"]
