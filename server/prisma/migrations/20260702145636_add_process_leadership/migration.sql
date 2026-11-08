-- CreateTable
CREATE TABLE "ProcessLeadership" (
    "scope" TEXT NOT NULL PRIMARY KEY,
    "instanceId" TEXT NOT NULL,
    "pid" INTEGER NOT NULL,
    "commit" TEXT,
    "acquiredAt" DATETIME NOT NULL,
    "renewedAt" DATETIME NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
