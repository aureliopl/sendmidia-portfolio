import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Stack,
  Group,
  Text,
  Button,
  ActionIcon,
  Box,
  Tooltip,
  Loader,
  Center,
  ScrollArea,
  Badge,
} from '@mantine/core';
import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react';
import dayjs from 'dayjs';
import { api } from '../lib/api';

const DIAS_SEMANA = ['dom.', 'seg.', 'ter.', 'qua.', 'qui.', 'sex.', 'sáb.'];

// Status do disparo → cor + rótulo (espelha a aba Ações/M8).
const STATUS = {
  scheduled: { cor: 'blue', label: 'Agendado' },
  queued: { cor: 'gray', label: 'Na fila' },
  processing: { cor: 'orange', label: 'Processando' },
  sent: { cor: 'whatsapp.8', label: 'Enviado' },
  failed: { cor: 'red', label: 'Falhou' },
};

// Calendário da campanha (M9.4): visão mensal dos disparos agendados (ScheduledSend). Read-only.
export default function CampaignCalendarTab({ campaignId }) {
  const [cursor, setCursor] = useState(() => dayjs().startOf('month'));
  const [eventos, setEventos] = useState([]);
  const [loading, setLoading] = useState(true);

  // Grade de 6 semanas (42 dias) a partir do domingo da semana do dia 1.
  const inicioGrade = useMemo(() => cursor.startOf('month').startOf('week'), [cursor]);
  const dias = useMemo(() => Array.from({ length: 42 }, (_, i) => inicioGrade.add(i, 'day')), [inicioGrade]);

  const carregar = useCallback(async () => {
    setLoading(true);
    const de = inicioGrade.toISOString();
    const ate = inicioGrade.add(41, 'day').endOf('day').toISOString();
    try {
      const d = await api(`/api/campaigns/${campaignId}/calendar?de=${encodeURIComponent(de)}&ate=${encodeURIComponent(ate)}`);
      setEventos(d.eventos);
    } finally {
      setLoading(false);
    }
  }, [campaignId, inicioGrade]);

  useEffect(() => { carregar(); }, [carregar]);

  // Eventos agrupados por dia (YYYY-MM-DD).
  const porDia = useMemo(() => {
    const mapa = new Map();
    for (const ev of eventos) {
      const k = dayjs(ev.agendadoPara).format('YYYY-MM-DD');
      if (!mapa.has(k)) mapa.set(k, []);
      mapa.get(k).push(ev);
    }
    return mapa;
  }, [eventos]);

  const hoje = dayjs().format('YYYY-MM-DD');
  const mesAno = cursor.toDate().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

  return (
    <Stack gap="sm">
      <Group justify="space-between" wrap="wrap">
        <Group gap="xs">
          <ActionIcon variant="default" onClick={() => setCursor((c) => c.subtract(1, 'month'))} aria-label="Mês anterior"><IconChevronLeft size={16} /></ActionIcon>
          <Text fw={600} tt="capitalize" miw={150} ta="center">{mesAno}</Text>
          <ActionIcon variant="default" onClick={() => setCursor((c) => c.add(1, 'month'))} aria-label="Próximo mês"><IconChevronRight size={16} /></ActionIcon>
        </Group>
        <Group gap="xs">
          {loading && <Loader size="xs" color="whatsapp.8" />}
          <Button variant="default" size="xs" onClick={() => setCursor(dayjs().startOf('month'))}>Hoje</Button>
        </Group>
      </Group>

      <ScrollArea type="auto">
        <Box miw={680}>
          {/* Cabeçalho dom-sáb */}
          <Box style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
            {DIAS_SEMANA.map((d) => (
              <Text key={d} size="xs" c="dimmed" ta="right" px={6} py={4}>{d}</Text>
            ))}
          </Box>
          {/* Grade de dias */}
          <Box
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(7, 1fr)',
              border: '1px solid var(--mantine-color-gray-3)',
              borderBottom: 'none',
            }}
          >
            {dias.map((dia) => {
              const k = dia.format('YYYY-MM-DD');
              const foraDoMes = dia.month() !== cursor.month();
              const ehHoje = k === hoje;
              const evs = porDia.get(k) || [];
              return (
                <Box
                  key={k}
                  style={{
                    borderRight: '1px solid var(--mantine-color-gray-3)',
                    borderBottom: '1px solid var(--mantine-color-gray-3)',
                    minHeight: 96,
                    padding: 4,
                    background: foraDoMes ? 'var(--mantine-color-gray-0)' : undefined,
                  }}
                >
                  <Group justify="flex-end" gap={0} mb={2}>
                    <Text
                      size="xs"
                      fw={ehHoje ? 700 : 400}
                      c={ehHoje ? 'whatsapp.8' : foraDoMes ? 'dimmed' : undefined}
                    >
                      {dia.date()}
                    </Text>
                  </Group>
                  <Stack gap={2}>
                    {evs.slice(0, 3).map((ev) => <EventoChip key={ev.id} ev={ev} />)}
                    {evs.length > 3 && <Text size="9px" c="dimmed" px={2}>+{evs.length - 3} mais</Text>}
                  </Stack>
                </Box>
              );
            })}
          </Box>
        </Box>
      </ScrollArea>

      {!loading && eventos.length === 0 && (
        <Text c="dimmed" size="xs" ta="center">Nenhum agendamento neste mês. Crie um disparo na aba Ações.</Text>
      )}
    </Stack>
  );
}

function EventoChip({ ev }) {
  const st = STATUS[ev.status] || STATUS.scheduled;
  const hora = dayjs(ev.agendadoPara).format('HH:mm');
  const label = `${hora} · ${ev.grupos} grupo(s)`;
  const detalhe = `${hora} · ${st.label}\n${ev.grupos} grupo(s)${ev.conta ? ` · ${ev.conta}` : ''}${ev.preview ? `\n"${ev.preview}"` : ''}`;
  return (
    <Tooltip label={detalhe} withArrow multiline w={240} style={{ whiteSpace: 'pre-line' }}>
      <Badge
        variant="light"
        color={st.cor}
        size="sm"
        radius="sm"
        fullWidth
        styles={{ root: { cursor: 'default', justifyContent: 'flex-start' }, label: { overflow: 'hidden', textOverflow: 'ellipsis' } }}
      >
        {label}
      </Badge>
    </Tooltip>
  );
}
