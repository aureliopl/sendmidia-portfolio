-- Fila rastreável por grupo: um registro por grupo selecionado em cada ScheduledSend.
CREATE TABLE "ScheduledSendTarget" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scheduledSendId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "waGroupId" TEXT,
    "nomeGrupo" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "tentativa" INTEGER NOT NULL DEFAULT 0,
    "erro" TEXT,
    "resultado" TEXT,
    "criadoEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "iniciadoEm" DATETIME,
    "finalizadoEm" DATETIME,
    "atualizadoEm" DATETIME NOT NULL,
    CONSTRAINT "ScheduledSendTarget_scheduledSendId_fkey" FOREIGN KEY ("scheduledSendId") REFERENCES "ScheduledSend" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ScheduledSendTarget_scheduledSendId_groupId_key" ON "ScheduledSendTarget"("scheduledSendId", "groupId");
CREATE INDEX "ScheduledSendTarget_scheduledSendId_status_idx" ON "ScheduledSendTarget"("scheduledSendId", "status");
CREATE INDEX "ScheduledSendTarget_accountId_status_idx" ON "ScheduledSendTarget"("accountId", "status");
CREATE INDEX "ScheduledSendTarget_groupId_idx" ON "ScheduledSendTarget"("groupId");
