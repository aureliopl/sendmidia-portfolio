import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  Stack,
  Title,
  Text,
  Group,
  Button,
  Tabs,
  Table,
  Avatar,
  Badge,
  ActionIcon,
  Menu,
  Modal,
  TextInput,
  Loader,
  Center,
} from '@mantine/core';
import {
  IconPlus,
  IconDots,
  IconChevronRight,
  IconPlugConnectedX,
  IconLogout2,
  IconFolder,
  IconPencil,
  IconTrash,
} from '@tabler/icons-react';
import { Link } from 'react-router-dom';
import { socket } from '../lib/socket';
import { api } from '../lib/api';
import AccountQrPairingModal from '../components/AccountQrPairingModal';

const TABS = [
  { value: 'todas', label: 'Todas', status: null },
  { value: 'connected', label: 'Conectadas', status: 'connected' },
  { value: 'disconnected', label: 'Desconectadas', status: 'disconnected' },
  { value: 'no_session', label: 'Sem Sessão', status: 'no_session' },
];

// Badge de status com fundo colorido: verde (conectado), amarelo (desconectado, intermediário)
// e vermelho (sem sessão). Sem bolinha — a cor do fundo já comunica o estado.
const STATUS_BADGE = {
  connected: { color: 'whatsapp.7', label: 'Conectado' },
  disconnected: { color: 'yellow', label: 'Desconectado' },
  no_session: { color: 'red', label: 'Sem sessão' },
};

export default function Accounts() {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('todas');
  const [createOpen, setCreateOpen] = useState(false);
  const [editAccount, setEditAccount] = useState(null);
  const [pairingAccount, setPairingAccount] = useState(null);

  const loadAccounts = useCallback(async () => {
    const data = await api('/api/accounts');
    setAccounts(data.accounts);
  }, []);

  useEffect(() => {
    loadAccounts().finally(() => setLoading(false));
  }, [loadAccounts]);

  useEffect(() => {
    const refresh = () => loadAccounts().catch(() => {});
    socket.on('account:status', refresh);
    socket.on('account:connected', refresh);
    return () => {
      socket.off('account:status', refresh);
      socket.off('account:connected', refresh);
    };
  }, [loadAccounts]);

  const filtered = useMemo(() => {
    const activeTab = TABS.find((t) => t.value === tab);
    if (!activeTab?.status) return accounts;
    return accounts.filter((a) => a.status === activeTab.status);
  }, [accounts, tab]);

  function handleStartSession(account) {
    // Apenas abre o modal de pareamento; ele mesmo dispara o início da sessão
    // (e trata erro) assim que o socket está ouvindo — evita perder o primeiro QR.
    setPairingAccount(account);
  }

  async function handleDisconnect(account) {
    await api(`/api/accounts/${account.id}/session/disconnect`, { method: 'POST' });
    loadAccounts();
  }

  async function handleEndSession(account) {
    await api(`/api/accounts/${account.id}/session/end`, { method: 'POST' });
    loadAccounts();
  }

  async function handleDelete(account) {
    if (!window.confirm(`Excluir a conta "${account.nome}"? Essa ação não pode ser desfeita.`)) return;
    await api(`/api/accounts/${account.id}`, { method: 'DELETE' });
    loadAccounts();
  }

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Stack gap={0}>
          <Title order={2}>Contas</Title>
          <Text c="dimmed" size="sm">Números de WhatsApp conectados via QR Code.</Text>
        </Stack>
        <Button leftSection={<IconPlus size={16} />} onClick={() => setCreateOpen(true)}>
          Conta
        </Button>
      </Group>

      <Tabs value={tab} onChange={setTab}>
        <Tabs.List>
          {TABS.map((t) => (
            <Tabs.Tab key={t.value} value={t.value}>{t.label}</Tabs.Tab>
          ))}
        </Tabs.List>
      </Tabs>

      {loading ? (
        <Center py="xl"><Loader color="whatsapp.8" /></Center>
      ) : filtered.length === 0 ? (
        <Text c="dimmed" size="sm" ta="center" py="xl">Nenhuma conta encontrada.</Text>
      ) : (
        <Table verticalSpacing="sm" highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Conta</Table.Th>
              <Table.Th>Número</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th>Projeto</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {filtered.map((account) => {
              const badge = STATUS_BADGE[account.status] || STATUS_BADGE.no_session;
              return (
                <Table.Tr key={account.id}>
                  <Table.Td>
                    <Group gap="sm" wrap="nowrap">
                      <Avatar color="whatsapp.2" radius="xl">{account.nome.slice(0, 2).toUpperCase()}</Avatar>
                      <Text size="sm" fw={500}>{account.nome}</Text>
                    </Group>
                  </Table.Td>
                  <Table.Td><Text size="sm" c="dimmed">{account.telefone || '—'}</Text></Table.Td>
                  <Table.Td><Badge color={badge.color} variant="filled">{badge.label}</Badge></Table.Td>
                  <Table.Td><Text size="sm" c="dimmed">{account.projeto || '—'}</Text></Table.Td>
                  <Table.Td>
                    <Group gap={4} justify="flex-end" wrap="nowrap">
                      {account.status !== 'connected' && (
                        <Button size="xs" variant="light" onClick={() => handleStartSession(account)}>
                          Iniciar sessão
                        </Button>
                      )}
                      <Menu position="bottom-end" shadow="sm">
                        <Menu.Target>
                          <ActionIcon variant="subtle" color="gray"><IconDots size={16} /></ActionIcon>
                        </Menu.Target>
                        <Menu.Dropdown>
                          <Menu.Item
                            leftSection={<IconPlugConnectedX size={16} />}
                            disabled={account.status !== 'connected'}
                            onClick={() => handleDisconnect(account)}
                          >
                            Desconectar
                          </Menu.Item>
                          <Menu.Item
                            leftSection={<IconLogout2 size={16} />}
                            disabled={account.status === 'no_session'}
                            onClick={() => handleEndSession(account)}
                          >
                            Finalizar sessão
                          </Menu.Item>
                          <Menu.Item leftSection={<IconFolder size={16} />} onClick={() => setEditAccount(account)}>
                            Definir projeto
                          </Menu.Item>
                          <Menu.Item leftSection={<IconPencil size={16} />} onClick={() => setEditAccount(account)}>
                            Editar
                          </Menu.Item>
                          <Menu.Item leftSection={<IconTrash size={16} />} color="red" onClick={() => handleDelete(account)}>
                            Excluir
                          </Menu.Item>
                        </Menu.Dropdown>
                      </Menu>
                      <ActionIcon
                        component={Link}
                        to={`/contas/${account.id}`}
                        variant="subtle"
                        color="gray"
                        title="Abrir detalhe da conta"
                      >
                        <IconChevronRight size={16} />
                      </ActionIcon>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      )}

      <CreateAccountModal
        opened={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={loadAccounts}
      />
      <EditAccountModal
        account={editAccount}
        onClose={() => setEditAccount(null)}
        onSaved={loadAccounts}
      />
      <AccountQrPairingModal
        accountId={pairingAccount?.id}
        accountName={pairingAccount?.nome}
        opened={Boolean(pairingAccount)}
        onClose={() => {
          setPairingAccount(null);
          loadAccounts();
        }}
      />
    </Stack>
  );
}

function CreateAccountModal({ opened, onClose, onCreated }) {
  const [nome, setNome] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (opened) {
      setNome('');
      setError('');
    }
  }, [opened]);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await api('/api/accounts', { method: 'POST', body: JSON.stringify({ nome }) });
      await onCreated();
      onClose();
    } catch (err) {
      setError(err.message || 'Não foi possível criar a conta.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal opened={opened} onClose={onClose} title="Nova conta" centered>
      <form onSubmit={handleSubmit}>
        <Stack gap="sm">
          <TextInput
            label="Nome"
            description="Apelido interno para você identificar a conta. O número de WhatsApp é detectado automaticamente ao ler o QR Code."
            placeholder="Ex.: Conta principal"
            value={nome}
            onChange={(e) => setNome(e.currentTarget.value)}
            error={error || undefined}
            autoFocus
            required
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>Cancelar</Button>
            <Button type="submit" loading={submitting}>Criar</Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

function EditAccountModal({ account, onClose, onSaved }) {
  const [nome, setNome] = useState('');
  const [projeto, setProjeto] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (account) {
      setNome(account.nome);
      setProjeto(account.projeto || '');
      setError('');
    }
  }, [account]);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await api(`/api/accounts/${account.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ nome, projeto }),
      });
      await onSaved();
      onClose();
    } catch (err) {
      setError(err.message || 'Não foi possível salvar.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal opened={Boolean(account)} onClose={onClose} title="Editar conta" centered>
      <form onSubmit={handleSubmit}>
        <Stack gap="sm">
          <TextInput
            label="Nome"
            value={nome}
            onChange={(e) => setNome(e.currentTarget.value)}
            error={error || undefined}
            required
          />
          <TextInput
            label="Projeto"
            placeholder="Opcional"
            value={projeto}
            onChange={(e) => setProjeto(e.currentTarget.value)}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>Cancelar</Button>
            <Button type="submit" loading={submitting}>Salvar</Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
