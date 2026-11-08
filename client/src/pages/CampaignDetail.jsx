import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  Stack,
  Group,
  Title,
  Text,
  Badge,
  Button,
  ActionIcon,
  Tabs,
  Table,
  Switch,
  Modal,
  TextInput,
  Select,
  Loader,
  Center,
  Anchor,
  Paper,
  SimpleGrid,
  List,
  ThemeIcon,
  NumberInput,
  Tooltip,
  Alert,
} from '@mantine/core';
import {
  IconArrowLeft,
  IconSettings,
  IconSpeakerphone,
  IconDownload,
  IconCircleCheck,
  IconAlertTriangle,
  IconPointFilled,
  IconCopy,
  IconCheck,
  IconRefresh,
  IconLink,
} from '@tabler/icons-react';
import { api } from '../lib/api';
import { copyToClipboard } from '../lib/clipboard';
import CampaignGroupsTab from '../components/CampaignGroupsTab';
import CampaignMessagesTab from '../components/CampaignMessagesTab';
import CampaignActionsTab from '../components/CampaignActionsTab';
import CampaignSolicitacoesTab from '../components/CampaignSolicitacoesTab';
import CampaignAtividadesTab from '../components/CampaignAtividadesTab';
import CampaignLeadscoringTab from '../components/CampaignLeadscoringTab';
import CampaignCalendarTab from '../components/CampaignCalendarTab';
import { VELOCIDADES } from '../lib/velocidades';
import { formatLocalDate } from '../lib/datetime';

const TIPOS = ['Grupos', 'Divulgação', 'Outro'];

// Itens de "Configurações da campanha" no escopo (CLAUDE.md §4.3). A maioria
// depende de marcos futuros; aqui ficam listados como referência/esqueleto.
const CONFIG_ITENS = [
  'Métricas', 'Tags', 'Variáveis da campanha', 'Atualização de links',
  'Redefinir link de convite', 'Remover lead de campanhas anteriores',
  'Checar participantes duplicados',
];

// Abas do detalhe da campanha. O `value` também é o slug da URL (/campanhas/:id/:aba),
// para a aba sobreviver ao recarregar a página e poder ser compartilhada por link.
const ABAS = ['visao', 'contas', 'diag', 'grupos', 'solicitacoes', 'atividades', 'leadscoring', 'mensagens', 'calendario', 'acoes'];

export default function CampaignDetail() {
  const { id, aba } = useParams();
  const navigate = useNavigate();
  const abaAtiva = ABAS.includes(aba) ? aba : 'visao';
  const [campaign, setCampaign] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api(`/api/campaigns/${id}`);
      setCampaign(data.campaign);
    } catch {
      setNotFound(true);
    }
  }, [id]);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  if (loading) return <Center py="xl"><Loader color="whatsapp.8" /></Center>;
  if (notFound || !campaign) {
    return (
      <Stack gap="sm">
        <Anchor component={Link} to="/campanhas" size="sm"><Group gap={4}><IconArrowLeft size={14} /> Voltar</Group></Anchor>
        <Text c="dimmed">Campanha não encontrada.</Text>
      </Stack>
    );
  }

  return (
    <Stack gap="md">
      <Anchor component={Link} to="/campanhas" size="sm" c="dimmed">
        <Group gap={4} wrap="nowrap"><IconArrowLeft size={14} /> Campanhas</Group>
      </Anchor>

      <Group justify="space-between" align="flex-start" wrap="wrap">
        <Group gap="md" wrap="nowrap">
          <ThemeIcon variant="light" color="whatsapp.8" size={48} radius="md"><IconSpeakerphone size={24} /></ThemeIcon>
          <Stack gap={2}>
            <Title order={2}>{campaign.nome}</Title>
            <Group gap="sm">
              {campaign.tipo && <Badge variant="light" color="gray">{campaign.tipo}</Badge>}
              <Badge variant="dot" color={campaign.status === 'archived' ? 'gray' : 'whatsapp.8'}>
                {campaign.status === 'archived' ? 'Arquivada' : 'Ativa'}
              </Badge>
            </Group>
          </Stack>
        </Group>
        <Button variant="light" leftSection={<IconSettings size={16} />} onClick={() => setSettingsOpen(true)}>Configurações</Button>
      </Group>

      <Tabs value={abaAtiva} onChange={(v) => navigate(`/campanhas/${id}/${v}`)} keepMounted={false}>
        <Tabs.List style={{ flexWrap: 'nowrap', overflowX: 'auto' }}>
          <Tabs.Tab value="visao">Visão geral</Tabs.Tab>
          <Tabs.Tab value="contas">Contas associadas</Tabs.Tab>
          <Tabs.Tab value="diag">Diagnósticos</Tabs.Tab>
          <Tabs.Tab value="grupos">Grupos</Tabs.Tab>
          <Tabs.Tab value="solicitacoes">Solicitações de entrada</Tabs.Tab>
          <Tabs.Tab value="atividades">Atividades</Tabs.Tab>
          <Tabs.Tab value="leadscoring">Leadscoring</Tabs.Tab>
          <Tabs.Tab value="mensagens">Mensagens</Tabs.Tab>
          <Tabs.Tab value="calendario">Calendário</Tabs.Tab>
          <Tabs.Tab value="acoes">Ações</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="visao" pt="md"><OverviewTab campaign={campaign} onReload={load} /></Tabs.Panel>
        <Tabs.Panel value="contas" pt="md"><AccountsTab campaignId={id} onChange={load} /></Tabs.Panel>
        <Tabs.Panel value="diag" pt="md"><DiagnosticsTab campaignId={id} campaignName={campaign.nome} /></Tabs.Panel>
        <Tabs.Panel value="grupos" pt="md"><CampaignGroupsTab campaignId={id} /></Tabs.Panel>
        <Tabs.Panel value="solicitacoes" pt="md"><CampaignSolicitacoesTab campaignId={id} /></Tabs.Panel>
        <Tabs.Panel value="atividades" pt="md"><CampaignAtividadesTab campaignId={id} /></Tabs.Panel>
        <Tabs.Panel value="leadscoring" pt="md"><CampaignLeadscoringTab campaignId={id} /></Tabs.Panel>
        <Tabs.Panel value="mensagens" pt="md"><CampaignMessagesTab campaignId={id} /></Tabs.Panel>
        <Tabs.Panel value="calendario" pt="md"><CampaignCalendarTab campaignId={id} /></Tabs.Panel>
        <Tabs.Panel value="acoes" pt="md"><CampaignActionsTab campaignId={id} campaignName={campaign.nome} /></Tabs.Panel>
      </Tabs>

      <CampaignSettingsModal campaign={campaign} opened={settingsOpen} onClose={() => setSettingsOpen(false)} onSaved={load} />
    </Stack>
  );
}

// ── Visão geral ─────────────────────────────────────────────────────────────
function OverviewTab({ campaign, onReload }) {
  const c = campaign._count || {};
  const criada = formatLocalDate(campaign.criadoEm);
  const inviteUrl = campaign.inviteCode ? `${window.location.origin}/i/${campaign.inviteCode}` : '';
  const [regenerando, setRegenerando] = useState(false);
  const [copiado, setCopiado] = useState(false);

  async function copiarLink() {
    const ok = await copyToClipboard(inviteUrl);
    if (ok) {
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1500);
    }
  }

  async function regenerar() {
    if (!window.confirm('Gerar um novo código invalida o link de convite atual. As pessoas que tiverem o link antigo não conseguirão mais entrar. Continuar?')) return;
    setRegenerando(true);
    try {
      await api(`/api/campaigns/${campaign.id}/invite/regenerate`, { method: 'POST' });
      await onReload?.();
    } finally {
      setRegenerando(false);
    }
  }

  return (
    <Stack gap="lg">
      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="md">
        <Paper withBorder p="md" radius="md"><Text fw={700} size="xl">{c.groups ?? 0}</Text><Text c="dimmed" size="xs">Grupos</Text></Paper>
        <Paper withBorder p="md" radius="md"><Text fw={700} size="xl">{c.campaignAccounts ?? 0}</Text><Text c="dimmed" size="xs">Contas associadas</Text></Paper>
        <Paper withBorder p="md" radius="md"><Text fw={700} size="xl">{c.messages ?? 0}</Text><Text c="dimmed" size="xs">Mensagens</Text></Paper>
        <Paper withBorder p="md" radius="md"><Text fw={700} size="xl">{criada}</Text><Text c="dimmed" size="xs">Criada em</Text></Paper>
      </SimpleGrid>

      {/* Link de convite geral (deep linking): distribui novos membros entre os grupos abertos. */}
      <Paper withBorder p="md" radius="md">
        <Group gap={6} mb={4}>
          <IconLink size={16} style={{ color: 'var(--mantine-color-whatsapp-8)' }} />
          <Text fw={500} size="sm">Link de convite</Text>
        </Group>
        <Text c="dimmed" size="xs" mb="sm">
          Divulgue este link único. Cada pessoa que clicar entra em um dos grupos abertos da campanha,
          escolhido automaticamente para distribuir os membros sem lotar um só grupo. Quando não houver
          grupo com vaga, a plataforma abre um novo grupo automaticamente pela conta criadora.
        </Text>
        {!campaign.contaCriadoraId && (
          <Alert variant="light" color="yellow" icon={<IconAlertTriangle size={16} />} mb="sm" p="xs">
            <Text size="xs">
              Nenhuma conta está marcada como criadora de grupos. Sem ela, quando todos os grupos
              ficarem cheios o link não conseguirá abrir um grupo novo. Defina em "Contas associadas".
            </Text>
          </Alert>
        )}
        <Stack gap="xs">
          <TextInput
            readOnly
            value={inviteUrl}
            onFocus={(e) => e.currentTarget.select()}
          />
          <Group gap="sm">
            <Button
              variant={copiado ? 'filled' : 'light'}
              color="whatsapp.8"
              leftSection={copiado ? <IconCheck size={16} /> : <IconCopy size={16} />}
              onClick={copiarLink}
              disabled={!inviteUrl}
            >
              {copiado ? 'Copiado' : 'Copiar'}
            </Button>
            <Tooltip label="Gera um novo código e invalida o link atual" withArrow>
              <Button
                variant="default"
                leftSection={<IconRefresh size={16} />}
                onClick={regenerar}
                loading={regenerando}
              >
                Gerar novo código
              </Button>
            </Tooltip>
          </Group>
        </Stack>
      </Paper>

      <Stack gap="xs">
        <Text fw={500} size="sm">Configurações da campanha</Text>
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing={4}>
          {CONFIG_ITENS.map((item) => (
            <Group key={item} gap={8} wrap="nowrap">
              <IconPointFilled size={12} style={{ color: 'var(--mantine-color-gray-4)' }} />
              <Text size="sm" c="dimmed">{item}</Text>
            </Group>
          ))}
        </SimpleGrid>
      </Stack>
    </Stack>
  );
}

// ── Contas associadas ───────────────────────────────────────────────────────
function AccountsTab({ campaignId, onChange }) {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    const data = await api(`/api/campaigns/${campaignId}/accounts`);
    setAccounts(data.accounts);
  }, [campaignId]);

  useEffect(() => { load().finally(() => setLoading(false)); }, [load]);

  async function toggle(account, associar) {
    setBusy(account.id);
    try {
      await api(`/api/campaigns/${campaignId}/accounts/${account.id}`, { method: associar ? 'POST' : 'DELETE' });
      setAccounts((prev) => prev.map((a) => {
        if (a.id !== account.id) return a;
        // desassociar também tira a marca de criadora (o backend já limpa do lado dele).
        return { ...a, associada: associar, criadora: associar ? a.criadora : false };
      }));
      onChange?.();
    } finally {
      setBusy(null);
    }
  }

  // Marca/desmarca a conta criadora de grupos. Exclusiva: ao ligar uma, as demais desmarcam.
  async function toggleCriadora(account, marcar) {
    setBusy(account.id);
    try {
      await api(`/api/campaigns/${campaignId}/conta-criadora`, {
        method: 'PUT',
        body: JSON.stringify({ accountId: marcar ? account.id : null }),
      });
      setAccounts((prev) => prev.map((a) => ({ ...a, criadora: marcar ? a.id === account.id : (a.id === account.id ? false : a.criadora) })));
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <Center py="lg"><Loader color="whatsapp.8" size="sm" /></Center>;
  if (accounts.length === 0) {
    return <Text c="dimmed" size="sm" ta="center" py="lg">Nenhuma conta cadastrada. Crie contas em <Anchor component={Link} to="/contas">Contas</Anchor>.</Text>;
  }

  const total = accounts.filter((a) => a.associada).length;
  return (
    <Stack gap="sm">
      <Text c="dimmed" size="sm">{total}/{accounts.length} conta(s) associada(s)</Text>
      <Text c="dimmed" size="xs">
        A conta marcada em "Cria grupos" é usada quando o link de convite precisa abrir um grupo novo
        automaticamente. Só uma conta por campanha pode ter essa função.
      </Text>
      <Table verticalSpacing="xs">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Conta</Table.Th>
            <Table.Th>Telefone</Table.Th>
            <Table.Th ta="center" w={100}>Associada</Table.Th>
            <Table.Th ta="center" w={100}>Cria grupos</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {accounts.map((a) => (
            <Table.Tr key={a.id}>
              <Table.Td><Text size="sm" fw={500}>{a.nome}</Text></Table.Td>
              <Table.Td><Text size="sm" c="dimmed">{a.telefone || '—'}</Text></Table.Td>
              <Table.Td ta="center">
                <Switch checked={a.associada} onChange={(e) => toggle(a, e.currentTarget.checked)} disabled={busy === a.id} color="whatsapp.8" />
              </Table.Td>
              <Table.Td ta="center">
                <Tooltip label={a.associada ? '' : 'Associe a conta primeiro'} disabled={a.associada} withArrow>
                  <Switch
                    checked={Boolean(a.criadora)}
                    onChange={(e) => toggleCriadora(a, e.currentTarget.checked)}
                    disabled={busy === a.id || !a.associada}
                    color="whatsapp.8"
                  />
                </Tooltip>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Stack>
  );
}

// ── Diagnósticos ────────────────────────────────────────────────────────────
function DiagnosticsTab({ campaignId, campaignName }) {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api(`/api/campaigns/${campaignId}/accounts`)
      .then((d) => setAccounts(d.accounts.filter((a) => a.associada)))
      .finally(() => setLoading(false));
  }, [campaignId]);

  function exportCSV() {
    const linhas = [['nome', 'telefone', 'status', 'compatibilidade']];
    accounts.forEach((a) => linhas.push([a.nome, a.telefone || '', a.status, a.status === 'connected' ? 'ok' : 'precisa conectar']));
    const csv = linhas.map((l) => l.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `diagnostico-${campaignName.replace(/\s+/g, '-').toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) return <Center py="lg"><Loader color="whatsapp.8" size="sm" /></Center>;
  if (accounts.length === 0) {
    return <Text c="dimmed" size="sm" ta="center" py="lg">Associe contas à campanha (aba "Contas associadas") para diagnosticar.</Text>;
  }

  return (
    <Stack gap="sm">
      <Group justify="space-between">
        <Text c="dimmed" size="sm">Compatibilidade pela conexão da conta.</Text>
        <Button variant="default" size="xs" leftSection={<IconDownload size={14} />} onClick={exportCSV}>Exportar CSV</Button>
      </Group>
      <Table verticalSpacing="xs">
        <Table.Tbody>
          {accounts.map((a) => {
            const ok = a.status === 'connected';
            return (
              <Table.Tr key={a.id}>
                <Table.Td><Text size="sm" fw={500}>{a.nome}</Text></Table.Td>
                <Table.Td>
                  {ok ? (
                    <Group gap={6}><ThemeIcon size={18} radius="xl" color="whatsapp.8"><IconCircleCheck size={12} /></ThemeIcon><Text size="sm">Compatível (conectada)</Text></Group>
                  ) : (
                    <Group gap={6}><ThemeIcon size={18} radius="xl" color="orange"><IconAlertTriangle size={12} /></ThemeIcon><Text size="sm" c="dimmed">Precisa conectar</Text></Group>
                  )}
                </Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
    </Stack>
  );
}

// ── Esqueleto ───────────────────────────────────────────────────────────────
function PlaceholderTab({ texto }) {
  return (
    <Center py="xl">
      <Stack align="center" gap={4}>
        <Text c="dimmed" size="sm">Nenhum registro encontrado.</Text>
        {texto ? <Text c="dimmed" size="xs">{texto}</Text> : null}
      </Stack>
    </Center>
  );
}

// ── Configurações (nome + tipo) ─────────────────────────────────────────────
function CampaignSettingsModal({ campaign, opened, onClose, onSaved }) {
  const [nome, setNome] = useState('');
  const [tipo, setTipo] = useState(null);
  const [velocidadePadrao, setVelocidadePadrao] = useState('normal');
  const [capacidadeGrupo, setCapacidadeGrupo] = useState(600);
  const [aberturaInteracaoHoras, setAberturaInteracaoHoras] = useState('24');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (opened && campaign) {
      setNome(campaign.nome);
      setTipo(campaign.tipo || null);
      setVelocidadePadrao(campaign.velocidadePadrao || 'normal');
      setCapacidadeGrupo(campaign.capacidadeGrupo || 600);
      setAberturaInteracaoHoras(String(campaign.aberturaInteracaoHoras ?? 24));
      setError('');
    }
  }, [opened, campaign]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await api(`/api/campaigns/${campaign.id}`, { method: 'PATCH', body: JSON.stringify({ nome, tipo, velocidadePadrao, capacidadeGrupo, aberturaInteracaoHoras: Number(aberturaInteracaoHoras) }) });
      await onSaved();
      onClose();
    } catch (err) {
      setError(err.message || 'Não foi possível salvar.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal opened={opened} onClose={onClose} title="Configurações da campanha" centered>
      <form onSubmit={handleSubmit}>
        <Stack gap="sm">
          <TextInput label="Nome" value={nome} onChange={(e) => setNome(e.currentTarget.value)} error={error || undefined} required />
          <Select label="Tipo" placeholder="Selecione" data={TIPOS} value={tipo} onChange={setTipo} clearable />
          <Select
            label="Velocidade de disparo padrão"
            description="Já vem selecionada ao abrir o modal de disparo."
            data={VELOCIDADES}
            value={velocidadePadrao}
            onChange={(v) => setVelocidadePadrao(v || 'normal')}
            allowDeselect={false}
          />
          <NumberInput
            label="Capacidade por grupo"
            description="Ao atingir esse número, o grupo vira cheio e sai da rotação do link de convite. Recomendado 600. Limite do WhatsApp: 1024; aqui até 1000."
            value={capacidadeGrupo}
            onChange={(v) => setCapacidadeGrupo(Number(v) || 0)}
            min={50}
            max={1000}
            clampBehavior="strict"
            allowDecimal={false}
            allowNegative={false}
          />
          <Select
            label="Abertura da interação em grupos novos"
            description="Grupos criados pela plataforma nascem abertos (todos enviam) e fecham sozinhos (só admin envia) após esse tempo. Reduz o risco de banimento em grupos recém-criados."
            data={[
              { value: '0', label: 'Nascer fechado (só admin envia)' },
              { value: '12', label: 'Abrir por 12 horas' },
              { value: '24', label: 'Abrir por 24 horas' },
              { value: '48', label: 'Abrir por 48 horas' },
            ]}
            value={aberturaInteracaoHoras}
            onChange={(v) => setAberturaInteracaoHoras(v || '24')}
            allowDeselect={false}
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
