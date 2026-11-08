import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  Stack,
  Group,
  Text,
  Button,
  Table,
  Avatar,
  Badge,
  Checkbox,
  Tabs,
  Loader,
  Center,
  Progress,
  Anchor,
  CopyButton,
  ActionIcon,
  Tooltip,
  TextInput,
} from '@mantine/core';
import {
  IconUpload,
  IconRefresh,
  IconUsers,
  IconUsersPlus,
  IconUsersGroup,
  IconCopy,
  IconCheck,
  IconTrash,
  IconSearch,
  IconLinkOff,
  IconEdit,
} from '@tabler/icons-react';
import { api } from '../lib/api';
import ImportGroupsWizard from './ImportGroupsWizard';
import CreateGroupsModal from './CreateGroupsModal';
import DuplicatesModal from './DuplicatesModal';
import EditGroupsModal from './EditGroupsModal';

const FILTROS = [
  { value: 'todos', label: 'Todos', q: '' },
  { value: 'full', label: 'Cheios', q: 'full' },
  { value: 'available', label: 'Não cheios', q: 'available' },
  { value: 'suspended', label: 'Suspensos', q: 'suspended' },
];

const STATUS_BADGE = {
  open: { color: 'whatsapp.8', label: 'Aberto' },
  closed: { color: 'gray', label: 'Fechado' },
  full: { color: 'orange', label: 'Cheio' },
  suspended: { color: 'red', label: 'Suspenso' },
};

export default function CampaignGroupsTab({ campaignId }) {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState('todos');
  const [selected, setSelected] = useState(() => new Set());
  const [search, setSearch] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [dupOpen, setDupOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const f = FILTROS.find((x) => x.value === filtro);
    const qs = f?.q ? `?filtro=${f.q}` : '';
    const data = await api(`/api/campaigns/${campaignId}/groups${qs}`);
    setGroups(data.groups);
    setSelected(new Set());
  }, [campaignId, filtro]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  const visiveis = useMemo(
    () => groups.filter((g) => g.nome.toLowerCase().includes(search.toLowerCase())),
    [groups, search],
  );

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected((prev) => (prev.size === visiveis.length ? new Set() : new Set(visiveis.map((g) => g.id))));
  }

  async function setStatus(status) {
    await api(`/api/campaigns/${campaignId}/groups/status`, {
      method: 'PATCH',
      body: JSON.stringify({ ids: [...selected], status }),
    });
    load();
  }

  async function removeSelected() {
    if (!window.confirm(`Remover ${selected.size} grupo(s) da campanha? (não exclui o grupo no WhatsApp)`)) return;
    await api(`/api/campaigns/${campaignId}/groups/remove`, { method: 'POST', body: JSON.stringify({ ids: [...selected] }) });
    load();
  }

  async function resetLinks() {
    const msg =
      `Redefinir o link de convite de ${selected.size} grupo(s)?\n\n` +
      'Isto REVOGA o link atual: quem já tem o link antigo não conseguirá mais entrar. ' +
      'Use só se quiser invalidar links divulgados anteriormente.';
    if (!window.confirm(msg)) return;
    const r = await api(`/api/campaigns/${campaignId}/groups/reset-links`, {
      method: 'POST',
      body: JSON.stringify({ ids: [...selected] }),
    });
    const falhou = r.falhas?.length
      ? `\n${r.falhas.length} falhou(ram), confira se a conta admin está conectada.`
      : '';
    window.alert(`Links redefinidos: ${r.redefinidos} de ${r.total}.${falhou}`);
    load();
  }

  async function refreshLinks() {
    setRefreshing(true);
    try {
      const r = await api(`/api/campaigns/${campaignId}/groups/refresh-links`, { method: 'POST' });
      window.alert(`Links atualizados: ${r.atualizados} de ${r.total}.`);
      load();
    } finally {
      setRefreshing(false);
    }
  }

  const temSelecao = selected.size > 0;
  const selectedGroups = useMemo(() => groups.filter((g) => selected.has(g.id)), [groups, selected]);

  return (
    <Stack gap="sm">
      {/* Barra de ações */}
      <Group justify="space-between" wrap="wrap">
        <Group gap="xs">
          <Button leftSection={<IconUsersPlus size={16} />} onClick={() => setCreateOpen(true)}>Criar grupos</Button>
          <Button variant="default" leftSection={<IconUpload size={16} />} onClick={() => setImportOpen(true)}>Importar grupos</Button>
          <Button
            variant="default"
            leftSection={<IconRefresh size={16} />}
            onClick={refreshLinks}
            loading={refreshing}
            disabled={groups.length === 0}
          >
            Atualizar links
          </Button>
          <Button
            variant="default"
            leftSection={<IconUsersGroup size={16} />}
            onClick={() => setDupOpen(true)}
            disabled={groups.length === 0}
          >
            Duplicados
          </Button>
        </Group>
        {temSelecao && (
          <Group gap="xs">
            <Text size="sm" c="dimmed">{selected.size} selecionado(s)</Text>
            <Button size="xs" variant="light" leftSection={<IconEdit size={14} />} onClick={() => setEditOpen(true)}>Alterar em lote</Button>
            <Button size="xs" variant="light" color="orange" onClick={() => setStatus('full')}>Marcar cheio</Button>
            <Button size="xs" variant="light" color="whatsapp.8" onClick={() => setStatus('open')}>Marcar não cheio</Button>
            <Button size="xs" variant="light" color="red" leftSection={<IconLinkOff size={14} />} onClick={resetLinks}>Redefinir link</Button>
            <Button size="xs" variant="light" color="red" leftSection={<IconTrash size={14} />} onClick={removeSelected}>Remover</Button>
          </Group>
        )}
      </Group>

      <Group justify="space-between" wrap="wrap">
        <Tabs value={filtro} onChange={setFiltro}>
          <Tabs.List>
            {FILTROS.map((f) => <Tabs.Tab key={f.value} value={f.value}>{f.label}</Tabs.Tab>)}
          </Tabs.List>
        </Tabs>
        <TextInput
          placeholder="Buscar grupo"
          leftSection={<IconSearch size={14} />}
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          w={220}
        />
      </Group>

      {loading ? (
        <Center py="lg"><Loader color="whatsapp.8" size="sm" /></Center>
      ) : visiveis.length === 0 ? (
        <Stack align="center" py="xl" gap={4}>
          <Text c="dimmed" size="sm">Nenhum grupo nesta campanha.</Text>
          <Text c="dimmed" size="xs">Use "Importar grupos" para trazer grupos existentes de uma conta conectada.</Text>
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
                />
              </Table.Th>
              <Table.Th>Grupo</Table.Th>
              <Table.Th>Lotação</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th>Link</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {visiveis.map((g) => {
              const badge = STATUS_BADGE[g.status] || STATUS_BADGE.open;
              const pct = Math.min(100, Math.round((g.participantes / (g.capacidade || 600)) * 100));
              return (
                <Table.Tr key={g.id}>
                  <Table.Td><Checkbox checked={selected.has(g.id)} onChange={() => toggle(g.id)} /></Table.Td>
                  <Table.Td>
                    <Group gap="sm" wrap="nowrap">
                      <Avatar color="whatsapp.1" radius="xl" size={32}><IconUsers size={16} /></Avatar>
                      <Text size="sm" fw={500}>{g.nome}</Text>
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    <Stack gap={2} w={110}>
                      <Text size="xs" c="dimmed">{g.participantes}/{g.capacidade}</Text>
                      <Progress value={pct} size="xs" color={pct >= 100 ? 'orange' : 'whatsapp.8'} />
                    </Stack>
                  </Table.Td>
                  <Table.Td><Badge color={badge.color} variant="dot">{badge.label}</Badge></Table.Td>
                  <Table.Td>
                    {g.linkConvite ? (
                      <Group gap={4} wrap="nowrap">
                        <Anchor href={g.linkConvite} target="_blank" size="xs" truncate maw={160}>{g.linkConvite.replace('https://', '')}</Anchor>
                        <CopyButton value={g.linkConvite} timeout={1200}>
                          {({ copied, copy }) => (
                            <Tooltip label={copied ? 'Copiado!' : 'Copiar'} withArrow>
                              <ActionIcon size="sm" variant="subtle" color={copied ? 'whatsapp.8' : 'gray'} onClick={copy}>
                                {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                              </ActionIcon>
                            </Tooltip>
                          )}
                        </CopyButton>
                      </Group>
                    ) : (
                      <Text size="xs" c="dimmed">—</Text>
                    )}
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      )}

      <Text c="dimmed" size="xs">Capacidade recomendada: até 600 participantes por grupo.</Text>

      <ImportGroupsWizard
        campaignId={campaignId}
        opened={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={load}
      />

      <CreateGroupsModal
        campaignId={campaignId}
        opened={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={load}
      />

      <EditGroupsModal
        campaignId={campaignId}
        opened={editOpen}
        onClose={() => {
          setEditOpen(false);
          load();
        }}
        selectedGroups={selectedGroups}
      />

      <DuplicatesModal
        campaignId={campaignId}
        opened={dupOpen}
        onClose={() => setDupOpen(false)}
      />
    </Stack>
  );
}
