-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_EntryRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "accountId" TEXT,
    "waGroupId" TEXT,
    "numero" TEXT NOT NULL,
    "jid" TEXT,
    "nomeGrupo" TEXT,
    "acao" TEXT,
    "loteId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "erro" TEXT,
    "criadoEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processadoEm" DATETIME,
    CONSTRAINT "EntryRequest_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EntryRequest_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EntryRequest_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_EntryRequest" ("campaignId", "criadoEm", "groupId", "id", "numero", "status") SELECT "campaignId", "criadoEm", "groupId", "id", "numero", "status" FROM "EntryRequest";
DROP TABLE "EntryRequest";
ALTER TABLE "new_EntryRequest" RENAME TO "EntryRequest";
CREATE INDEX "EntryRequest_campaignId_status_idx" ON "EntryRequest"("campaignId", "status");
CREATE INDEX "EntryRequest_accountId_status_idx" ON "EntryRequest"("accountId", "status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
