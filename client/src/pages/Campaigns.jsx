import { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Stack,
  Group,
  Title,
  Text,
  Button,
  Tabs,
  Card,
  SimpleGrid,
  Badge,
  ActionIcon,
  Menu,
  Modal,
  TextInput,
  Select,
  Loader,
  Center,
  Paper,
  SegmentedControl,
  Tooltip,
} from '@mantine/core';
import {
  IconPlus,
  IconDots,
  IconArchive,
  IconArchiveOff,
  IconPencil,
  IconTrash,
  IconSpeakerphone,
  IconInfoCircle,
} from '@tabler/icons-react';
import { api } from '../lib/api';
import { appendLocalRange } from '../lib/datetime';

const TABS = [
  { value: 'campanhas', label: 'Campanhas', status: null },
  { value: 'ativas', label: 'Ativas', status: 'active' },
  { value: 'arquivadas', label: 'Arquivadas', status: 'archived' },
];

const TIPOS = ['Grupos', 'Divulgação', 'Outro'];

// Indicadores reais. Grupos/contas/participantes são o estado atual; Entraram/Saíram/Clicks/
// % de entrada refletem o período selecionado (atividades + cliques no link de convite).
const STATS = [
  { key: 'clicks', label: 'Clicks' },
  { key: 'entraram', label: 'Entraram' },
  { key: 'percentualEntrada', label: '% entrada', suffix: '%' },
  { key: 'sairam', label: 'Saíram' },
  { key: 'participantes', label: 'Participantes' },
  { key: 'grupos', label: 'Grupos' },
  { key: 'gruposCheios', label: 'Grupos cheios' },
  { key: 'gruposDisponiveis', label: 'Grupos disponíveis' },
];

export default function Campaigns() {
  const navigate = useNavigate();
  const [campaigns, setCampaigns] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('campanhas');
  const [periodo, setPeriodo] = useState('7');
  const [createOpen, setCreateOpen] = useState(false);
  const [editCampaign, setEditCampaign] = useState(null);

  const load = useCallback(async () => {
    const metricsParams = appendLocalRange(new URLSearchParams({ periodo }), Number(periodo));
    const [list, m] = await Promise.all([api('/api/campaigns'), api(`/api/campaigns/metrics?${metricsParams}`)]);
    setCampaigns(list.campaigns);
    setMetrics(m.metrics);
  }, [periodo]);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  const filtered = useMemo(() => {
    const t = TABS.find((x) => x.value === tab);
    if (!t?.status) return campaigns;
    return campaigns.filter((c) => c.status === t.status);
  }, [campaigns, tab]);

  async function handleArchive(c, arquivar) {
    await api(`/api/campaigns/${c.id}/${arquivar ? 'archive' : 'unarchive'}`, { method: 'POST' });
    load();
  }

  async function handleDelete(c) {
    if (!window.confirm(`Excluir a campanha "${c.nome}"? Essa ação não pode ser desfeita.`)) return;
    await api(`/api/campaigns/${c.id}`, { method: 'DELETE' });
    load();
  }

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Stack gap={0}>
          <Title order={2}>Campanhas</Title>
          <Text c="dimmed" size="sm">Cada campanha concentra contas associadas + grupos.</Text>
        </Stack>
        <Button leftSection={<IconPlus size={16} />} onClick={() => setCreateOpen(true)}>Campanha</Button>
      </Group>

      {/* Faixa de indicadores */}
      <Paper withBorder p="md" radius="md">
        <Group justify="space-between" mb="sm">
          <Group gap={6}>
            <Text fw={500} size="sm">Indicadores</Text>
            <Tooltip
              multiline
              w={280}
              label="Clicks, Entraram, Saíram e % de entrada refletem o período selecionado (cliques no link de convite e entradas/saídas reais dos grupos). % de entrada = Entraram dividido por Clicks. Os demais indicadores são o estado atual."
            >
              <ActionIcon variant="subtle" color="gray" size="sm"><IconInfoCircle size={14} /></ActionIcon>
            </Tooltip>
          </Group>
          <SegmentedControl
            size="xs"
            value={periodo}
            onChange={setPeriodo}
            data={['7', '14', '21', '28', '90'].map((d) => ({ label: `${d}d`, value: d }))}
          />
        </Group>
        <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
          {STATS.map((s) => (
            <Stack key={s.key} gap={0}>
              <Text fw={700} size="xl">{metrics ? `${metrics[s.key] ?? 0}${s.suffix || ''}` : '—'}</Text>
              <Text c="dimmed" size="xs">{s.label}</Text>
            </Stack>
          ))}
        </SimpleGrid>
      </Paper>

      <Tabs value={tab} onChange={setTab}>
        <Tabs.List>
          {TABS.map((t) => <Tabs.Tab key={t.value} value={t.value}>{t.label}</Tabs.Tab>)}
        </Tabs.List>
      </Tabs>

      {loading ? (
        <Center py="xl"><Loader color="whatsapp.8" /></Center>
      ) : filtered.length === 0 ? (
        <Text c="dimmed" size="sm" ta="center" py="xl">Nenhuma campanha aqui. Crie uma com "+ Campanha".</Text>
      ) : (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
          {filtered.map((c) => (
            <Card
              key={c.id}
              withBorder
              radius="md"
              padding="md"
              style={{ cursor: 'pointer' }}
              onClick={() => navigate(`/campanhas/${c.id}`)}
            >
              <Group justify="space-between" wrap="nowrap" mb="xs">
                <Group gap="sm" wrap="nowrap">
                  <ActionIcon variant="light" color="whatsapp.8" size="lg" radius="md"><IconSpeakerphone size={18} /></ActionIcon>
                  <Stack gap={0}>
                    <Text fw={600} lineClamp={1}>{c.nome}</Text>
                    <Group gap={6}>
                      {c.tipo && <Badge size="xs" variant="light" color="gray">{c.tipo}</Badge>}
                      {c.status === 'archived' && <Badge size="xs" color="gray" variant="dot">arquivada</Badge>}
                    </Group>
                  </Stack>
                </Group>
                <Menu position="bottom-end" shadow="sm">
                  <Menu.Target>
                    <ActionIcon variant="subtle" color="gray" onClick={(e) => e.stopPropagation()}><IconDots size={16} /></ActionIcon>
                  </Menu.Target>
                  <Menu.Dropdown onClick={(e) => e.stopPropagation()}>
                    {c.status === 'archived' ? (
                      <Menu.Item leftSection={<IconArchiveOff size={16} />} onClick={() => handleArchive(c, false)}>Desarquivar</Menu.Item>
                    ) : (
                      <Menu.Item leftSection={<IconArchive size={16} />} onClick={() => handleArchive(c, true)}>Arquivar</Menu.Item>
                    )}
                    <Menu.Item leftSection={<IconPencil size={16} />} onClick={() => setEditCampaign(c)}>Editar</Menu.Item>
                    <Menu.Item leftSection={<IconTrash size={16} />} color="red" onClick={() => handleDelete(c)}>Excluir</Menu.Item>
                  </Menu.Dropdown>
                </Menu>
              </Group>
              <Group gap="xl">
                <Stack gap={0}><Text fw={600}>{metrics?.porCampanha?.[c.id]?.clicks ?? 0}</Text><Text c="dimmed" size="xs">clicks</Text></Stack>
                <Stack gap={0}><Text fw={600}>{c._count?.groups ?? 0}</Text><Text c="dimmed" size="xs">grupos</Text></Stack>
                <Stack gap={0}><Text fw={600}>{metrics?.porCampanha?.[c.id]?.entraram ?? 0}</Text><Text c="dimmed" size="xs">entraram</Text></Stack>
                <Stack gap={0}><Text fw={600}>{metrics?.porCampanha?.[c.id]?.sairam ?? 0}</Text><Text c="dimmed" size="xs">saíram</Text></Stack>
              </Group>
            </Card>
          ))}
        </SimpleGrid>
      )}

      <CampaignFormModal
        opened={createOpen || Boolean(editCampaign)}
        campaign={editCampaign}
        onClose={() => { setCreateOpen(false); setEditCampaign(null); }}
        onSaved={load}
      />
    </Stack>
  );
}

function CampaignFormModal({ opened, campaign, onClose, onSaved }) {
  const editing = Boolean(campaign);
  const [nome, setNome] = useState('');
  const [tipo, setTipo] = useState(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (opened) {
      setNome(campaign?.nome || '');
      setTipo(campaign?.tipo || null);
      setError('');
    }
  }, [opened, campaign]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      if (editing) {
        await api(`/api/campaigns/${campaign.id}`, { method: 'PATCH', body: JSON.stringify({ nome, tipo }) });
      } else {
        await api('/api/campaigns', { method: 'POST', body: JSON.stringify({ nome, tipo }) });
      }
      await onSaved();
      onClose();
    } catch (err) {
      setError(err.message || 'Não foi possível salvar.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal opened={opened} onClose={onClose} title={editing ? 'Editar campanha' : 'Criar campanha'} centered>
      <form onSubmit={handleSubmit}>
        <Stack gap="sm">
          <TextInput
            label="Nome da campanha"
            placeholder="Ex.: Lançamento iEducação"
            value={nome}
            onChange={(e) => setNome(e.currentTarget.value)}
            error={error || undefined}
            autoFocus
            required
          />
          <Select
            label="Tipo"
            description="Rótulo organizacional (opcional)."
            placeholder="Selecione"
            data={TIPOS}
            value={tipo}
            onChange={setTipo}
            clearable
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>Cancelar</Button>
            <Button type="submit" loading={submitting}>{editing ? 'Salvar' : 'Criar campanha'}</Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
