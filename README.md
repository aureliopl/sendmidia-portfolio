# Sendmidia Portfolio

A React interface and Fastify API for organizing accounts, campaigns, groups, message templates and scheduled actions.

Author: [Aurélio Paz da Luz](https://aureliopaz.com/en/).

This is a source-code portfolio edition. It has its own publication history and contains no production credentials, operational runbooks, account sessions or deployment automation. It is not a hosted service.

## Stack and structure

- `client/`: React, Mantine, React Router and TanStack Query.
- `server/src/routes/` and `repositories/`: API boundaries and SQLite persistence with Prisma.
- `server/src/whatsapp/`: transport and scheduling source retained for inspection.
- `server/src/security.js`: session validation, authenticated sockets and login throttling.
- `server/prisma/`: schema, migrations and fictitious demo seed.

## External integrations are disabled

`server/src/portfolio.js` keeps external integrations disabled in code. Pairing, WhatsApp operations, message workers, Telegram alerts, SMTP delivery and external link previews do not run in this edition. Scheduling records can be inspected without sending messages. There are no production targets, monitoring scripts or deployment workflows.

Do not import real account sessions or real contact data. This edition is not an operational messaging service. Its UI retains the original Portuguese workflow labels; transport actions are intentionally unavailable.

## Local setup

Use Node.js 22 or newer. Copy `.env.example` to `.env` and set `APP_PASSWORD` to a unique password of at least 12 characters. Generate a 32-byte random `SESSION_SECRET` in hexadecimal. Set `APP_ORIGIN` to the exact frontend origin. Never commit `.env`.

```sh
npm ci
npm run db:generate
npm run db:deploy
npm run db:seed
npm run dev
```

The default frontend origin is `http://localhost:5173`; the API binds to loopback. Runtime data stays in the repository's ignored `data/` directory. Use fictitious data only.

## Verification

```sh
npm test
npm run build
npm audit
```

Tests exercise real encrypted session cookies through Fastify injection, rejected anonymous and tampered socket handshakes, cross-origin rejection, login throttling and external-integration guards. The test suite does not pair accounts or contact messaging services. Sessions have a one-hour absolute lifetime. Mutable API calls require a same-origin custom request header; authenticated sockets receive events through a restricted room.

A patched `deepmerge-ts` override is used by the Prisma 6 configuration dependency. Prisma schema validation, client generation and migrations are checked against a disposable local SQLite database.
