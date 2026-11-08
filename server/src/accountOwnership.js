import { prisma } from './db.js';
import { buildCommit, instanceId, isProd, safeError } from './runtime.js';

const LEASE_MS = 45000;
const HEARTBEAT_MS = 15000;

let logger = null;
let heartbeatTimer = null;
let heartbeatRunning = false;
const ownedAccounts = new Set();

function logOwnership(level, event, extra, message) {
  if (!logger) return;
  logger[level](
    {
      event,
      instanceId,
      pid: process.pid,
      ts: new Date().toISOString(),
      ...extra,
    },
    message,
  );
}

function releaseLocalOwnership(accountId) {
  ownedAccounts.delete(accountId);
}

function claimLocalOwnership(accountId) {
  ownedAccounts.add(accountId);
}

async function readOwnershipRow(accountId) {
  return prisma.accountSessionOwnership.findUnique({ where: { accountId } });
}

export function attachAccountOwnershipLogger(appLogger) {
  logger = appLogger;
}

export function ownsAccountLocally(accountId) {
  return ownedAccounts.has(accountId);
}

export function getOwnedAccountIds() {
  return [...ownedAccounts];
}

export async function acquireAccountOwnership(accountId) {
  if (!isProd) {
    claimLocalOwnership(accountId);
    return {
      ok: true,
      owned: true,
      accountId,
      ownerInstanceId: instanceId,
      leaseExpiresAt: null,
    };
  }

  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + LEASE_MS);
  const nowIso = now.toISOString();
  const leaseIso = leaseExpiresAt.toISOString();

  await prisma.$executeRawUnsafe(
    `
      INSERT OR IGNORE INTO "AccountSessionOwnership"
        ("accountId", "ownerInstanceId", "ownerPid", "ownerCommit", "acquiredAt", "renewedAt", "leaseExpiresAt", "createdAt", "updatedAt")
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    accountId,
    instanceId,
    process.pid,
    buildCommit,
    nowIso,
    nowIso,
    leaseIso,
    nowIso,
    nowIso,
  );

  await prisma.$executeRawUnsafe(
    `
      UPDATE "AccountSessionOwnership"
         SET "ownerInstanceId" = ?,
             "ownerPid" = ?,
             "ownerCommit" = ?,
             "acquiredAt" = CASE WHEN "ownerInstanceId" = ? THEN "acquiredAt" ELSE ? END,
             "renewedAt" = ?,
             "leaseExpiresAt" = ?,
             "updatedAt" = ?
       WHERE "accountId" = ?
         AND ("ownerInstanceId" = ? OR "leaseExpiresAt" <= ?)
    `,
    instanceId,
    process.pid,
    buildCommit,
    instanceId,
    nowIso,
    nowIso,
    leaseIso,
    nowIso,
    accountId,
    instanceId,
    nowIso,
  );

  const row = await readOwnershipRow(accountId);
  const owned = row?.ownerInstanceId === instanceId;
  if (owned) claimLocalOwnership(accountId);
  else releaseLocalOwnership(accountId);
  return {
    ok: Boolean(row),
    owned,
    accountId,
    ownerInstanceId: row?.ownerInstanceId || null,
    leaseExpiresAt: row?.leaseExpiresAt ? new Date(row.leaseExpiresAt).toISOString() : null,
  };
}

export async function isAccountOwnedByCurrentInstance(accountId) {
  if (!isProd) return ownedAccounts.has(accountId);
  if (!ownedAccounts.has(accountId)) return false;
  const row = await readOwnershipRow(accountId);
  const now = Date.now();
  const owned = row?.ownerInstanceId === instanceId
    && row?.leaseExpiresAt
    && new Date(row.leaseExpiresAt).getTime() > now;
  if (!owned) releaseLocalOwnership(accountId);
  return Boolean(owned);
}

export async function assertAccountOwnership(accountId) {
  const ok = await isAccountOwnedByCurrentInstance(accountId);
  if (ok) return;
  const err = new Error('account_owned_by_other');
  err.code = 'account_owned_by_other';
  throw err;
}

async function renewOwnedAccounts() {
  if (!isProd || ownedAccounts.size === 0) return;

  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + LEASE_MS);
  const nowIso = now.toISOString();
  const leaseIso = leaseExpiresAt.toISOString();
  await prisma.$executeRawUnsafe(
    `
      UPDATE "AccountSessionOwnership"
         SET "renewedAt" = ?,
             "leaseExpiresAt" = ?,
             "updatedAt" = ?
       WHERE "ownerInstanceId" = ?
         AND "leaseExpiresAt" > ?
    `,
    nowIso,
    leaseIso,
    nowIso,
    instanceId,
    nowIso,
  );
  const refreshed = await prisma.accountSessionOwnership.findMany({
    where: {
      ownerInstanceId: instanceId,
      leaseExpiresAt: { gt: now },
    },
    select: { accountId: true },
  });
  ownedAccounts.clear();
  for (const row of refreshed) ownedAccounts.add(row.accountId);
}

async function heartbeat(reason) {
  if (!isProd || heartbeatRunning) return;
  heartbeatRunning = true;
  try {
    await renewOwnedAccounts();
  } catch (err) {
    logOwnership(
      'error',
      'account_ownership_heartbeat_failed',
      { error: safeError(err), reason, ownedAccounts: getOwnedAccountIds() },
      'Falha ao renovar a posse das contas',
    );
  } finally {
    heartbeatRunning = false;
  }
}

export function startAccountOwnershipHeartbeat() {
  if (!isProd || heartbeatTimer) return;
  heartbeatTimer = setInterval(() => {
    heartbeat('heartbeat').catch(() => {});
  }, HEARTBEAT_MS);
  heartbeatTimer.unref?.();
}

export async function releaseAccountOwnership(accountId) {
  releaseLocalOwnership(accountId);
  if (!isProd) return;

  const now = new Date();
  const expiredIso = new Date(now.getTime() - 1000).toISOString();
  const nowIso = now.toISOString();
  await prisma.$executeRawUnsafe(
    `
      UPDATE "AccountSessionOwnership"
         SET "renewedAt" = ?,
             "leaseExpiresAt" = ?,
             "updatedAt" = ?
       WHERE "accountId" = ?
         AND "ownerInstanceId" = ?
    `,
    nowIso,
    expiredIso,
    nowIso,
    accountId,
    instanceId,
  );
}

export async function releaseAllAccountOwnerships() {
  ownedAccounts.clear();
  if (!isProd) return;

  const now = new Date();
  const expiredIso = new Date(now.getTime() - 1000).toISOString();
  const nowIso = now.toISOString();
  await prisma.$executeRawUnsafe(
    `
      UPDATE "AccountSessionOwnership"
         SET "renewedAt" = ?,
             "leaseExpiresAt" = ?,
             "updatedAt" = ?
       WHERE "ownerInstanceId" = ?
    `,
    nowIso,
    expiredIso,
    nowIso,
    instanceId,
  );
}

export async function stopAccountOwnershipHeartbeat({ release = true } = {}) {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = null;
  if (release) {
    try {
      await releaseAllAccountOwnerships();
    } catch (err) {
      logOwnership(
        'error',
        'account_ownership_release_failed',
        { error: safeError(err) },
        'Falha ao liberar a posse das contas',
      );
    }
  }
}

export function getAccountOwnershipStatus() {
  return {
    enabled: isProd,
    leaseMs: LEASE_MS,
    heartbeatMs: HEARTBEAT_MS,
    ownedAccountIds: getOwnedAccountIds(),
    ownedCount: ownedAccounts.size,
  };
}
