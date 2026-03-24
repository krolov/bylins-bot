FROM oven/bun:1 AS base

WORKDIR /app

COPY package.json tsconfig.json ./
RUN bun install

COPY public ./public
COPY src ./src

RUN bun run build:client

EXPOSE 3000

CMD ["bun", "run", "src/server.ts"]
