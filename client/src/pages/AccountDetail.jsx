import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  Stack,
  Group,
  Avatar,
  Title,
  Text,
  Badge,
  Button,
  Tabs,
  Table,
  TextInput,
  Modal,
  Loader,
  Center,
  Switch,
  Anchor,
} from '@mantine/core';
import {
  IconArrowLeft,
  IconPlugConnectedX,
  IconSettings,
  IconRefresh,
  IconSearch,
  IconUsers,
} from '@tabler/icons-react';
import { api } from '../lib/api';
import { formatLocalDateTime } from '../lib/datetime';
import { socket } from '../lib/socket';

const STATUS_BADGE = {
  connected: { color: 'whatsapp.8', label: 'Conectado' },
  disconnected: { color: 'gray', label: 'Desconectado' },
  no_session: { color: 'gray.5', label: 'Sem sessão' },
};

function formatSync(iso) {
  if (!iso) return 'nunca sincronizado';
  return formatLocalDateTime(iso);
}

export default function AccountDetail() {
  const { id } = useParams();
  const [account, setAccount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const loadAccount = useCallback(async () => {
    try {
      const data = await api(`/api/accounts/${id}`);
      setAccount(data.account);
    } catch {
      setNotFound(true);
    }
  }, [id]);

  useEffect(() => {
    loadAccount().finally(() => setLoading(false));
  }, [loadAccount]);

  useEffect(() => {
    const refresh = (d) => {
      if (!d || d.accountId === id) loadAccount();
    };
    socket.on('account:status', refresh);
    socket.on('account:connected', refresh);
    return () => {
      socket.off('account:status', refresh);
      socket.off('account:connected', refresh);
    };
  }, [id, loadAccount]);

  async function handleDisconnect() {
    await api(`/api/accounts/${id}/session/disconnect`, { method: 'POST' });
    loadAccount();
  }

  if (loading) {
    return <Center py="xl"><Loader color="whatsapp.8" /></Center>;
  }

  if (notFound || !account) {
    return (
      <Stack gap="sm">
        <Anchor component={Link} to="/contas" size="sm"><Group gap={4}><IconArrowLeft size={14} /> Voltar para contas</Group></Anchor>
        <Text c="dimmed">Conta não encontrada.</Text>
      </Stack>
    );
  }

  const badge = STATUS_BADGE[account.status] || STATUS_BADGE.no_session;

  return (
    <Stack gap="md">
      <Anchor component={Link} to="/contas" size="sm" c="dimmed">
        <Group gap={4} wrap="nowrap"><IconArrowLeft size={14} /> Contas</Group>
      </Anchor>

      {/* Cabeçalho */}
      <Group justify="space-between" align="flex-start" wrap="wrap">
        <Group gap="md" wrap="nowrap">
          <Avatar color="whatsapp.2" radius="xl" size={56}>
            {account.nome.slice(0, 2).toUpperCase()}
          </Avatar>
          <Stack gap={2}>
            <Title order={2}>{account.nome}</Title>
            <Group gap="sm">
              <Text c="dimmed" size="sm">{account.telefone || 'sem número'}</Text>
              <Badge color={badge.color} variant="dot">{badge.label}</Badge>
            </Group>
            <Text c="dimmed" size="xs">Última sincronização: {formatSync(account.ultimaSync)}</Text>
          </Stack>
        </Group>
        <Group gap="xs">
          <Button
            variant="default"
            leftSection={<IconPlugConnectedX size={16} />}
            disabled={account.status !== 'connected'}
            onClick={handleDisconnect}
          >
            Desconectar
          </Button>
          <Button variant="light" leftSection={<IconSettings size={16} />} onClick={() => setSettingsOpen(true)}>
            Configurações
          </Button>
        </Group>
      </Group>

      <Tabs defaultValue="grupos" keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="grupos">Grupos</Tabs.Tab>
          <Tabs.Tab value="campanhas">Campanhas</Tabs.Tab>
          <Tabs.Tab value="criacao">Criação de grupos</Tabs.Tab>
          <Tabs.Tab value="acoes">Ações</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="grupos" pt="md"><GroupsTab account={account} /></Tabs.Panel>
        <Tabs.Panel value="campanhas" pt="md"><CampaignsTab accountId={id} /></Tabs.Panel>
        <Tabs.Panel value="criacao" pt="md"><PlaceholderTab texto="A criação de grupos é feita dentro de uma campanha, na aba Grupos." /></Tabs.Panel>
        <Tabs.Panel value="acoes" pt="md"><PlaceholderTab texto="O histórico de ações desta conta aparece na aba Ações de cada campanha." /></Tabs.Panel>
      </Tabs>

      <SettingsModal account={account} opened={settingsOpen} onClose={() => setSettingsOpen(false)} onSaved={loadAccount} />
    </Stack>
  );
}

// ── Aba Grupos (leitura ao vivo via Baileys) ────────────────────────────────
function GroupsTab({ account }) {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api(`/api/accounts/${account.id}/groups`);
      setGroups(data.groups);
    } catch (err) {
      setError(err.message === 'not_connected' ? 'not_connected' : 'sync_failed');
      setGroups([]);
    } finally {
      setLoading(false);
    }
  }, [account.id]);

  useEffect(() => {
    if (account.status === 'connected') load();
  }, [account.status, load]);

  const filtered = groups.filter((g) => g.nome.toLowerCase().includes(search.toLowerCase()));

  return (
    <Stack gap="sm">
      <Group justify="space-between">
        <TextInput
          placeholder="Buscar grupo"
          leftSection={<IconSearch size={14} />}
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          w={260}
        />
        <Button
          variant="light"
          leftSection={<IconRefresh size={16} />}
          onClick={load}
          loading={loading}
          disabled={account.status !== 'connected'}
        >
          Atualizar
        </Button>
      </Group>

      {account.status !== 'connected' ? (
        <Text c="dimmed" size="sm" ta="center" py="lg">Conecte a conta para listar os grupos do WhatsApp.</Text>
      ) : loading ? (
        <Center py="lg"><Loader color="whatsapp.8" size="sm" /></Center>
      ) : error === 'sync_failed' ? (
        <Text c="red" size="sm" ta="center" py="lg">Não foi possível sincronizar os grupos. Tente novamente.</Text>
      ) : filtered.length === 0 ? (
        <Text c="dimmed" size="sm" ta="center" py="lg">Nenhum grupo encontrado.</Text>
      ) : (
        <Stack gap={4}>
          <Text c="dimmed" size="xs">{filtered.length} grupo(s)</Text>
          <Table verticalSpacing="xs" highlightOnHover>
            <Table.Thead>
              <Table.Tr><Table.Th>Grupo</Table.Th><Table.Th>Participantes</Table.Th></Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {filtered.map((g) => (
                <Table.Tr key={g.waGroupId}>
                  <Table.Td>
                    <Group gap="sm" wrap="nowrap">
                      <Avatar color="whatsapp.1" radius="xl" size={32}><IconUsers size={16} /></Avatar>
                      <Text size="sm" fw={500}>{g.nome}</Text>
                    </Group>
                  </Table.Td>
                  <Table.Td><Text size="sm" c="dimmed">{g.participantes}</Text></Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Stack>
      )}
    </Stack>
  );
}

// ── Aba Campanhas (associar/desassociar) ────────────────────────────────────
function CampaignsTab({ accountId }) {
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    const data = await api(`/api/accounts/${accountId}/campaigns`);
    setCampaigns(data.campaigns);
  }, [accountId]);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  async function toggle(campaign, associar) {
    setBusy(campaign.id);
    try {
      await api(`/api/accounts/${accountId}/campaigns/${campaign.id}`, { method: associar ? 'POST' : 'DELETE' });
      setCampaigns((prev) => prev.map((c) => (c.id === campaign.id ? { ...c, associada: associar } : c)));
    } finally {
      setBusy(null);
    }
  }

  async function setAll(associar) {
    const alvo = campaigns.filter((c) => c.associada !== associar);
    await Promise.all(
      alvo.map((c) => api(`/api/accounts/${accountId}/campaigns/${c.id}`, { method: associar ? 'POST' : 'DELETE' })),
    );
    load();
  }

  if (loading) return <Center py="lg"><Loader color="whatsapp.8" size="sm" /></Center>;

  if (campaigns.length === 0) {
    return (
      <Text c="dimmed" size="sm" ta="center" py="lg">
        Nenhuma campanha criada ainda. Crie campanhas em <Anchor component={Link} to="/campanhas">Campanhas</Anchor>.
      </Text>
    );
  }

  return (
    <Stack gap="sm">
      <Group gap="xs">
        <Button size="xs" variant="default" onClick={() => setAll(true)}>Selecionar todas</Button>
        <Button size="xs" variant="default" onClick={() => setAll(false)}>Desmarcar todas</Button>
      </Group>
      <Table verticalSpacing="xs">
        <Table.Tbody>
          {campaigns.map((c) => (
            <Table.Tr key={c.id}>
              <Table.Td>
                <Group gap="xs">
                  <Text size="sm" fw={500}>{c.nome}</Text>
                  {c.status === 'archived' && <Badge size="xs" color="gray" variant="light">arquivada</Badge>}
                </Group>
              </Table.Td>
              <Table.Td w={80}>
                <Switch
                  checked={c.associada}
                  onChange={(e) => toggle(c, e.currentTarget.checked)}
                  disabled={busy === c.id}
                  color="whatsapp.8"
                />
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Stack>
  );
}

// ── Abas informativas (a ação é feita dentro da campanha) ───────────────────
function PlaceholderTab({ texto }) {
  return (
    <Center py="xl">
      <Stack align="center" gap={4}>
        <Text c="dimmed" size="sm">Nenhum registro encontrado.</Text>
        <Text c="dimmed" size="xs">{texto}</Text>
      </Stack>
    </Center>
  );
}

// ── Modal de configurações (nome + projeto) ─────────────────────────────────
function SettingsModal({ account, opened, onClose, onSaved }) {
  const [nome, setNome] = useState('');
  const [projeto, setProjeto] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (opened && account) { setNome(account.nome); setProjeto(account.projeto || ''); setError(''); }
  }, [opened, account]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await api(`/api/accounts/${account.id}`, { method: 'PATCH', body: JSON.stringify({ nome, projeto }) });
      await onSaved();
      onClose();
    } catch (err) {
      setError(err.message || 'Não foi possível salvar.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal opened={opened} onClose={onClose} title="Configurações da conta" centered>
      <form onSubmit={handleSubmit}>
        <Stack gap="sm">
          <TextInput label="Nome" value={nome} onChange={(e) => setNome(e.currentTarget.value)} error={error || undefined} required />
          <TextInput label="Projeto" placeholder="Opcional" value={projeto} onChange={(e) => setProjeto(e.currentTarget.value)} />
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>Cancelar</Button>
            <Button type="submit" loading={submitting}>Salvar</Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
