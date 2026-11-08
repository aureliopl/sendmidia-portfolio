import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Stack,
  Group,
  Text,
  Button,
  Table,
  Badge,
  Select,
  TextInput,
  Loader,
  Center,
  Paper,
  SegmentedControl,
  ScrollArea,
} from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { IconDownload, IconSearch, IconArrowDownRight, IconArrowUpRight } from '@tabler/icons-react';
import { api } from '../lib/api';
import { appendLocalRange, endOfLocalDay, formatLocalDateTime } from '../lib/datetime';

const COR_ENTRARAM = '#1D9E75';
const COR_SAIRAM = '#F59F00';

const PERIODOS = [
  { value: '7', label: '7' },
  { value: '14', label: '14' },
  { value: '21', label: '21' },
  { value: '28', label: '28' },
  { value: '0', label: 'Todo período' },
];

// Exibe o número em E.164 ("+" + dígitos). Em grupos LID o telefone real não é exposto:
// mostramos o identificador como veio.
function fmtNumero(a) {
  const ehLid = typeof a.jid === 'string' && a.jid.endsWith('@lid');
  const d = String(a.numero || '').replace(/\D/g, '');
  if (ehLid) return a.numero;
  return d ? `+${d}` : a.numero;
}

function dataHora(v) {
  return formatLocalDateTime(v);
}

// Atividades da campanha (M9.2): histórico de entradas/saídas de participantes nos grupos,
// capturado ao vivo do WhatsApp. Filtros + gráfico de atividade diária + exportar CSV.
export default function CampaignAtividadesTab({ campaignId }) {
  const [grupos, setGrupos] = useState([]);
  const [numero, setNumero] = useState('');
  const [groupId, setGroupId] = useState(null);
  const [evento, setEvento] = useState('todos');
  const [inicio, setInicio] = useState(null);
  const [fim, setFim] = useState(null);

  const [atividades, setAtividades] = useState(null);
  const [loading, setLoading] = useState(true);
  const [truncado, setTruncado] = useState(false);

  const [dias, setDias] = useState('7');
  const [daily, setDaily] = useState(null);

  useEffect(() => {
    api(`/api/campaigns/${campaignId}/groups`).then((d) => setGrupos(d.groups)).catch(() => {});
  }, [campaignId]);

  const carregarLista = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (numero.trim()) params.set('numero', numero.trim());
    if (groupId) params.set('groupId', groupId);
    if (evento !== 'todos') params.set('evento', evento);
    if (inicio) params.set('inicio', new Date(inicio).toISOString());
    if (fim) {
      params.set('fim', endOfLocalDay(fim).toISOString());
    }
    const qs = params.toString();
    try {
      const d = await api(`/api/campaigns/${campaignId}/activities${qs ? `?${qs}` : ''}`);
      setAtividades(d.atividades);
      setTruncado(d.atividades.length >= d.limite);
    } finally {
      setLoading(false);
    }
  }, [campaignId, numero, groupId, evento, inicio, fim]);

  // Pequeno debounce (sobretudo para o campo de número).
  useEffect(() => {
    const t = setTimeout(carregarLista, 300);
    return () => clearTimeout(t);
  }, [carregarLista]);

  const carregarDaily = useCallback(async () => {
    const params = new URLSearchParams({ dias });
    if (dias !== '0') appendLocalRange(params, Number(dias));
    if (groupId) params.set('groupId', groupId);
    try {
      const d = await api(`/api/campaigns/${campaignId}/activities/daily?${params}`);
      setDaily(d);
    } catch {
      // ignora
    }
  }, [campaignId, dias, groupId]);

  useEffect(() => { carregarDaily(); }, [carregarDaily]);

  const grupoOptions = useMemo(() => grupos.map((g) => ({ value: g.id, label: g.nome })), [grupos]);

  function limparFiltros() {
    setNumero('');
    setGroupId(null);
    setEvento('todos');
    setInicio(null);
    setFim(null);
  }

  function exportarCSV() {
    const linhas = [['data', 'numero', 'grupo', 'evento']];
    for (const a of atividades || []) {
      linhas.push([dataHora(a.criadoEm), fmtNumero(a), a.nomeGrupo || '', a.tipo === 'join' ? 'entrou' : 'saiu']);
    }
    const csv = linhas.map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const el = document.createElement('a');
    el.href = url;
    el.download = 'atividades.csv';
    el.click();
    URL.revokeObjectURL(url);
  }

  const temFiltro = numero || groupId || evento !== 'todos' || inicio || fim;

  return (
    <Stack gap="md">
      {/* Gráfico de atividade diária */}
      <Paper withBorder p="md" radius="md">
        <Group justify="space-between" wrap="wrap" mb="sm">
          <Stack gap={2}>
            <Text fw={500} size="sm">Atividade diária</Text>
            <Group gap="md">
              <Group gap={4}><span style={{ width: 10, height: 10, borderRadius: 2, background: COR_ENTRARAM, display: 'inline-block' }} /><Text size="xs" c="dimmed">Entraram: {daily?.totalEntraram ?? 0}</Text></Group>
              <Group gap={4}><span style={{ width: 10, height: 10, borderRadius: 2, background: COR_SAIRAM, display: 'inline-block' }} /><Text size="xs" c="dimmed">Saíram: {daily?.totalSairam ?? 0}</Text></Group>
            </Group>
          </Stack>
          <SegmentedControl size="xs" value={dias} onChange={setDias} data={PERIODOS} />
        </Group>
        <AtividadeDiariaChart serie={daily?.serie || []} />
      </Paper>

      {/* Filtros */}
      <Group gap="sm" wrap="wrap" align="flex-end">
        <TextInput
          label="Número"
          description="Busca pelo número do participante"
          placeholder="Buscar número"
          leftSection={<IconSearch size={14} />}
          value={numero}
          onChange={(e) => setNumero(e.currentTarget.value)}
          w={220}
        />
        <Select label="Grupo" placeholder="Todos" data={grupoOptions} value={groupId} onChange={setGroupId} clearable searchable w={200} />
        <Select
          label="Evento"
          data={[{ value: 'todos', label: 'Todos' }, { value: 'join', label: 'Entraram' }, { value: 'leave', label: 'Saíram' }]}
          value={evento}
          onChange={(v) => setEvento(v || 'todos')}
          allowDeselect={false}
          w={140}
        />
        <DatePickerInput label="Data de início" placeholder="Início" value={inicio} onChange={setInicio} clearable valueFormat="DD/MM/YYYY" w={150} />
        <DatePickerInput label="Data de fim" placeholder="Fim" value={fim} onChange={setFim} clearable valueFormat="DD/MM/YYYY" w={150} />
        {temFiltro && <Button variant="subtle" size="sm" onClick={limparFiltros}>Limpar</Button>}
      </Group>

      <Group justify="space-between">
        <Text fw={500} size="sm">Histórico de atividades</Text>
        <Button variant="default" size="xs" leftSection={<IconDownload size={14} />} onClick={exportarCSV} disabled={!atividades || atividades.length === 0}>
          Exportar histórico
        </Button>
      </Group>

      {loading ? (
        <Center py="xl"><Loader color="whatsapp.8" size="sm" /></Center>
      ) : !atividades || atividades.length === 0 ? (
        <Stack align="center" py="xl" gap={4}>
          <Text c="dimmed" size="sm">Nenhum registro encontrado.</Text>
          <Text c="dimmed" size="xs">As entradas e saídas dos grupos desta campanha aparecem aqui conforme acontecem, com as contas conectadas.</Text>
        </Stack>
      ) : (
        <>
          <ScrollArea.Autosize mah={460}>
            <Table verticalSpacing="xs" highlightOnHover stickyHeader>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Data</Table.Th>
                  <Table.Th>Número</Table.Th>
                  <Table.Th>Grupo</Table.Th>
                  <Table.Th>Evento</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {atividades.map((a) => (
                  <Table.Tr key={a.id}>
                    <Table.Td><Text size="xs" c="dimmed">{dataHora(a.criadoEm)}</Text></Table.Td>
                    <Table.Td><Text size="sm" ff="monospace">{fmtNumero(a)}</Text></Table.Td>
                    <Table.Td><Text size="sm" c="dimmed">{a.nomeGrupo || '—'}</Text></Table.Td>
                    <Table.Td>
                      {a.tipo === 'join' ? (
                        <Badge size="sm" variant="light" color="whatsapp.8" leftSection={<IconArrowUpRight size={11} />}>Entrou</Badge>
                      ) : (
                        <Badge size="sm" variant="light" color="orange" leftSection={<IconArrowDownRight size={11} />}>Saiu</Badge>
                      )}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea.Autosize>
          {truncado && (
            <Text c="dimmed" size="xs">Mostrando os 1000 registros mais recentes. Refine os filtros para ver um intervalo específico.</Text>
          )}
        </>
      )}
    </Stack>
  );
}

// ── Gráfico de barras (SVG puro, sem dependência) ───────────────────────────
function AtividadeDiariaChart({ serie }) {
  if (!serie || serie.length === 0) {
    return <Center h={180}><Text c="dimmed" size="sm">Sem dados no período.</Text></Center>;
  }
  const W = Math.max(560, serie.length * 24);
  const H = 200;
  const padL = 28;
  const padB = 26;
  const padT = 8;
  const plotW = W - padL - 8;
  const plotH = H - padT - padB;
  const maxVal = Math.max(1, ...serie.flatMap((d) => [d.entraram, d.sairam]));
  const grupoW = plotW / serie.length;
  const barW = Math.max(2, Math.min(10, grupoW * 0.32));
  const y0 = padT + plotH;

  // até ~8 rótulos de data no eixo X
  const passo = Math.max(1, Math.ceil(serie.length / 8));

  function rotuloDia(dia) {
    const [, m, d] = dia.split('-');
    return `${d}/${m}`;
  }

  return (
    <ScrollArea type="auto" offsetScrollbars>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label="Gráfico de entradas e saídas por dia" style={{ minWidth: serie.length > 28 ? W : undefined }}>
        {/* eixo Y: base e topo */}
        <line x1={padL} y1={y0} x2={padL + plotW} y2={y0} stroke="var(--mantine-color-gray-3)" strokeWidth="1" />
        <line x1={padL} y1={padT} x2={padL + plotW} y2={padT} stroke="var(--mantine-color-gray-2)" strokeWidth="1" strokeDasharray="3 3" />
        <text x={padL - 6} y={padT + 4} textAnchor="end" fontSize="9" fill="var(--mantine-color-gray-6)">{maxVal}</text>
        <text x={padL - 6} y={y0} textAnchor="end" fontSize="9" fill="var(--mantine-color-gray-6)">0</text>

        {serie.map((d, i) => {
          const gx = padL + i * grupoW;
          const hE = (d.entraram / maxVal) * plotH;
          const hS = (d.sairam / maxVal) * plotH;
          const cx = gx + grupoW / 2;
          return (
            <g key={d.dia}>
              <rect x={cx - barW - 1} y={y0 - hE} width={barW} height={hE} fill={COR_ENTRARAM} rx="1">
                <title>{`${rotuloDia(d.dia)}: ${d.entraram} entraram`}</title>
              </rect>
              <rect x={cx + 1} y={y0 - hS} width={barW} height={hS} fill={COR_SAIRAM} rx="1">
                <title>{`${rotuloDia(d.dia)}: ${d.sairam} saíram`}</title>
              </rect>
              {i % passo === 0 && (
                <text x={cx} y={H - 8} textAnchor="middle" fontSize="9" fill="var(--mantine-color-gray-6)">{rotuloDia(d.dia)}</text>
              )}
            </g>
          );
        })}
      </svg>
    </ScrollArea>
  );
}
