import { useCallback, useEffect, useState } from 'react';
import {
  Stack,
  Group,
  Text,
  Button,
  Table,
  Badge,
  TextInput,
  Loader,
  Center,
  Paper,
  SegmentedControl,
  Pagination,
  Alert,
  ScrollArea,
} from '@mantine/core';
import { IconDownload, IconSearch, IconMoodSmile, IconInfoCircle } from '@tabler/icons-react';
import { api } from '../lib/api';
import { localRangeForLastDays, localRangeForLastHours } from '../lib/datetime';

const COR_BARRA = '#1D9E75';
const PER_PAGE = 25;

function fmtNumero(l) {
  const ehLid = typeof l.jid === 'string' && l.jid.endsWith('@lid');
  const d = String(l.numero || '').replace(/\D/g, '');
  if (ehLid) return l.numero;
  return d ? `+${d}` : l.numero;
}

// Leadscoring da campanha (M9.3): pontuação por número a partir das reações dos membros às
// mensagens disparadas. Busca, gráfico de volume (por hora/dia), ranking paginado e exportar.
export default function CampaignLeadscoringTab({ campaignId }) {
  const [busca, setBusca] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [unidade, setUnidade] = useState('dia');
  const [vol, setVol] = useState(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), perPage: String(PER_PAGE) });
    if (busca.trim()) params.set('busca', busca.trim());
    try {
      const d = await api(`/api/campaigns/${campaignId}/leadscore?${params}`);
      setData(d);
    } finally {
      setLoading(false);
    }
  }, [campaignId, page, busca]);

  useEffect(() => {
    const t = setTimeout(carregar, 300);
    return () => clearTimeout(t);
  }, [carregar]);

  const carregarVol = useCallback(async () => {
    try {
      const range = unidade === 'hora' ? localRangeForLastHours(24) : localRangeForLastDays(7);
      const params = new URLSearchParams({ unidade, dias: '7', de: range.de, ate: range.ate });
      const d = await api(`/api/campaigns/${campaignId}/leadscore/volume?${params}`);
      setVol(d);
    } catch {
      // ignora
    }
  }, [campaignId, unidade]);

  useEffect(() => { carregarVol(); }, [carregarVol]);

  function onBusca(v) {
    setBusca(v);
    setPage(1);
  }

  async function exportar() {
    const d = await api(`/api/campaigns/${campaignId}/leadscore/export`);
    const linhas = [['posicao', 'numero', 'pontos', 'eventos']];
    (d.leads || []).forEach((l, i) => linhas.push([i + 1, `+${String(l.numero).replace(/\D/g, '')}`, l.pontos, l.eventos]));
    const csv = linhas.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'leadscoring.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  const leads = data?.leads || [];
  const total = data?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
  const peso = data?.pesoReacao ?? 50;

  return (
    <Stack gap="md">
      <Alert variant="light" color="gray" icon={<IconInfoCircle size={16} />} p="xs">
        <Group gap={8}>
          <Badge variant="light" color="whatsapp.8" leftSection={<IconMoodSmile size={12} />}>Reagiu: {peso} pts</Badge>
          <Text size="xs">
            A pontuação vem das reações dos membros às mensagens disparadas pela campanha, capturadas conforme acontecem com as contas conectadas.
          </Text>
        </Group>
      </Alert>

      {/* Gráfico de volume */}
      <Paper withBorder p="md" radius="md">
        <Group justify="space-between" wrap="wrap" mb="sm">
          <Stack gap={2}>
            <Text fw={500} size="sm">Volume de reações</Text>
            <Text size="xs" c="dimmed">{unidade === 'hora' ? 'Últimas 24 horas' : 'Últimos 7 dias'}: {vol?.total ?? 0}</Text>
          </Stack>
          <SegmentedControl
            size="xs"
            value={unidade}
            onChange={setUnidade}
            data={[{ value: 'hora', label: 'Por hora' }, { value: 'dia', label: 'Por dia' }]}
          />
        </Group>
        <VolumeChart serie={vol?.serie || []} />
      </Paper>

      {/* Busca + exportar */}
      <Group justify="space-between" wrap="wrap" align="flex-end">
        <TextInput
          label="Buscar número"
          placeholder="Buscar número"
          leftSection={<IconSearch size={14} />}
          value={busca}
          onChange={(e) => onBusca(e.currentTarget.value)}
          w={240}
        />
        <Button variant="default" size="xs" leftSection={<IconDownload size={14} />} onClick={exportar} disabled={total === 0}>
          Exportar
        </Button>
      </Group>

      {loading ? (
        <Center py="xl"><Loader color="whatsapp.8" size="sm" /></Center>
      ) : leads.length === 0 ? (
        <Stack align="center" py="xl" gap={4}>
          <Text c="dimmed" size="sm">Nenhum registro encontrado.</Text>
          <Text c="dimmed" size="xs">Quando os membros reagirem às mensagens da campanha, a pontuação aparece aqui.</Text>
        </Stack>
      ) : (
        <>
          <ScrollArea.Autosize mah={520}>
            <Table verticalSpacing="xs" highlightOnHover stickyHeader>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={48}>#</Table.Th>
                  <Table.Th>Número</Table.Th>
                  <Table.Th>Pontos</Table.Th>
                  <Table.Th>Reações</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {leads.map((l, i) => (
                  <Table.Tr key={l.numero}>
                    <Table.Td><Text size="sm" c="dimmed">{(page - 1) * PER_PAGE + i + 1}</Text></Table.Td>
                    <Table.Td><Text size="sm" ff="monospace">{fmtNumero(l)}</Text></Table.Td>
                    <Table.Td><Text size="sm" fw={600}>{l.pontos}</Text></Table.Td>
                    <Table.Td><Text size="sm" c="dimmed">{l.eventos}</Text></Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea.Autosize>
          <Group justify="space-between" wrap="wrap">
            <Text size="xs" c="dimmed">{total} número(s) pontuado(s)</Text>
            {totalPages > 1 && <Pagination size="sm" value={page} onChange={setPage} total={totalPages} color="whatsapp.8" />}
          </Group>
        </>
      )}
    </Stack>
  );
}

// ── Gráfico de barras de volume (SVG puro) ──────────────────────────────────
function VolumeChart({ serie }) {
  if (!serie || serie.length === 0) {
    return <Center h={160}><Text c="dimmed" size="sm">Sem dados no período.</Text></Center>;
  }
  const W = Math.max(560, serie.length * 22);
  const H = 180;
  const padL = 28;
  const padB = 24;
  const padT = 8;
  const plotW = W - padL - 8;
  const plotH = H - padT - padB;
  const maxVal = Math.max(1, ...serie.map((d) => d.valor));
  const grupoW = plotW / serie.length;
  const barW = Math.max(3, Math.min(16, grupoW * 0.6));
  const y0 = padT + plotH;
  const passo = Math.max(1, Math.ceil(serie.length / 8));

  return (
    <ScrollArea type="auto" offsetScrollbars>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label="Volume de reações por período" style={{ minWidth: serie.length > 28 ? W : undefined }}>
        <line x1={padL} y1={y0} x2={padL + plotW} y2={y0} stroke="var(--mantine-color-gray-3)" strokeWidth="1" />
        <line x1={padL} y1={padT} x2={padL + plotW} y2={padT} stroke="var(--mantine-color-gray-2)" strokeWidth="1" strokeDasharray="3 3" />
        <text x={padL - 6} y={padT + 4} textAnchor="end" fontSize="9" fill="var(--mantine-color-gray-6)">{maxVal}</text>
        <text x={padL - 6} y={y0} textAnchor="end" fontSize="9" fill="var(--mantine-color-gray-6)">0</text>
        {serie.map((d, i) => {
          const gx = padL + i * grupoW;
          const h = (d.valor / maxVal) * plotH;
          const cx = gx + grupoW / 2;
          return (
            <g key={`${d.rotulo}-${i}`}>
              <rect x={cx - barW / 2} y={y0 - h} width={barW} height={h} fill={COR_BARRA} rx="1">
                <title>{`${d.rotulo}: ${d.valor}`}</title>
              </rect>
              {i % passo === 0 && (
                <text x={cx} y={H - 7} textAnchor="middle" fontSize="9" fill="var(--mantine-color-gray-6)">{d.rotulo}</text>
              )}
            </g>
          );
        })}
      </svg>
    </ScrollArea>
  );
}
