import { campaignsRepo, campaignClicksRepo } from '../repositories/index.js';
import { garantirGrupoAberto } from '../services/groupCreation.js';

// Página HTML mínima (sem SPA) para os casos em que não há redirect: link inválido ou
// nenhuma vaga no momento. Tema claro, sem depender de assets.
function paginaSimples({ titulo, mensagem }) {
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>${titulo}</title>
<style>
  body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
    background:#f5f6f8;color:#202124;display:flex;min-height:100vh;align-items:center;justify-content:center}
  .card{background:#fff;border:1px solid #e6e8eb;border-radius:14px;padding:32px 28px;max-width:380px;
    margin:16px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.05)}
  h1{font-size:18px;margin:0 0 8px;color:#0f6e56}
  p{font-size:14px;line-height:1.5;color:#5f6368;margin:0}
</style></head>
<body><div class="card"><h1>${titulo}</h1><p>${mensagem}</p></div></body></html>`;
}

// Sorteia um elemento de uma lista (distribuição uniforme — o link geral espalha os novos
// membros entre os grupos abertos, sem empurrar todos para o mesmo grupo).
function sortear(lista) {
  return lista[Math.floor(Math.random() * lista.length)];
}

// Rota PÚBLICA do link de convite geral por campanha (deep linking). Não é /api/*, então o
// hook de autenticação não a intercepta; e por ser rota registrada, não cai no SPA fallback.
export default async function inviteRoutes(app) {
  app.get('/i/:code', async (req, reply) => {
    const campanha = await campaignsRepo.getByInviteCode(req.params.code);
    if (!campanha) {
      reply.code(404).type('text/html');
      return paginaSimples({
        titulo: 'Link inválido',
        mensagem: 'Este link de convite não existe ou foi desativado.',
      });
    }

    // Candidatos: grupos abertos, com link de convite, ainda abaixo da capacidade da campanha.
    const cap = campanha.capacidadeGrupo ?? 600;
    const abertos = (campanha.groups || []).filter((g) => g.linkConvite && g.participantes < cap);

    if (abertos.length === 0) {
      // Leva 2b: sem vaga — tenta abrir automaticamente o próximo grupo da sequência (#NN+1)
      // pela conta criadora da campanha. Trava por campanha evita criar vários de uma vez.
      const novo = await garantirGrupoAberto(campanha).catch(() => null);
      if (novo && novo.linkConvite) {
        await campaignClicksRepo.record({ campaignId: campanha.id, groupId: novo.id }).catch(() => {});
        return reply.redirect(novo.linkConvite, 302);
      }
      // não foi possível criar (sem conta criadora definida/conectada): registra o clique sem destino.
      await campaignClicksRepo.record({ campaignId: campanha.id, groupId: null }).catch(() => {});
      reply.code(200).type('text/html');
      return paginaSimples({
        titulo: 'Sem vaga no momento',
        mensagem: 'Todos os grupos estão cheios agora. Tente novamente em instantes.',
      });
    }

    const grupo = sortear(abertos);
    await campaignClicksRepo.record({ campaignId: campanha.id, groupId: grupo.id }).catch(() => {});
    reply.redirect(grupo.linkConvite, 302);
  });
}
