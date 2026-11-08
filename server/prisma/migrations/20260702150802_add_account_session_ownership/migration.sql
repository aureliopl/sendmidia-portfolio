-- CreateTable
CREATE TABLE "AccountSessionOwnership" (
    "accountId" TEXT NOT NULL PRIMARY KEY,
    "ownerInstanceId" TEXT NOT NULL,
    "ownerPid" INTEGER NOT NULL,
    "ownerCommit" TEXT,
    "acquiredAt" DATETIME NOT NULL,
    "renewedAt" DATETIME NOT NULL,
    "leaseExpiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AccountSessionOwnership_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
