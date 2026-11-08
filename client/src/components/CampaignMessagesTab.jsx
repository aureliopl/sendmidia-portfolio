import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Stack,
  Group,
  Text,
  Button,
  Card,
  Badge,
  ActionIcon,
  Menu,
  Loader,
  Center,
  Tooltip,
  Paper,
  SimpleGrid,
  ScrollArea,
  Pagination,
  Select,
  Modal,
  Box,
} from '@mantine/core';
import {
  IconPlus,
  IconDots,
  IconPencil,
  IconCopy,
  IconTrash,
  IconPhoto,
  IconLink,
  IconStack2,
  IconSend,
} from '@tabler/icons-react';
import { api } from '../lib/api';
import MessageComposerModal from './MessageComposerModal';
import SendScheduleModal from './SendScheduleModal';
import { LinhaBalao, WALLPAPER } from './BlocoBalao';

const TAMANHOS_PAGINA = [
  { value: '10', label: '10 por página' },
  { value: '30', label: '30 por página' },
  { value: '50', label: '50 por página' },
  { value: '100', label: '100 por página' },
];

// Rola a área principal para o topo (usabilidade ao trocar de página).
function scrollTopo() {
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Rótulo do separador de data (como o divisor de dia de uma conversa do WhatsApp).
function rotuloData(iso) {
  const d = new Date(iso);
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const dia = new Date(d);
  dia.setHours(0, 0, 0, 0);
  const diffDias = Math.round((hoje - dia) / 86400000);
  if (diffDias === 0) return 'Hoje';
  if (diffDias === 1) return 'Ontem';
  return d.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: d.getFullYear() === hoje.getFullYear() ? undefined : 'numeric',
  });
}

function chaveData(iso) {
  const d = new Date(iso);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function horaDe(iso) {
  try {
    return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export default function CampaignMessagesTab({ campaignId }) {
  const navigate = useNavigate();
  const [messages, setMessages] = useState([]);
  const [total, setTotal] = useState(0);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [composerOpen, setComposerOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [dispatchMsg, setDispatchMsg] = useState(null);
  const [confirm, setConfirm] = useState(null); // { tipo: 'duplicar' | 'excluir', message }
  const [busy, setBusy] = useState(false);

  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0); // força recarregar a página atual

  // Grupos (para o modal de disparo) carregados uma vez.
  useEffect(() => {
    api(`/api/campaigns/${campaignId}/groups`).then((g) => setGroups(g.groups)).catch(() => setGroups([]));
  }, [campaignId]);

  // Carrega SOMENTE a página pedida (não traz todas as mensagens de uma vez).
  const loadMessages = useCallback(async () => {
    const m = await api(`/api/campaigns/${campaignId}/messages?page=${page}&pageSize=${pageSize}`);
    setMessages(m.messages);
    setTotal(typeof m.total === 'number' ? m.total : m.messages.length);
  }, [campaignId, page, pageSize]);

  useEffect(() => {
    loadMessages().finally(() => setLoading(false));
  }, [loadMessages, refreshKey]);

  const totalPaginas = Math.max(1, Math.ceil(total / pageSize));

  // Se a lista encolher (exclusão) e a página atual sumir, volta para a última válida.
  useEffect(() => {
    if (page > totalPaginas) setPage(totalPaginas);
  }, [page, totalPaginas]);

  // Agrupa a página em containers por data, preservando a ordem (recente -> antigo).
  const gruposPorData = useMemo(() => {
    const mapa = new Map();
    for (const m of messages) {
      const k = chaveData(m.criadoEm);
      if (!mapa.has(k)) mapa.set(k, []);
      mapa.get(k).push(m);
    }
    return [...mapa.entries()].map(([chave, itens]) => ({ chave, rotulo: rotuloData(itens[0].criadoEm), itens }));
  }, [messages]);

  function reload() {
    setRefreshKey((k) => k + 1);
  }

  async function confirmarAcao() {
    if (!confirm) return;
    setBusy(true);
    try {
      if (confirm.tipo === 'duplicar') {
        await api(`/api/messages/${confirm.message.id}/duplicate`, { method: 'POST' });
        // A cópia é a mais recente: mostra a primeira página.
        setPage(1);
        reload();
      } else {
        await api(`/api/messages/${confirm.message.id}`, { method: 'DELETE' });
        reload();
      }
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  }

  function openNew() {
    setEditing(null);
    setComposerOpen(true);
  }
  function openEdit(m) {
    setEditing(m);
    setComposerOpen(true);
  }

  // Mensagem nova aparece na primeira página; edição mantém a página atual.
  function handleSaved() {
    if (!editing) setPage(1);
    reload();
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

  if (loading) return <Center py="lg"><Loader color="whatsapp.8" size="sm" /></Center>;

  return (
    <Stack gap="md">
      <Group justify="space-between" wrap="wrap">
        <Text c="dimmed" size="sm">Conteúdo a disparar para os grupos. Use o ícone de envio para disparar ou agendar.</Text>
        <Button leftSection={<IconPlus size={16} />} onClick={openNew}>Nova mensagem</Button>
      </Group>

      {total === 0 ? (
        <Text c="dimmed" size="sm" ta="center" py="xl">Nenhuma mensagem ainda. Crie a primeira com "Nova mensagem".</Text>
      ) : (
        <>
          <Stack gap="lg">
            {gruposPorData.map((g) => (
              <Box key={g.chave}>
                {/* Separador de data (container pai) */}
                <Group gap="sm" wrap="nowrap" mb="sm" aria-hidden>
                  <Box style={{ flex: 1, height: 1, background: 'var(--mantine-color-gray-3)' }} />
                  <Badge variant="light" color="gray" radius="sm" tt="none" fw={600}>{g.rotulo}</Badge>
                  <Box style={{ flex: 1, height: 1, background: 'var(--mantine-color-gray-3)' }} />
                </Group>

                {/* Cards das mensagens (containers filhos), lado a lado */}
                <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
                  {g.itens.map((m) => (
                    <MensagemCard
                      key={m.id}
                      m={m}
                      onDispatch={() => setDispatchMsg(m)}
                      onEdit={() => openEdit(m)}
                      onDuplicar={() => setConfirm({ tipo: 'duplicar', message: m })}
                      onExcluir={() => setConfirm({ tipo: 'excluir', message: m })}
                    />
                  ))}
                </SimpleGrid>
              </Box>
            ))}
          </Stack>

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
              <Text c="dimmed" size="xs">{total} mensagem(ns)</Text>
              {totalPaginas > 1 && (
                <Pagination total={totalPaginas} value={page} onChange={mudarPagina} size="sm" color="whatsapp.8" />
              )}
            </Group>
          </Group>
        </>
      )}

      <MessageComposerModal
        campaignId={campaignId}
        message={editing}
        opened={composerOpen}
        onClose={() => setComposerOpen(false)}
        onSaved={handleSaved}
      />
      <SendScheduleModal
        campaignId={campaignId}
        message={dispatchMsg}
        groups={groups}
        opened={Boolean(dispatchMsg)}
        onClose={() => setDispatchMsg(null)}
        onScheduled={() => {
          setDispatchMsg(null);
          navigate(`/campanhas/${campaignId}/acoes`);
        }}
      />

      {/* Confirmação de duplicar / excluir */}
      <Modal
        opened={Boolean(confirm)}
        onClose={() => (busy ? null : setConfirm(null))}
        title={confirm?.tipo === 'duplicar' ? 'Duplicar mensagem' : 'Excluir mensagem'}
        centered
        size="sm"
      >
        <Stack gap="md">
          <Text size="sm">
            {confirm?.tipo === 'duplicar'
              ? 'Criar uma cópia desta mensagem na campanha?'
              : 'Tem certeza que deseja excluir esta mensagem? Esta ação não pode ser desfeita.'}
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setConfirm(null)} disabled={busy}>Cancelar</Button>
            <Button
              color={confirm?.tipo === 'duplicar' ? 'whatsapp.8' : 'red'}
              leftSection={confirm?.tipo === 'duplicar' ? <IconCopy size={16} /> : <IconTrash size={16} />}
              onClick={confirmarAcao}
              loading={busy}
            >
              {confirm?.tipo === 'duplicar' ? 'Duplicar' : 'Excluir'}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}

// Card de uma mensagem (container filho): barra de ações + a mensagem inteira em balões,
// com cara de conversa do WhatsApp no celular.
function MensagemCard({ m, onDispatch, onEdit, onDuplicar, onExcluir }) {
  const blocos = m.blocos?.length ? m.blocos : [{ tipo: 'texto', conteudo: m.conteudo || '' }];
  const temMidia = blocos.some((b) => b.midia);
  const temPreview = m.usarPreviewLink && /https?:\/\//.test(m.conteudo || '');

  return (
    <Card withBorder radius="md" padding={0} shadow="xs" style={{ overflow: 'hidden' }}>
      {/* Barra de ações do card */}
      <Group justify="space-between" wrap="nowrap" px="sm" py={6} bg="var(--mantine-color-gray-0)">
        <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
          <Text size="xs" c="dimmed">{horaDe(m.criadoEm)}</Text>
          {blocos.length > 1 && (
            <Badge size="xs" variant="light" color="whatsapp.8" leftSection={<IconStack2 size={10} />}>{blocos.length}</Badge>
          )}
          {temMidia && <Badge size="xs" variant="light" color="gray" leftSection={<IconPhoto size={10} />}>mídia</Badge>}
          {temPreview && <Badge size="xs" variant="light" color="gray" leftSection={<IconLink size={10} />}>preview</Badge>}
        </Group>
        <Group gap={2} wrap="nowrap">
          <Tooltip label="Disparar / agendar" withArrow>
            <ActionIcon variant="subtle" color="whatsapp.8" onClick={onDispatch} aria-label="Disparar ou agendar"><IconSend size={16} /></ActionIcon>
          </Tooltip>
          <Menu position="bottom-end" shadow="sm" withinPortal>
            <Menu.Target>
              <ActionIcon variant="subtle" color="gray" aria-label="Opções da mensagem"><IconDots size={16} /></ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item leftSection={<IconPencil size={16} />} onClick={onEdit}>Editar</Menu.Item>
              <Menu.Item leftSection={<IconCopy size={16} />} onClick={onDuplicar}>Duplicar</Menu.Item>
              <Menu.Item leftSection={<IconTrash size={16} />} color="red" onClick={onExcluir}>Excluir</Menu.Item>
              <Menu.Divider />
              <Menu.Item leftSection={<IconSend size={16} />} onClick={onDispatch}>Disparar / agendar</Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>
      </Group>

      {/* Conversa (mensagem inteira, balões enviados) */}
      <Paper radius={0} p="xs" style={{ background: WALLPAPER }}>
        <ScrollArea.Autosize mah={280} type="auto">
          <Stack gap={6}>
            {blocos.map((b, i) => <LinhaBalao key={i} bloco={b} maxMidia={150} />)}
          </Stack>
        </ScrollArea.Autosize>
      </Paper>
    </Card>
  );
}
