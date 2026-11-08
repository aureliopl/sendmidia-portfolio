-- CreateTable
CREATE TABLE "ParticipantRemoval" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "waGroupId" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "nomeGrupo" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "erro" TEXT,
    "criadoEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processadoEm" DATETIME,
    CONSTRAINT "ParticipantRemoval_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ParticipantRemoval_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ParticipantRemoval_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ParticipantRemoval_campaignId_status_idx" ON "ParticipantRemoval"("campaignId", "status");

-- CreateIndex
CREATE INDEX "ParticipantRemoval_accountId_status_idx" ON "ParticipantRemoval"("accountId", "status");
