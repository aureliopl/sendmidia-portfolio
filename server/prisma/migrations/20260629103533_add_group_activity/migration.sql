-- CreateTable
CREATE TABLE "GroupActivity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "accountId" TEXT,
    "numero" TEXT NOT NULL,
    "jid" TEXT,
    "tipo" TEXT NOT NULL,
    "nomeGrupo" TEXT,
    "criadoEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GroupActivity_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GroupActivity_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GroupActivity_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "GroupActivity_campaignId_criadoEm_idx" ON "GroupActivity"("campaignId", "criadoEm");

-- CreateIndex
CREATE INDEX "GroupActivity_campaignId_tipo_idx" ON "GroupActivity"("campaignId", "tipo");

-- CreateIndex
CREATE INDEX "GroupActivity_groupId_idx" ON "GroupActivity"("groupId");
