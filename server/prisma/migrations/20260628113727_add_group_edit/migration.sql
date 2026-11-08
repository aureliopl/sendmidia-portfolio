-- CreateTable
CREATE TABLE "GroupEdit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "waGroupId" TEXT NOT NULL,
    "nomeGrupo" TEXT NOT NULL,
    "edits" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "erro" TEXT,
    "criadoEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processadoEm" DATETIME,
    CONSTRAINT "GroupEdit_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GroupEdit_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GroupEdit_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "GroupEdit_campaignId_status_idx" ON "GroupEdit"("campaignId", "status");

-- CreateIndex
CREATE INDEX "GroupEdit_accountId_status_idx" ON "GroupEdit"("accountId", "status");
