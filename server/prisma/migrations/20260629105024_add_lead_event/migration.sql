-- CreateTable
CREATE TABLE "LeadEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "groupId" TEXT,
    "accountId" TEXT,
    "numero" TEXT NOT NULL,
    "jid" TEXT,
    "tipo" TEXT NOT NULL DEFAULT 'react',
    "peso" INTEGER NOT NULL DEFAULT 50,
    "emoji" TEXT,
    "nomeGrupo" TEXT,
    "criadoEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LeadEvent_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LeadEvent_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "LeadEvent_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "LeadEvent_campaignId_criadoEm_idx" ON "LeadEvent"("campaignId", "criadoEm");

-- CreateIndex
CREATE INDEX "LeadEvent_campaignId_numero_idx" ON "LeadEvent"("campaignId", "numero");
