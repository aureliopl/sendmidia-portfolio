-- AlterTable
ALTER TABLE "Group" ADD COLUMN "fecharInteracaoEm" DATETIME;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Campaign" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "nome" TEXT NOT NULL,
    "tipo" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "velocidadePadrao" TEXT NOT NULL DEFAULT 'normal',
    "inviteCode" TEXT,
    "capacidadeGrupo" INTEGER NOT NULL DEFAULT 600,
    "contaCriadoraId" TEXT,
    "aberturaInteracaoHoras" INTEGER NOT NULL DEFAULT 24,
    "criadoEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Campaign_contaCriadoraId_fkey" FOREIGN KEY ("contaCriadoraId") REFERENCES "Account" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Campaign" ("capacidadeGrupo", "contaCriadoraId", "criadoEm", "id", "inviteCode", "nome", "status", "tipo", "velocidadePadrao") SELECT "capacidadeGrupo", "contaCriadoraId", "criadoEm", "id", "inviteCode", "nome", "status", "tipo", "velocidadePadrao" FROM "Campaign";
DROP TABLE "Campaign";
ALTER TABLE "new_Campaign" RENAME TO "Campaign";
CREATE UNIQUE INDEX "Campaign_inviteCode_key" ON "Campaign"("inviteCode");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
