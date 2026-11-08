import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Stack,
  Group,
  Text,
  Button,
  Table,
  Checkbox,
  Badge,
  Tabs,
  Loader,
  Center,
  Progress,
  TextInput,
  Alert,
  ThemeIcon,
  Tooltip,
  ScrollArea,
} from '@mantine/core';
import {
  IconRefresh,
  IconSearch,
  IconCheck,
  IconX,
  IconInfoCircle,
  IconUserCheck,
  IconAlertTriangle,
  IconUsersGroup,
} from '@tabler/icons-react';
import { api } from '../lib/api';
import { socket } from '../lib/socket';
import { formatLocalDateTime } from '../lib/datetime';

// Exibe o número em formato consistente (E.164: "+" + dígitos). Em grupos no modo LID o
// telefone real não é exposto: nesses casos mostramos o identificador como veio.
function fmtNumero(item) {
  const ehLid = typeof item.jid === 'string' && item.jid.endsWith('@lid');
  const d = String(item.numero || '').replace(/\D/g, '');
  if (ehLid) return item.numero;
  return d ? `+${d}` : item.numero;
}

function dataHora(v) {
  return formatLocalDateTime(v);
}

// Solicitações de entrada da campanha (M9.1). Modera pedidos de entrada em grupos com aprovação
// de admin: sub-abas Pendentes / Processadas / Configurações. Aprovar/recusar é feito pela
// fila/worker, devagar e em pacotes (anti-banimento). O progresso aparece ao vivo.
export default function CampaignSolicitacoesTab({ campaignId }) {
  const [aba, setAba] = useState('pendentes');
  const [counts, setCounts] = useState({ pending: 0, approved: 0, rejected: 0, failed: 0 });

  return (
    <Tabs value={aba} onChange={setAba} keepMounted={false}>
      <Tabs.List>
        <Tabs.Tab value="pendentes">
          Pendentes{counts.pending > 0 ? ` (${counts.pending})` : ''}
        </Tabs.Tab>
        <Tabs.Tab value="processadas">
          Processadas{counts.approved + counts.rejected + counts.failed > 0 ? ` (${counts.approved + counts.rejected + counts.failed})` : ''}
        </Tabs.Tab>
        <Tabs.Tab value="config">Configurações</Tabs.Tab>
      </Tabs.List>

      <Tabs.Panel value="pendentes" pt="md">
        <PendentesPanel campaignId={campaignId} onCounts={setCounts} />
      </Tabs.Panel>
      <Tabs.Panel value="processadas" pt="md">
        <ProcessadasPanel campaignId={campaignId} onCounts={setCounts} />
      </Tabs.Panel>
      <Tabs.Panel value="config" pt="md">
        <ConfiguracoesPanel />
      </Tabs.Panel>
    </Tabs>
  );
}

// ── Pendentes ───────────────────────────────────────────────────────────────
function PendentesPanel({ campaignId, onCounts }) {
  const [itens, setItens] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [busca, setBusca] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [progress, setProgress] = useState(null);
  const wasActiveRef = useRef(false);

  const ativo = progress && progress.queued > 0;

  const carregar = useCallback(async () => {
    const [d, p] = await Promise.all([
      api(`/api/campaigns/${campaignId}/entry-requests?tipo=pendentes`),
      api(`/api/campaigns/${campaignId}/entry-requests/progress`),
    ]);
    setItens(d.solicitacoes);
    onCounts?.(d.counts);
    setProgress(p.progress);
    setSelected(new Set());
  }, [campaignId, onCounts]);

  useEffect(() => {
    setLoading(true);
    carregar().finally(() => setLoading(false));
  }, [carregar]);

  // Progresso ao vivo da moderação via Socket.IO.
  useEffect(() => {
    function onProg(d) {
      if (d.campaignId !== campaignId) return;
      setProgress({ queued: d.queued, approved: d.approved, rejected: d.rejected, failed: d.failed, canceled: d.canceled, total: d.total });
    }
    socket.on('entryreq:progress', onProg);
    return () => socket.off('entryreq:progress', onProg);
  }, [campaignId]);

  // Polling de apoio enquanto há rodada em andamento (caso um evento se perca).
  useEffect(() => {
    if (!ativo) return;
    const t = setInterval(async () => {
      try {
        const r = await api(`/api/campaigns/${campaignId}/entry-requests/progress`);
        setProgress(r.progress);
      } catch {
        // ignora — próxima iteração tenta de novo
      }
    }, 5000);
    return () => clearInterval(t);
  }, [ativo, campaignId]);

  // Quando a rodada termina (estava ativa e zerou a fila), recarrega a lista.
  useEffect(() => {
    if (ativo) wasActiveRef.current = true;
    else if (wasActiveRef.current) {
      wasActiveRef.current = false;
      carregar();
    }
  }, [ativo, carregar]);

  const visiveis = useMemo(() => {
    const q = busca.replace(/\D/g, '');
    if (!q) return itens || [];
    return (itens || []).filter((i) => i.numero.replace(/\D/g, '').includes(q));
  }, [itens, busca]);

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected((prev) => (prev.size === visiveis.length ? new Set() : new Set(visiveis.map((i) => i.id))));
  }

  async function sincronizar() {
    setSyncing(true);
    try {
      const r = await api(`/api/campaigns/${campaignId}/entry-requests/sync`, { method: 'POST' });
      const falhou = r.falhas?.length
        ? `\n${r.falhas.length} grupo(s)/conta(s) falharam, verifique se as contas admin estão conectadas.`
        : '';
      window.alert(`Solicitações lidas em ${r.sincronizados}/${r.total} grupo(s).\n${r.pendentes} pendente(s) no momento.${falhou}`);
      await carregar();
    } catch {
      window.alert('Não foi possível sincronizar as solicitações.');
    } finally {
      setSyncing(false);
    }
  }

  async function moderar(acao) {
    const ids = [...selected];
    if (ids.length === 0) return;
    const verbo = acao === 'approve' ? 'Aprovar' : 'Recusar';
    const efeito = acao === 'approve'
      ? 'Cada participante será adicionado ao grupo.'
      : 'Cada solicitação será recusada.';
    const msg =
      `${verbo} ${ids.length} solicitação(ões)?\n\n` +
      `${efeito} A ação é feita devagar e em pacotes (anti-banimento): 45 a 90 segundos entre ` +
      'cada e uma pausa de 30 a 45 minutos a cada 30 por conta. Em lotes grandes pode levar ' +
      'bastante tempo. Você acompanha o progresso aqui e pode cancelar o que ainda não saiu.';
    if (!window.confirm(msg)) return;
    try {
      const r = await api(`/api/campaigns/${campaignId}/entry-requests/process`, {
        method: 'POST',
        body: JSON.stringify({ ids, acao }),
      });
      setProgress(r.progress);
      setSelected(new Set());
      await carregar();
    } catch (err) {
      window.alert(err.message === 'ja_em_andamento' ? 'Já existe uma moderação em andamento.' : 'Não foi possível iniciar a moderação.');
    }
  }

  async function cancelar() {
    if (!window.confirm('Cancelar o que ainda não foi processado? As solicitações voltam para a lista de pendentes.')) return;
    await api(`/api/campaigns/${campaignId}/entry-requests/cancel`, { method: 'POST' });
    const r = await api(`/api/campaigns/${campaignId}/entry-requests/progress`);
    setProgress(r.progress);
    await carregar();
  }

  const processados = progress ? progress.approved + progress.rejected + progress.failed + progress.canceled : 0;
  const pct = progress && progress.total > 0 ? Math.round((processados / progress.total) * 100) : 0;
  const temSelecao = selected.size > 0;

  return (
    <Stack gap="sm">
      <Group justify="space-between" wrap="wrap" align="flex-end">
        <Group gap="xs" align="flex-end">
          <Button leftSection={<IconRefresh size={16} />} onClick={sincronizar} loading={syncing} disabled={ativo}>
            Sincronizar
          </Button>
          <TextInput
            label="Buscar número"
            description="Busca pelo número completo do participante"
            placeholder="Buscar número"
            leftSection={<IconSearch size={14} />}
            value={busca}
            onChange={(e) => setBusca(e.currentTarget.value)}
            w={260}
          />
        </Group>
        {temSelecao && (
          <Group gap="xs">
            <Text size="sm" c="dimmed">{selected.size} selecionada(s)</Text>
            <Button size="xs" variant="light" color="red" leftSection={<IconX size={14} />} onClick={() => moderar('reject')} disabled={ativo}>
              Recusar selecionadas
            </Button>
            <Button size="xs" variant="light" color="whatsapp.8" leftSection={<IconCheck size={14} />} onClick={() => moderar('approve')} disabled={ativo}>
              Aprovar selecionadas
            </Button>
          </Group>
        )}
      </Group>

      {/* Progresso da rodada de moderação (em andamento ou recém-concluída) */}
      {progress && progress.total > 0 && (
        <Stack gap={4}>
          <Group justify="space-between">
            <Text size="sm" fw={500}>{ativo ? 'Processando solicitações…' : 'Moderação concluída'}</Text>
            <Text size="xs" c="dimmed">{processados}/{progress.total}</Text>
          </Group>
          <Progress value={pct} color={ativo ? 'whatsapp.8' : 'gray'} animated={ativo} />
          <Group gap="xs">
            {progress.approved > 0 && <Badge size="xs" variant="light" color="whatsapp.8">aprovadas: {progress.approved}</Badge>}
            {progress.rejected > 0 && <Badge size="xs" variant="light" color="gray">recusadas: {progress.rejected}</Badge>}
            {progress.failed > 0 && <Badge size="xs" variant="light" color="red">falhas: {progress.failed}</Badge>}
            {progress.queued > 0 && <Badge size="xs" variant="light" color="blue">na fila: {progress.queued}</Badge>}
            {ativo && <Button size="compact-xs" variant="subtle" color="red" onClick={cancelar}>Cancelar</Button>}
          </Group>
        </Stack>
      )}

      {loading ? (
        <Center py="xl"><Loader color="whatsapp.8" size="sm" /></Center>
      ) : itens === null ? null : visiveis.length === 0 ? (
        <Stack align="center" py="xl" gap={4}>
          <Text c="dimmed" size="sm">Nenhuma solicitação pendente no momento.</Text>
          <Text c="dimmed" size="xs">Use "Sincronizar" para ler os pedidos de entrada dos grupos com aprovação ligada.</Text>
        </Stack>
      ) : (
        <Table verticalSpacing="xs" highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th w={36}>
                <Checkbox
                  checked={selected.size === visiveis.length && visiveis.length > 0}
                  indeterminate={selected.size > 0 && selected.size < visiveis.length}
                  onChange={toggleAll}
                  disabled={ativo}
                />
              </Table.Th>
              <Table.Th>Número</Table.Th>
              <Table.Th>Grupo</Table.Th>
              <Table.Th>Solicitada em</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {visiveis.map((i) => (
              <Table.Tr key={i.id}>
                <Table.Td><Checkbox checked={selected.has(i.id)} onChange={() => toggle(i.id)} disabled={ativo} /></Table.Td>
                <Table.Td>
                  <Group gap={6} wrap="nowrap">
                    <Text size="sm" ff="monospace">{fmtNumero(i)}</Text>
                    {i.jaEm?.length > 0 && (
                      <Tooltip label={`Já participa de: ${i.jaEm.join(', ')}`} withArrow multiline w={240}>
                        <Badge size="xs" variant="light" color="orange" leftSection={<IconUsersGroup size={10} />}>
                          já em {i.jaEm.length} grupo(s)
                        </Badge>
                      </Tooltip>
                    )}
                  </Group>
                </Table.Td>
                <Table.Td><Text size="sm" c="dimmed">{i.nomeGrupo || '—'}</Text></Table.Td>
                <Table.Td><Text size="xs" c="dimmed">{dataHora(i.criadoEm)}</Text></Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

      {visiveis.length > 0 && (
        <Text c="dimmed" size="xs">
          O selo "já em" indica que o número já participa de outros grupos desta campanha, ou seja, já recebe o conteúdo. Útil para decidir recusar reentradas.
        </Text>
      )}
    </Stack>
  );
}

// ── Processadas ─────────────────────────────────────────────────────────────
function ProcessadasPanel({ campaignId, onCounts }) {
  const [itens, setItens] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api(`/api/campaigns/${campaignId}/entry-requests?tipo=processadas`)
      .then((d) => {
        setItens(d.solicitacoes);
        onCounts?.(d.counts);
      })
      .finally(() => setLoading(false));
  }, [campaignId, onCounts]);

  if (loading) return <Center py="xl"><Loader color="whatsapp.8" size="sm" /></Center>;
  if (!itens || itens.length === 0) {
    return (
      <Center py="xl">
        <Text c="dimmed" size="sm">Nenhuma solicitação processada ainda.</Text>
      </Center>
    );
  }

  const BADGE = {
    approved: { color: 'whatsapp.8', label: 'Aprovada' },
    rejected: { color: 'gray', label: 'Recusada' },
    failed: { color: 'red', label: 'Falhou' },
  };

  return (
    <ScrollArea.Autosize mah={520}>
      <Table verticalSpacing="xs" highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Número</Table.Th>
            <Table.Th>Grupo</Table.Th>
            <Table.Th>Resultado</Table.Th>
            <Table.Th>Processada em</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {itens.map((i) => {
            const b = BADGE[i.status] || BADGE.failed;
            return (
              <Table.Tr key={i.id}>
                <Table.Td><Text size="sm" ff="monospace">{fmtNumero(i)}</Text></Table.Td>
                <Table.Td><Text size="sm" c="dimmed">{i.nomeGrupo || '—'}</Text></Table.Td>
                <Table.Td>
                  <Group gap={6} wrap="nowrap">
                    <Badge size="sm" variant="light" color={b.color}>{b.label}</Badge>
                    {i.status === 'failed' && i.erro && (
                      <Tooltip label={i.erro} withArrow><Text size="xs" c="red" truncate maw={160}>{i.erro}</Text></Tooltip>
                    )}
                  </Group>
                </Table.Td>
                <Table.Td><Text size="xs" c="dimmed">{dataHora(i.processadoEm)}</Text></Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
    </ScrollArea.Autosize>
  );
}

// ── Configurações ───────────────────────────────────────────────────────────
function ConfiguracoesPanel() {
  return (
    <Stack gap="md" maw={720}>
      <Alert variant="light" color="gray" icon={<IconInfoCircle size={16} />}>
        <Text size="sm">
          As solicitações de entrada aparecem quando um grupo exige aprovação de administrador para
          entrar. Os pedidos são lidos das contas admin conectadas em "Sincronizar".
        </Text>
      </Alert>

      <Stack gap={6}>
        <Group gap={8} wrap="nowrap">
          <ThemeIcon size={22} radius="xl" variant="light" color="whatsapp.8"><IconUserCheck size={14} /></ThemeIcon>
          <Text size="sm" fw={500}>Como exigir aprovação num grupo</Text>
        </Group>
        <Text size="sm" c="dimmed">
          Na aba Grupos, selecione os grupos, abra "Alterar em lote" e ative a permissão "exigir
          aprovação de administrador para entrar". A partir daí, quem usar o link de convite entra
          na fila de aprovação.
        </Text>
      </Stack>

      <Stack gap={6}>
        <Group gap={8} wrap="nowrap">
          <ThemeIcon size={22} radius="xl" variant="light" color="orange"><IconAlertTriangle size={14} /></ThemeIcon>
          <Text size="sm" fw={500}>Ritmo de aprovação</Text>
        </Group>
        <Text size="sm" c="dimmed">
          Aprovar adiciona a pessoa ao grupo, então a moderação é feita devagar e em pacotes para
          proteger os números: 45 a 90 segundos entre cada ação e uma pausa de 30 a 45 minutos a
          cada 30 por conta. Contas diferentes trabalham em paralelo.
        </Text>
      </Stack>
    </Stack>
  );
}
