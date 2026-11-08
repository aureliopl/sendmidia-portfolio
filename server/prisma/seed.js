// Seed opcional para desenvolvimento local. Idempotente: usa ids fixos de demo,
// então rodar várias vezes não duplica registros.
//   npm run db:seed
import { prisma, disconnectPrisma } from '../src/db.js';

async function main() {
  const account = await prisma.account.upsert({
    where: { id: 'demo-account' },
    update: {},
    create: {
      id: 'demo-account',
      nome: 'Conta de demonstração',
      telefone: '+55 11 90000-0000',
      status: 'no_session',
      projeto: 'Demo',
    },
  });

  const campaign = await prisma.campaign.upsert({
    where: { id: 'demo-campaign' },
    update: {},
    create: {
      id: 'demo-campaign',
      nome: 'Campanha de demonstração',
      tipo: 'padrao',
      status: 'active',
    },
  });

  await prisma.campaignAccount.upsert({
    where: { campaignId_accountId: { campaignId: campaign.id, accountId: account.id } },
    update: {},
    create: { campaignId: campaign.id, accountId: account.id },
  });

  const group = await prisma.group.upsert({
    where: { id: 'demo-group' },
    update: {},
    create: {
      id: 'demo-group',
      campaignId: campaign.id,
      accountId: account.id,
      nome: 'Grupo de demonstração',
      participantes: 339,
      capacidade: 600,
      status: 'open',
    },
  });

  await prisma.message.upsert({
    where: { id: 'demo-message' },
    update: {},
    create: {
      id: 'demo-message',
      campaignId: campaign.id,
      conteudo: 'Olá! {Bem-vindo|Seja bem-vindo|Boas-vindas} ao nosso grupo. 🎉',
      usarPreviewLink: true,
    },
  });

  console.log('Seed concluído:', {
    account: account.nome,
    campaign: campaign.nome,
    group: group.nome,
  });
}

main()
  .catch((err) => {
    console.error('Falha no seed:', err);
    process.exitCode = 1;
  })
  .finally(disconnectPrisma);
