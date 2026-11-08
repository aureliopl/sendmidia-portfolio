import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// data/ na raiz do monorepo por padrão. DATA_DIR (relativo ou absoluto) sobrescreve —
// variáveis de ambiente durante o build). Por isso recalculamos a URL aqui a partir
// de um caminho conhecido e a definimos antes de instanciar o client.
const repoRoot = path.resolve(__dirname, '../../');
const dataDir = path.join(repoRoot, 'data'); // Dados isolados da demonstracao.
const dbFile = path.join(dataDir, 'sendmidia.db');

process.env.DATABASE_URL = `file:${dbFile}`;

export const prisma = new PrismaClient();

let dbWriteQueue = Promise.resolve();

// SQLite aceita vários leitores, mas só um escritor por vez. Como o worker dispara várias
// contas em paralelo, serializamos apenas as escritas curtas para não travar os envios.
export function queueDbWrite(operation) {
  const run = dbWriteQueue.catch(() => {}).then(operation);
  dbWriteQueue = run.catch(() => {});
  return run;
}

export async function configureDatabase() {
  await prisma.$queryRawUnsafe('PRAGMA journal_mode = WAL');
  await prisma.$queryRawUnsafe('PRAGMA synchronous = NORMAL');
  await prisma.$queryRawUnsafe('PRAGMA busy_timeout = 30000');
}

// Fecha a conexão de forma limpa no encerramento do processo.
export async function disconnectPrisma() {
  await prisma.$disconnect();
}
