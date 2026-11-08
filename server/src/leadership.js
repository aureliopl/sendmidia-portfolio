import { prisma } from './db.js';
import { buildCommit, instanceId, isProd, safeError } from './runtime.js';

const LEADERSHIP_SCOPE = 'global';
const LEASE_MS = 45000;
const HEARTBEAT_MS = 15000;

let logger = null;
let heartbeatTimer = null;
let heartbeatRunning = false;
let onLeader = async () => {};
let onFollower = async () => {};
let state = {
  enabled: isProd,
  isLeader: !isProd,
  ownerInstanceId: !isProd ? instanceId : null,
  ownerPid: !isProd ? process.pid : null,
  ownerCommit: !isProd ? buildCommit : null,
  leaseExpiresAt: !isProd ? null : null,
  acquiredAt: !isProd ? new Date().toISOString() : null,
  renewedAt: !isProd ? new Date().toISOString() : null,
};

function snapshotFromRow(row) {
  return {
    enabled: isProd,
    isLeader: row?.instanceId === instanceId,
    ownerInstanceId: row?.instanceId || null,
    ownerPid: row?.pid ?? null,
    ownerCommit: row?.commit || null,
    leaseExpiresAt: row?.expiresAt ? new Date(row.expiresAt).toISOString() : null,
    acquiredAt: row?.acquiredAt ? new Date(row.acquiredAt).toISOString() : null,
    renewedAt: row?.renewedAt ? new Date(row.renewedAt).toISOString() : null,
  };
}

function logLeadership(level, event, extra, message) {
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

async function readLeadershipRow() {
  return prisma.processLeadership.findUnique({ where: { scope: LEADERSHIP_SCOPE } });
}

async function renewOrAcquireLeadership() {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + LEASE_MS);
  const nowIso = now.toISOString();
  const expiresIso = expiresAt.toISOString();

  await prisma.$executeRawUnsafe(
    `
      INSERT OR IGNORE INTO "ProcessLeadership"
        ("scope", "instanceId", "pid", "commit", "acquiredAt", "renewedAt", "expiresAt", "createdAt", "updatedAt")
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    LEADERSHIP_SCOPE,
    instanceId,
    process.pid,
    buildCommit,
    nowIso,
    nowIso,
    expiresIso,
    nowIso,
    nowIso,
  );

  await prisma.$executeRawUnsafe(
    `
      UPDATE "ProcessLeadership"
         SET "instanceId" = ?,
             "pid" = ?,
             "commit" = ?,
             "acquiredAt" = CASE WHEN "instanceId" = ? THEN "acquiredAt" ELSE ? END,
             "renewedAt" = ?,
             "expiresAt" = ?,
             "updatedAt" = ?
       WHERE "scope" = ?
         AND ("instanceId" = ? OR "expiresAt" <= ?)
    `,
    instanceId,
    process.pid,
    buildCommit,
    instanceId,
    nowIso,
    nowIso,
    expiresIso,
    nowIso,
    LEADERSHIP_SCOPE,
    instanceId,
    nowIso,
  );

  return readLeadershipRow();
}

async function runHeartbeat(reason) {
  if (!isProd || heartbeatRunning) return;
  heartbeatRunning = true;
  try {
    const before = state;
    const row = await renewOrAcquireLeadership();
    const next = snapshotFromRow(row);
    state = next;

    if (!before.isLeader && next.isLeader) {
      logLeadership('info', 'leadership_acquired', next, 'Processo assumiu a liderança global');
      await onLeader(next);
    } else if (before.isLeader && !next.isLeader) {
      logLeadership(
        'warn',
        'leadership_lost',
        { ...next, previousOwnerInstanceId: before.ownerInstanceId, reason },
        'Processo perdeu a liderança global',
      );
      await onFollower(next);
    }
  } catch (err) {
    logLeadership('error', 'leadership_heartbeat_failed', { error: safeError(err), reason }, 'Falha ao renovar liderança global');
  } finally {
    heartbeatRunning = false;
  }
}

export function attachLeadershipLogger(appLogger) {
  logger = appLogger;
}

export async function startLeadership({ onLeader: handleLeader, onFollower: handleFollower } = {}) {
  onLeader = handleLeader || onLeader;
  onFollower = handleFollower || onFollower;

  if (!isProd) {
    await onLeader(state);
    return state;
  }

  await runHeartbeat('boot');
  if (!heartbeatTimer) {
    heartbeatTimer = setInterval(() => {
      runHeartbeat('heartbeat').catch(() => {});
    }, HEARTBEAT_MS);
    heartbeatTimer.unref?.();
  }
  return state;
}

export async function stopLeadership() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = null;

  if (!isProd || !state.isLeader) return;

  const now = new Date();
  const expiredIso = new Date(now.getTime() - 1000).toISOString();
  const nowIso = now.toISOString();
  try {
    await prisma.$executeRawUnsafe(
      `
        UPDATE "ProcessLeadership"
           SET "renewedAt" = ?,
               "expiresAt" = ?,
               "updatedAt" = ?
         WHERE "scope" = ?
           AND "instanceId" = ?
      `,
      nowIso,
      expiredIso,
      nowIso,
      LEADERSHIP_SCOPE,
      instanceId,
    );
  } catch (err) {
    logLeadership('error', 'leadership_release_failed', { error: safeError(err) }, 'Falha ao liberar liderança global');
  }
}

export function isLeaderProcess() {
  return state.isLeader;
}

export function getLeadershipStatus() {
  return {
    ...state,
    leaseMs: LEASE_MS,
    heartbeatMs: HEARTBEAT_MS,
  };
}
