import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Stack, Title, Text, SimpleGrid, Card, Group, Badge, Anchor, Loader, Center, Alert, Button } from '@mantine/core';
import { IconClock, IconAlertTriangle } from '@tabler/icons-react';
import { api } from '../lib/api';
import { appendLocalRange, formatLocalDateTime } from '../lib/datetime';

export default function Home() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  // Importante distinguir "carregou e está vazio" de "falhou ao carregar": antes,
  // qualquer erro da API (ex.: 500 com tabelas inexistentes em produção) era engolido
  // e renderizado como "0 contas / 0 campanhas", mascarando o problema real.
  function load() {
    setError(null);
    setData(null);
    const metricsParams = appendLocalRange(new URLSearchParams({ periodo: '7' }), 7);
    Promise.all([api('/api/accounts'), api('/api/campaigns'), api('/api/sends/upcoming'), api(`/api/campaigns/metrics?${metricsParams}`)])
      .then(([a, c, s, m]) => setData({ accounts: a.accounts, campaigns: c.campaigns, upcoming: s.sends, metrics: m.metrics }))
      .catch((err) => setError(err?.message || 'Não foi possível carregar os dados.'));
  }

  useEffect(() => { load(); }, []);

  if (error) {
    return (
      <Stack gap="md">
        <div>
          <Title order={2}>Página inicial</Title>
          <Text c="dimmed" size="sm">Visão geral do sistema.</Text>
        </div>
        <Alert color="red" icon={<IconAlertTriangle size={18} />} title="Erro ao carregar a visão geral">
          <Stack gap="xs" align="flex-start">
            <Text size="sm">{error}</Text>
            <Button size="xs" variant="light" color="red" onClick={load}>Tentar novamente</Button>
          </Stack>
        </Alert>
      </Stack>
    );
  }

  if (!data) return <Center py="xl"><Loader color="whatsapp.8" /></Center>;

  const conectadas = data.accounts.filter((a) => a.status === 'connected').length;
  const ativas = data.campaigns.filter((c) => c.status === 'active').length;

  return (
    <Stack gap="md">
      <div>
        <Title order={2}>Página inicial</Title>
        <Text c="dimmed" size="sm">Visão geral do sistema.</Text>
      </div>
      <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
        <Card withBorder padding="md" radius="md" component={Link} to="/contas" style={{ textDecoration: 'none' }}>
          <Text fw={500} c="dark">Contas</Text>
          <Text fw={700} size="xl" c="dark">{data.accounts.length}</Text>
          <Text c="dimmed" size="xs">{conectadas} conectada(s)</Text>
        </Card>

        <Card withBorder padding="md" radius="md" component={Link} to="/campanhas" style={{ textDecoration: 'none' }}>
          <Text fw={500} c="dark">Campanhas</Text>
          <Text fw={700} size="xl" c="dark">{data.campaigns.length}</Text>
          <Text c="dimmed" size="xs">{ativas} ativa(s)</Text>
          <Text c="dimmed" size="xs">{data.metrics?.entraram ?? 0} entraram, {data.metrics?.sairam ?? 0} saíram (7 dias)</Text>
        </Card>

        <Card withBorder padding="md" radius="md">
          <Text fw={500} mb={6}>Próximos agendamentos</Text>
          {data.upcoming.length === 0 ? (
            <Text c="dimmed" size="sm">Nenhum disparo agendado.</Text>
          ) : (
            <Stack gap={8}>
              {data.upcoming.map((s) => (
                <Group key={s.id} justify="space-between" wrap="nowrap" gap="xs">
                  <Anchor component={Link} to={`/campanhas/${s.campaignId}`} size="sm" lineClamp={1}>{s.campaign?.nome}</Anchor>
                  <Group gap={6} wrap="nowrap">
                    <Group gap={2} wrap="nowrap"><IconClock size={12} /><Text size="xs" c="dimmed">{formatLocalDateTime(s.agendadoPara)}</Text></Group>
                    <Badge size="xs" variant="dot" color={s.status === 'processing' ? 'yellow' : 'blue'}>{s.status === 'processing' ? 'proc.' : 'agend.'}</Badge>
                  </Group>
                </Group>
              ))}
            </Stack>
          )}
        </Card>
      </SimpleGrid>
    </Stack>
  );
}
