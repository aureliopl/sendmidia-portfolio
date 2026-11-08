import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Modal,
  Stack,
  Group,
  Text,
  Button,
  Badge,
  ScrollArea,
  Loader,
  Center,
  Alert,
  Divider,
  Progress,
  ActionIcon,
  Tooltip,
} from '@mantine/core';
import { IconRefresh, IconDownload, IconInfoCircle, IconUserMinus, IconShield } from '@tabler/icons-react';
import { api } from '../lib/api';
import { socket } from '../lib/socket';

const MAX_VISIVEL = 100;

// Participantes duplicados (M6.6). Sincroniza participantes (read-only), lista quem está
// em mais de um grupo (regra do menor "#NN") e REMOVE os duplicados via fila/worker, devagar
// e com espaçamento anti-banimento. O modal acompanha o progresso ao vivo.
export default function DuplicatesModal({ campaignId, opened, onClose }) {
  const [dups, setDups] = useState(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState(null);
  const wasActiveRef = useRef(false);

  const ativo = progress && progress.queued > 0;

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const [d, p] = await Promise.all([
        api(`/api/campaigns/${campaignId}/groups/duplicates`),
        api(`/api/campaigns/${campaignId}/removals/progress`),
      ]);
      setDups(d.duplicados);
      setProgress(p.progress);
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  useEffect(() => {
    if (opened) carregar();
  }, [opened, carregar]);

  // Progresso ao vivo da remoção via Socket.IO.
  useEffect(() => {
    function onRemovalProgress(d) {
      if (d.campaignId !== campaignId) return;
      setProgress({ queued: d.queued, done: d.done, failed: d.failed, canceled: d.canceled, total: d.total });
    }
    socket.on('removal:progress', onRemovalProgress);
    return () => socket.off('removal:progress', onRemovalProgress);
  }, [campaignId]);

  // Polling de apoio enquanto há remoção em andamento (garante atualização se um evento se perder).
  useEffect(() => {
    if (!opened || !ativo) return;
    const t = setInterval(async () => {
      try {
        const r = await api(`/api/campaigns/${campaignId}/removals/progress`);
        setProgress(r.progress);
      } catch {
        // ignora — próxima iteração tenta de novo
      }
    }, 5000);
    return () => clearInterval(t);
  }, [opened, ativo, campaignId]);

  // Quando a remoção termina (estava ativa e zerou a fila), recarrega a lista de duplicados.
  useEffect(() => {
    if (ativo) wasActiveRef.current = true;
    else if (wasActiveRef.current) {
      wasActiveRef.current = false;
      carregar();
    }
  }, [ativo, carregar]);

  async function sincronizar() {
    setSyncing(true);
    try {
      const r = await api(`/api/campaigns/${campaignId}/groups/sync-participants`, { method: 'POST' });
      const falhou = r.falhas?.length ? `\n${r.falhas.length} falha(s), verifique se as contas estão conectadas.` : '';
      const semId = r.ignorados ? `, ${r.ignorados} sem identificador` : '';
      window.alert(`Participantes lidos em ${r.sincronizados}/${r.total} grupo(s).\n${r.capturados ?? 0} identificado(s)${semId}.${falhou}`);
      await carregar();
    } catch {
      window.alert('Não foi possível sincronizar os participantes.');
    } finally {
      setSyncing(false);
    }
  }

  const aRemover = dups ? dups.reduce((s, d) => s + d.grupos.filter((g) => !g.manter).length, 0) : 0;

  async function removerDuplicados() {
    const msg =
      `Remover ${aRemover} participação(ões) duplicada(s)?\n\n` +
      'Cada contato será EXPULSO dos grupos extras, permanecendo só no de menor número (#NN). ' +
      'A remoção é feita devagar e em pacotes (anti-banimento): 30 a 60 segundos entre cada e uma ' +
      'pausa de 30 a 45 minutos a cada 30 remoções por conta. Em lotes grandes pode levar bastante tempo. ' +
      'Você acompanha o progresso aqui e pode cancelar o que ainda não saiu.';
    if (!window.confirm(msg)) return;
    try {
      const r = await api(`/api/campaigns/${campaignId}/groups/remove-duplicates`, { method: 'POST' });
      setProgress(r.progress);
    } catch (err) {
      window.alert(err.message === 'ja_em_andamento' ? 'Já existe uma remoção em andamento.' : 'Não foi possível iniciar a remoção.');
    }
  }

  async function cancelar() {
    if (!window.confirm('Cancelar as remoções que ainda não saíram? (as já executadas permanecem)')) return;
    await api(`/api/campaigns/${campaignId}/removals/cancel`, { method: 'POST' });
    const r = await api(`/api/campaigns/${campaignId}/removals/progress`);
    setProgress(r.progress);
  }

  async function proteger(numero) {
    if (!window.confirm(`Marcar ${numero} como número administrativo?\n\nEle vai para o cadastro de Anti-spam, deixa de ser listado como duplicado e nunca será removido dos grupos.`)) return;
    await api('/api/admin-numbers', { method: 'POST', body: JSON.stringify({ numero }) });
    await carregar();
  }

  function exportarCSV() {
    const linhas = [['numero', 'qtd_grupos', 'grupos', 'manter_em']];
    for (const d of dups) {
      linhas.push([
        d.numero,
        d.grupos.length,
        d.grupos.map((g) => g.nome).join('; '),
        d.grupos.find((g) => g.manter)?.nome || '',
      ]);
    }
    const csv = linhas.map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'participantes-duplicados.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  const temDups = dups && dups.length > 0;
  const processados = progress ? progress.done + progress.failed + progress.canceled : 0;
  const pct = progress && progress.total > 0 ? Math.round((processados / progress.total) * 100) : 0;

  return (
    <Modal opened={opened} onClose={onClose} title="Participantes duplicados" size="lg" centered>
      <Stack gap="sm">
        <Group justify="space-between" wrap="wrap">
          <Button leftSection={<IconRefresh size={16} />} onClick={sincronizar} loading={syncing} disabled={ativo}>
            Sincronizar participantes
          </Button>
          {temDups && (
            <Button variant="default" leftSection={<IconDownload size={16} />} onClick={exportarCSV}>
              Exportar CSV
            </Button>
          )}
        </Group>

        <Alert variant="light" color="gray" icon={<IconInfoCircle size={16} />} p="xs">
          <Text size="xs">
            "Sincronizar" lê os participantes ao vivo dos grupos (não altera nada). O contato é mantido
            no grupo de <b>menor número</b> (#NN). <b>Números administrativos</b> (cadastrados em Anti-spam)
            e os telefones das suas contas não entram nesta lista. Use o escudo para enviar um número
            direto ao cadastro. Grupos em modo LID podem expor menos números, uma limitação do WhatsApp.
          </Text>
        </Alert>

        {/* Progresso da remoção (quando há rodada em andamento ou recém-terminada) */}
        {progress && progress.total > 0 && (
          <Stack gap={4}>
            <Group justify="space-between">
              <Text size="sm" fw={500}>{ativo ? 'Removendo duplicados…' : 'Remoção concluída'}</Text>
              <Text size="xs" c="dimmed">{processados}/{progress.total}</Text>
            </Group>
            <Progress value={pct} color={ativo ? 'whatsapp.8' : 'gray'} animated={ativo} />
            <Group gap="xs">
              <Badge size="xs" variant="light" color="whatsapp.8">saíram: {progress.done}</Badge>
              {progress.failed > 0 && <Badge size="xs" variant="light" color="red">falhas: {progress.failed}</Badge>}
              {progress.queued > 0 && <Badge size="xs" variant="light" color="blue">na fila: {progress.queued}</Badge>}
              {progress.canceled > 0 && <Badge size="xs" variant="light" color="gray">cancelados: {progress.canceled}</Badge>}
              {ativo && <Button size="compact-xs" variant="subtle" color="red" onClick={cancelar}>Cancelar</Button>}
            </Group>
          </Stack>
        )}

        {loading ? (
          <Center py="xl"><Loader color="whatsapp.8" size="sm" /></Center>
        ) : dups === null ? null : !temDups ? (
          <Stack align="center" py="xl" gap={4}>
            <Text c="dimmed" size="sm">Nenhum participante duplicado encontrado.</Text>
            <Text c="dimmed" size="xs">Se ainda não sincronizou os participantes, clique em "Sincronizar participantes".</Text>
          </Stack>
        ) : (
          <>
            <Group justify="space-between">
              <Text size="sm" fw={500}>{dups.length} número(s) em mais de um grupo</Text>
              <Button
                size="xs"
                color="red"
                leftSection={<IconUserMinus size={14} />}
                onClick={removerDuplicados}
                disabled={ativo || aRemover === 0}
              >
                Remover duplicados ({aRemover})
              </Button>
            </Group>
            <ScrollArea.Autosize mah={320}>
              <Stack gap={8}>
                {dups.slice(0, MAX_VISIVEL).map((d) => (
                  <div key={d.numero}>
                    <Group gap={6} mb={2}>
                      <Text size="sm" fw={500} ff="monospace">{d.numero}</Text>
                      <Badge size="xs" variant="light" color="gray">{d.grupos.length} grupos</Badge>
                      <Tooltip label="Marcar como número administrativo (Anti-spam)" withArrow>
                        <ActionIcon size="sm" variant="subtle" color="whatsapp.8" onClick={() => proteger(d.numero)} aria-label="Marcar como administrativo">
                          <IconShield size={14} />
                        </ActionIcon>
                      </Tooltip>
                    </Group>
                    <Group gap={4}>
                      {d.grupos.map((g) => (
                        <Badge
                          key={g.groupId}
                          size="sm"
                          variant={g.manter ? 'filled' : 'light'}
                          color={g.manter ? 'whatsapp.8' : 'red'}
                        >
                          {g.nome}{g.manter ? ' · manter' : ' · sair'}
                        </Badge>
                      ))}
                    </Group>
                  </div>
                ))}
              </Stack>
            </ScrollArea.Autosize>
            {dups.length > MAX_VISIVEL && (
              <Text c="dimmed" size="xs">Mostrando {MAX_VISIVEL} de {dups.length}. Use "Exportar CSV" para a lista completa.</Text>
            )}
            <Divider />
            <Text c="dimmed" size="xs">
              "Remover duplicados" expulsa cada contato dos grupos marcados como "sair", mantendo no de
              menor #. É feito devagar e em pacotes (anti-banimento): 30 a 60 segundos entre cada e uma pausa
              de 30 a 45 minutos a cada 30 remoções por conta. Em lotes grandes pode levar bastante tempo.
            </Text>
          </>
        )}
      </Stack>
    </Modal>
  );
}
