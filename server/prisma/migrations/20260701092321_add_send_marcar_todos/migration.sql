-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ScheduledSend" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "loteId" TEXT,
    "gruposAlvo" TEXT NOT NULL,
    "agendadoPara" DATETIME NOT NULL,
    "perfilVelocidade" TEXT NOT NULL DEFAULT 'normal',
    "intervaloMin" INTEGER NOT NULL DEFAULT 140,
    "intervaloMax" INTEGER NOT NULL DEFAULT 460,
    "marcarTodos" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "resultado" TEXT,
    "criadoEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "iniciadoEm" DATETIME,
    "finalizadoEm" DATETIME,
    CONSTRAINT "ScheduledSend_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ScheduledSend_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ScheduledSend_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ScheduledSend" ("accountId", "agendadoPara", "campaignId", "criadoEm", "finalizadoEm", "gruposAlvo", "id", "iniciadoEm", "intervaloMax", "intervaloMin", "loteId", "messageId", "perfilVelocidade", "resultado", "status") SELECT "accountId", "agendadoPara", "campaignId", "criadoEm", "finalizadoEm", "gruposAlvo", "id", "iniciadoEm", "intervaloMax", "intervaloMin", "loteId", "messageId", "perfilVelocidade", "resultado", "status" FROM "ScheduledSend";
DROP TABLE "ScheduledSend";
ALTER TABLE "new_ScheduledSend" RENAME TO "ScheduledSend";
CREATE INDEX "ScheduledSend_campaignId_idx" ON "ScheduledSend"("campaignId");
CREATE INDEX "ScheduledSend_status_agendadoPara_idx" ON "ScheduledSend"("status", "agendadoPara");
CREATE INDEX "ScheduledSend_campaignId_loteId_idx" ON "ScheduledSend"("campaignId", "loteId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
