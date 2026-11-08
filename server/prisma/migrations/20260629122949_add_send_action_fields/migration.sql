-- AlterTable
ALTER TABLE "ScheduledSend" ADD COLUMN "finalizadoEm" DATETIME;
ALTER TABLE "ScheduledSend" ADD COLUMN "iniciadoEm" DATETIME;
ALTER TABLE "ScheduledSend" ADD COLUMN "loteId" TEXT;

-- CreateIndex
CREATE INDEX "ScheduledSend_campaignId_loteId_idx" ON "ScheduledSend"("campaignId", "loteId");
