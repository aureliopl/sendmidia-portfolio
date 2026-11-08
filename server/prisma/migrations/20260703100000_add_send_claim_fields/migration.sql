-- Campos de claim atômico para impedir que workers sobrepostos processem o mesmo envio/grupo.
ALTER TABLE "ScheduledSend" ADD COLUMN "claimedByInstanceId" TEXT;
ALTER TABLE "ScheduledSend" ADD COLUMN "claimedByPid" INTEGER;
ALTER TABLE "ScheduledSend" ADD COLUMN "claimedAt" DATETIME;

ALTER TABLE "ScheduledSendTarget" ADD COLUMN "claimedByInstanceId" TEXT;
ALTER TABLE "ScheduledSendTarget" ADD COLUMN "claimedByPid" INTEGER;
ALTER TABLE "ScheduledSendTarget" ADD COLUMN "claimedAt" DATETIME;

CREATE INDEX "ScheduledSend_status_accountId_idx" ON "ScheduledSend"("status", "accountId");
CREATE INDEX "ScheduledSend_status_campaignId_idx" ON "ScheduledSend"("status", "campaignId");
CREATE INDEX "ScheduledSendTarget_status_claimedByInstanceId_idx" ON "ScheduledSendTarget"("status", "claimedByInstanceId");
