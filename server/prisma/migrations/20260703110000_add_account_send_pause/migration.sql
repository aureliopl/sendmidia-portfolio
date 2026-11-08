-- Pausa automática de envio por conta quando houver oscilação/falha de conexão.
ALTER TABLE "Account" ADD COLUMN "envioPausadoAte" DATETIME;
ALTER TABLE "Account" ADD COLUMN "envioFalhasConsecutivas" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Account" ADD COLUMN "envioUltimaFalhaEm" DATETIME;

CREATE INDEX "Account_envioPausadoAte_idx" ON "Account"("envioPausadoAte");
