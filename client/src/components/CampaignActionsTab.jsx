import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Stack,
  Group,
  Text,
  Badge,
  ActionIcon,
  Progress,
  Loader,
  Center,
  Paper,
  Grid,
  Avatar,
  Tabs,
  Menu,
  ThemeIcon,
  Divider,
  Pagination,
  Select,
  ScrollArea,
} from '@mantine/core';
import {
  IconDotsVertical,
  IconFilePlus,
  IconCalendarTime,
  IconPlayerPlay,
  IconFlag,
  IconClock,
  IconGauge,
  IconRefresh,
  IconX,
  IconTrash,
  IconSpeakerphone,
  IconDeviceMobile,
  IconAlertTriangle,
} from '@tabler/icons-react';
import { api } from '../lib/api';
import { socket } from '../lib/socket';
import { VELOCIDADES } from '../lib/velocidades';
import { formatLocalDateTime } from '../lib/datetime';
import { LinhaBalao, WALLPAPER } from './BlocoBalao';

const STATUS = {
  scheduled: { color: 'blue', label: 'Agendado' },
  processing: { color: 'orange', label: 'Processando' },
  sent: { color: 'whatsapp.8', label: 'Sucesso' },
  failed: { color: 'red', label: 'Falhou' },
};

const ABAS = [
  { value: 'todos', label: 'Visão geral' },
  { value: 'scheduled', label: 'Agendado' },
  { value: 'processing', label: 'Processando' },
  { value: 'sent', label: 'Sucesso' },
  { value: 'failed', label: 'Falhas' },
];

function fmt(iso) {
  if (!iso) return null;
  return formatLocalDateTime(iso, { seconds: true });
}

function duracao(ini, fim) {
  if (!ini || !fim) return null;
  const ms = new Date(fim).getTime() - new Date(ini).getTime();
  if (ms < 0) return null;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.round((ms % 60000) / 1000);
  return `${m}m ${s}s`;
}

function velocidadeLabel(perfil) {
  return VELOCIDADES.find((v) => v.value === perfil)?.label || perfil;
}

function iniciais(nome) {
  return (nome || '?').split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('');
}

const FINAL_TARGET_STATUSES = ['sent', 'failed', 'skipped'];

function sendTargetStats(s) {
  const targets = Array.isArray(s.targets) ? s.targets : [];
  const resultado = Array.isArray(s.resultado) ? s.resultado : [];
  if (targets.length > 0) {
    const enviados = targets.filter((t) => t.status === 'sent').length;
    const falhas = targets.filter((t) => t.status === 'failed' || t.status === 'skipped').length;
    const processados = targets.filter((t) => FINAL_TARGET_STATUSES.includes(t.status)).length;
    return { total: targets.length, enviados, falhas, processados };
  }
  return {
    total: s.gruposAlvo?.length || 0,
    enviados: resultado.filter((r) => r.ok).length,
    falhas: resultado.filter((r) => !r.ok).length,
    processados: resultado.length,
  };
}

// Agrupa os disparos (1 por conta) em containers de "ação" pelo loteId (fallback: mensagem +
// horário, para ações antigas sem loteId). Cada container = uma ordem lançada pelo dono.
function agruparEmContainers(sends) {
  const mapa = new Map();
  for (const s of sends) {
    const chave = s.loteId || `${s.messageId}|${s.agendadoPara}`;
    if (!mapa.has(chave)) mapa.set(chave, []);
    mapa.get(chave).push(s);
  }
  const containers = [];
  for (const [chave, lote] of mapa) {
    const ordenados = [...lote].sort((a, b) => new Date(a.criadoEm) - new Date(b.criadoEm));
    const first = ordenados[0];
    let totalGrupos = 0;
    let enviados = 0;
    let falhas = 0;
    for (const s of ordenados) {
      const stats = sendTargetStats(s);
      totalGrupos += stats.total;
      enviados += stats.enviados;
      falhas += stats.falhas;
    }
    const st = ordenados.map((s) => s.status);
    let status;
    if (st.includes('processing')) status = 'processing';
    else if (st.includes('scheduled')) status = 'scheduled';
    else if (st.every((x) => x === 'sent')) status = 'sent';
    else if (st.every((x) => x === 'failed')) status = 'failed';
    else status = st.includes('sent') ? 'sent' : 'failed';

    const datas = (campo) => ordenados.map((s) => s[campo]).filter(Boolean).map((d) => new Date(d).getTime());
    const minC = datas('criadoEm');
    const minI = datas('iniciadoEm');
    const maxF = datas('finalizadoEm');
    const finalizado = ['sent', 'failed'].includes(status) && maxF.length
      ? new Date(Math.max(...maxF)).toISOString()
      : null;

    containers.push({
      chave,
      message: first.message,
      sends: ordenados,
      totalGrupos,
      enviados,
      falhas,
      status,
      perfil: first.perfilVelocidade,
      criado: minC.length ? new Date(Math.min(...minC)).toISOString() : null,
      agendado: first.agendadoPara,
      iniciado: minI.length ? new Date(Math.min(...minI)).toISOString() : null,
      finalizado,
    });
  }
  containers.sort((a, b) => new Date(b.criado || 0) - new Date(a.criado || 0));
  return containers;
}

const TAMANHOS_PAGINA = [
  { value: '10', label: '10 por página' },
  { value: '30', label: '30 por página' },
  { value: '50', label: '50 por página' },
  { value: '100', label: '100 por página' },
];

function scrollTopo() {
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

export default function CampaignActionsTab({ campaignId, campaignName }) {
  const [sends, setSends] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState({}); // sendId -> { done, total }
  const [filtro, setFiltro] = useState('todos');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Carrega SOMENTE a página atual (por container), filtrada por status no servidor.
  const load = useCallback(async () => {
    const d = await api(`/api/campaigns/${campaignId}/sends?page=${page}&pageSize=${pageSize}&status=${filtro}`);
    setSends(d.sends);
    setTotal(typeof d.total === 'number' ? d.total : d.sends.length);
  }, [campaignId, page, pageSize, filtro]);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  useEffect(() => {
    function onProgress(d) {
      setProgress((prev) => ({ ...prev, [d.sendId]: { done: d.done, total: d.total } }));
      load();
    }
    function onStatus(d) {
      if (d.status === 'sent' || d.status === 'failed') {
        setProgress((prev) => {
          const next = { ...prev };
          delete next[d.sendId];
          return next;
        });
      }
      load();
    }
    socket.on('send:progress', onProgress);
    socket.on('send:status', onStatus);
    return () => {
      socket.off('send:progress', onProgress);
      socket.off('send:status', onStatus);
    };
  }, [load]);

  // O servidor já paginou e filtrou por status; aqui só agrupamos os disparos da página em containers.
  const containers = useMemo(() => agruparEmContainers(sends), [sends]);
  const totalPaginas = Math.max(1, Math.ceil(total / pageSize));

  // Se a página atual sumir (exclusão), volta para a última válida.
  useEffect(() => {
    if (page > totalPaginas) setPage(totalPaginas);
  }, [page, totalPaginas]);

  function mudarFiltro(v) {
    setFiltro(v || 'todos');
    setPage(1);
  }
  function mudarPagina(v) {
    setPage(v);
    scrollTopo();
  }
  function mudarTamanho(v) {
    setPageSize(Number(v));
    setPage(1);
    scrollTopo();
  }

  async function reprocessar(c, somenteErros = false) {
    await api('/api/sends/batch/reprocess', { method: 'POST', body: JSON.stringify({ ids: c.sends.map((s) => s.id), somenteErros }) });
    load();
  }
  async function cancelar(c) {
    const ids = c.sends.filter((s) => s.status === 'scheduled').map((s) => s.id);
    if (ids.length === 0) return;
    if (!window.confirm(`Cancelar ${ids.length} disparo(s) agendado(s) desta ação?`)) return;
    await api('/api/sends/batch/cancel', { method: 'POST', body: JSON.stringify({ ids }) });
    load();
  }
  async function excluir(c) {
    if (!window.confirm('Excluir esta ação do histórico? (não desfaz o que já foi enviado)')) return;
    await api('/api/sends/batch/delete', { method: 'POST', body: JSON.stringify({ ids: c.sends.map((s) => s.id) }) });
    load();
  }

  if (loading) return <Center py="lg"><Loader color="whatsapp.8" size="sm" /></Center>;

  return (
    <Stack gap="md">
      <Tabs value={filtro} onChange={mudarFiltro}>
        <Tabs.List>
          {ABAS.map((a) => <Tabs.Tab key={a.value} value={a.value}>{a.label}</Tabs.Tab>)}
        </Tabs.List>
      </Tabs>

      {total === 0 ? (
        <Text c="dimmed" size="sm" ta="center" py="xl">
          {filtro === 'todos'
            ? 'Nenhuma ação ainda. Dispare ou agende uma mensagem na aba Mensagens para vê-la aqui.'
            : 'Nenhuma ação com este status.'}
        </Text>
      ) : (
        <>
          {containers.map((c) => (
            <ActionContainer
              key={c.chave}
              c={c}
              campaignName={campaignName}
              progress={progress}
              onReprocess={() => reprocessar(c)}
              onReprocessErros={() => reprocessar(c, true)}
              onCancel={() => cancelar(c)}
              onDelete={() => excluir(c)}
            />
          ))}

          {/* Paginação */}
          <Group justify="space-between" wrap="wrap" gap="sm" mt="xs">
            <Select
              size="xs"
              data={TAMANHOS_PAGINA}
              value={String(pageSize)}
              onChange={mudarTamanho}
              allowDeselect={false}
              w={150}
              aria-label="Itens por página"
            />
            <Group gap="sm" wrap="nowrap">
              <Text c="dimmed" size="xs">{total} ação(ões)</Text>
              {totalPaginas > 1 && (
                <Pagination total={totalPaginas} value={page} onChange={mudarPagina} size="sm" color="whatsapp.8" />
              )}
            </Group>
          </Group>
        </>
      )}
    </Stack>
  );
}

function ActionContainer({ c, campaignName, progress, onReprocess, onReprocessErros, onCancel, onDelete }) {
  const st = STATUS[c.status] || STATUS.scheduled;
  const temAgendado = c.sends.some((s) => s.status === 'scheduled');
  const temFalha = c.sends.some((s) => s.status === 'failed');
  const jaRodou = c.sends.some((s) => s.status === 'sent' || s.status === 'failed');

  return (
    <Paper withBorder radius="md" style={{ overflow: 'hidden' }}>
      {/* Header */}
      <Group justify="space-between" wrap="nowrap" px="md" py="xs" bg="var(--mantine-color-gray-0)">
        <Text fw={600} size="sm">Enviar mensagens</Text>
        <Group gap="xs" wrap="nowrap">
          <Badge variant="light" color="gray" size="sm">{c.totalGrupos} grupo(s)</Badge>
          {c.enviados > 0 && <Badge variant="light" color="whatsapp.8" size="sm">{c.enviados} enviado(s)</Badge>}
          {c.falhas > 0 && <Badge variant="light" color="red" size="sm">{c.falhas} falha(s)</Badge>}
          <Badge variant="dot" color={st.color} size="sm">{st.label}</Badge>
          <Menu shadow="md" position="bottom-end" withinPortal>
            <Menu.Target>
              <ActionIcon variant="subtle" color="gray" aria-label="Opções da ação"><IconDotsVertical size={16} /></ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item leftSection={<IconRefresh size={14} />} onClick={onReprocess} disabled={!jaRodou}>Reprocessar</Menu.Item>
              <Menu.Item leftSection={<IconAlertTriangle size={14} />} onClick={onReprocessErros} disabled={!temFalha}>Reenviar com erro</Menu.Item>
              <Menu.Item leftSection={<IconX size={14} />} color="red" onClick={onCancel} disabled={!temAgendado}>Cancelar</Menu.Item>
              <Menu.Divider />
              <Menu.Item leftSection={<IconTrash size={14} />} color="red" onClick={onDelete}>Excluir</Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>
      </Group>
      <Divider />

      {/* Corpo: mensagem | detalhes | progresso por conta */}
      <Grid gutter={0}>
        {/* Coluna 1 — a mensagem inteira em balões, cara de conversa do WhatsApp (igual à aba Mensagens) */}
        <Grid.Col span={{ base: 12, md: 5 }} p="md">
          <Paper radius="md" p="xs" style={{ background: WALLPAPER }}>
            <ScrollArea.Autosize mah={300} type="auto">
              <Stack gap={6}>
                {(c.message?.blocos?.length ? c.message.blocos : [{ tipo: 'texto', conteudo: c.message?.conteudo || '—' }]).map((b, i) => (
                  <LinhaBalao key={i} bloco={b} maxMidia={150} />
                ))}
              </Stack>
            </ScrollArea.Autosize>
          </Paper>
        </Grid.Col>

        {/* Coluna 2 — detalhes/timeline */}
        <Grid.Col span={{ base: 12, md: 3 }} p="md">
          <Stack gap={8}>
            <Group gap={6} wrap="nowrap"><IconSpeakerphone size={14} style={{ color: 'var(--mantine-color-whatsapp-8)' }} /><Text size="xs" c="dimmed">{campaignName || 'Campanha'}</Text></Group>
            <Divider variant="dashed" />
            <Linha icon={<IconFilePlus size={13} />} label="Criado" valor={fmt(c.criado)} />
            <Linha icon={<IconCalendarTime size={13} />} label="Agendado" valor={fmt(c.agendado)} />
            <Linha icon={<IconPlayerPlay size={13} />} label="Iniciado" valor={fmt(c.iniciado)} />
            <Linha icon={<IconFlag size={13} />} label="Finalizado" valor={fmt(c.finalizado)} />
            <Linha icon={<IconClock size={13} />} label="Duração" valor={duracao(c.iniciado, c.finalizado)} />
            <Linha icon={<IconGauge size={13} />} label="Velocidade" valor={velocidadeLabel(c.perfil)} />
          </Stack>
        </Grid.Col>

        {/* Coluna 3 — processo por conta */}
        <Grid.Col span={{ base: 12, md: 4 }} p="md" bg="var(--mantine-color-gray-0)">
          <Stack gap="sm">
            {c.sends.map((s) => <ContaProgresso key={s.id} s={s} prog={progress[s.id]} />)}
          </Stack>
        </Grid.Col>
      </Grid>
    </Paper>
  );
}

function Linha({ icon, label, valor }) {
  if (!valor) return null;
  return (
    <Group gap={6} wrap="nowrap" align="center">
      <ThemeIcon size={18} radius="sm" variant="light" color="gray">{icon}</ThemeIcon>
      <Text size="xs" c="dimmed" w={64}>{label}</Text>
      <Text size="xs">{valor}</Text>
    </Group>
  );
}

function ContaProgresso({ s, prog }) {
  const st = STATUS[s.status] || STATUS.scheduled;
  const stats = sendTargetStats(s);
  const total = stats.total;
  const enviados = stats.enviados;
  const falhas = stats.falhas;
  const processados = Math.max(stats.processados, prog?.done || 0);
  const emProgresso = s.status === 'processing' && prog;
  return (
    <Paper withBorder radius="sm" p="xs">
      <Group justify="space-between" wrap="nowrap" mb={4}>
        <Group gap={6} wrap="nowrap">
          <Avatar size={22} radius="xl" color="whatsapp.8">{iniciais(s.account?.nome)}</Avatar>
          <Text size="sm" fw={500} lineClamp={1}>{s.account?.nome || 'Conta'}</Text>
        </Group>
        <Badge size="xs" variant="dot" color={st.color}>{st.label}</Badge>
      </Group>
      <Group gap={6} wrap="wrap">
        <Group gap={3} wrap="nowrap"><IconDeviceMobile size={12} style={{ color: 'var(--mantine-color-gray-6)' }} /><Text size="xs" c="dimmed">{total} grupo(s)</Text></Group>
        <Text size="xs" c="whatsapp.8">{enviados} enviado(s)</Text>
        {falhas > 0 && <Text size="xs" c="red">{falhas} falha(s)</Text>}
      </Group>
      {(emProgresso || (s.status === 'processing' && processados > 0)) && (
        <Stack gap={2} mt={4}>
          <Text size="xs" c="dimmed">{processados}/{prog?.total || total}</Text>
          <Progress value={(processados / Math.max(1, prog?.total || total)) * 100} size="xs" color="orange" animated />
        </Stack>
      )}
    </Paper>
  );
}
