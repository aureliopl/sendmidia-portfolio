import { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Stack,
  Group,
  SegmentedControl,
  MultiSelect,
  NumberInput,
  Select,
  Button,
  Text,
  Paper,
  Alert,
  Badge,
} from '@mantine/core';
import { IconSend, IconTestPipe, IconAlertTriangle, IconCheck, IconClock } from '@tabler/icons-react';
import { api } from '../lib/api';
import { VELOCIDADES, estimateSendDuration } from '../lib/velocidades';
import DateTimeScheduler from './DateTimeScheduler';
import { BlocosPreview } from './BlocoBalao';

// Modal de disparo (M8): contas de envio (distribuição entre contas), grupos
// destino, quando e velocidade (default vem das Configurações da campanha).
// "Enviar teste para mim" usa o chat pessoal da 1ª conta selecionada (seguro).
export default function SendScheduleModal({ campaignId, message, groups, opened, onClose, onScheduled }) {
  const [accounts, setAccounts] = useState([]); // associadas + conectadas
  const [contasMode, setContasMode] = useState('todas');
  const [contasSel, setContasSel] = useState([]);
  const [destino, setDestino] = useState('todos');
  const [gruposAlvo, setGruposAlvo] = useState([]);
  const [marcarTodos, setMarcarTodos] = useState('nao');
  const [quando, setQuando] = useState('agora');
  const [data, setData] = useState(null);
  const [velocidade, setVelocidade] = useState('normal');
  const [intMin, setIntMin] = useState(140);
  const [intMax, setIntMax] = useState(460);
  const [busy, setBusy] = useState(false);
  const [testStatus, setTestStatus] = useState(null);

  useEffect(() => {
    if (!opened) return;
    setContasMode('todas');
    setContasSel([]);
    const alvo = message?.gruposAlvo || [];
    setDestino(alvo.length > 0 ? 'especificos' : 'todos');
    setGruposAlvo(alvo);
    setMarcarTodos('nao');
    setQuando('agora');
    setData(null);
    setTestStatus(null);
    // Contas associadas e conectadas da campanha.
    api(`/api/campaigns/${campaignId}/accounts`)
      .then((d) => setAccounts(d.accounts.filter((a) => a.associada && a.status === 'connected')))
      .catch(() => setAccounts([]));
    // Velocidade default = configuração da campanha.
    api(`/api/campaigns/${campaignId}`)
      .then((d) => setVelocidade(d.campaign.velocidadePadrao || 'normal'))
      .catch(() => setVelocidade('normal'));
  }, [opened, message, campaignId]);

  const contasEfetivas = useMemo(
    () => (contasMode === 'todas' ? accounts : accounts.filter((a) => contasSel.includes(a.id))),
    [contasMode, contasSel, accounts],
  );
  const testAccount = contasEfetivas[0] || null;
  const nGrupos = destino === 'especificos' ? gruposAlvo.length : groups.length;
  const estimativa = useMemo(() => estimateSendDuration({
    totalGrupos: nGrupos,
    contas: contasEfetivas.length || 1,
    perfilVelocidade: velocidade,
    intervaloMin: intMin,
    intervaloMax: intMax,
  }), [nGrupos, contasEfetivas.length, velocidade, intMin, intMax]);

  async function enviarTeste() {
    if (!testAccount) return;
    setBusy(true);
    setTestStatus(null);
    try {
      await api(`/api/campaigns/${campaignId}/messages/${message.id}/test-send`, {
        method: 'POST',
        body: JSON.stringify({ accountId: testAccount.id }),
      });
      setTestStatus('ok');
    } catch {
      setTestStatus('Falha no teste. A conta está conectada?');
    } finally {
      setBusy(false);
    }
  }

  async function agendar() {
    const agora = quando === 'agora';
    if (agora) {
      const ok = window.confirm(
        `Atenção: enviar agora para ${nGrupos} grupo(s), distribuídos entre ${contasEfetivas.length} conta(s). Estimativa: ${formatDuration(estimativa.segundosMin)} a ${formatDuration(estimativa.segundosMax)}. São pessoas reais. Confirmar?`,
      );
      if (!ok) return;
    }
    setBusy(true);
    try {
      await api(`/api/campaigns/${campaignId}/sends`, {
        method: 'POST',
        body: JSON.stringify({
          messageId: message.id,
          contas: contasMode === 'todas' ? 'todas' : contasSel,
          gruposAlvo: destino === 'especificos' ? gruposAlvo : [],
          marcarTodos: marcarTodos === 'sim',
          agendadoPara: agora ? new Date().toISOString() : data?.toISOString(),
          perfilVelocidade: velocidade,
          intervaloMin: intMin,
          intervaloMax: intMax,
        }),
      });
      await onScheduled?.();
      onClose();
    } catch (err) {
      window.alert(err.message === 'sem_grupos' ? 'A campanha não tem grupos.' : err.message === 'sem_contas_conectadas' ? 'Nenhuma conta conectada selecionada.' : 'Não foi possível agendar.');
    } finally {
      setBusy(false);
    }
  }

  const accountOptions = accounts.map((a) => ({ value: a.id, label: a.nome }));
  const groupOptions = groups.map((g) => ({ value: g.id, label: g.nome }));
  const podeAgendar = contasEfetivas.length > 0 && nGrupos > 0 && (quando === 'agora' || data);

  return (
    <Modal opened={opened} onClose={onClose} title="Disparar mensagem" centered size="lg">
      <Stack gap="sm">
        <BlocosPreview blocos={message?.blocos || []} mah={240} />

        {/* Contas de envio */}
        <Stack gap={6}>
          <Text size="sm" fw={500}>Contas de envio</Text>
          {accounts.length === 0 ? (
            <Text size="xs" c="dimmed">Nenhuma conta conectada associada à campanha. Associe contas na aba "Contas associadas".</Text>
          ) : (
            <>
              <SegmentedControl
                value={contasMode}
                onChange={setContasMode}
                data={[{ label: `Todas da campanha (${accounts.length})`, value: 'todas' }, { label: 'Específicas', value: 'especificas' }]}
              />
              {contasMode === 'especificas' && (
                <MultiSelect data={accountOptions} value={contasSel} onChange={setContasSel} placeholder="Selecione as contas" searchable clearable />
              )}
              <Text size="xs" c="dimmed">Os grupos são distribuídos aleatoriamente entre as contas selecionadas (reduz o risco de banimento).</Text>
            </>
          )}
        </Stack>

        {/* Teste seguro */}
        <Alert variant="light" color="whatsapp.8" p="xs" icon={<IconTestPipe size={16} />}>
          <Group justify="space-between" wrap="nowrap">
            <Text size="xs">Envie um teste para o seu próprio número{testAccount ? ` (via ${testAccount.nome})` : ''} antes de disparar.</Text>
            <Button size="xs" variant="white" onClick={enviarTeste} loading={busy} disabled={!testAccount}>Enviar teste para mim</Button>
          </Group>
          {testStatus === 'ok' && <Group gap={4} mt={4}><IconCheck size={14} color="green" /><Text size="xs" c="whatsapp.8">Teste enviado ao seu WhatsApp.</Text></Group>}
          {testStatus && testStatus !== 'ok' && <Text size="xs" c="red" mt={4}>{testStatus}</Text>}
        </Alert>

        {/* Grupos destino */}
        <Stack gap={6}>
          <Text size="sm" fw={500}>Grupos destino</Text>
          <SegmentedControl
            value={destino}
            onChange={setDestino}
            data={[{ label: `Todos da campanha (${groups.length})`, value: 'todos' }, { label: 'Específicos', value: 'especificos' }]}
          />
          {destino === 'especificos' && (
            groupOptions.length === 0
              ? <Text size="xs" c="dimmed">Importe grupos na aba Grupos.</Text>
              : <MultiSelect data={groupOptions} value={gruposAlvo} onChange={setGruposAlvo} placeholder="Selecione os grupos" searchable clearable />
          )}
        </Stack>

        {/* Marcar todos os participantes (menção oculta) */}
        <Stack gap={6}>
          <Text size="sm" fw={500}>Marcar todos os participantes</Text>
          <SegmentedControl
            value={marcarTodos}
            onChange={setMarcarTodos}
            data={[{ label: 'Não', value: 'nao' }, { label: 'Sim', value: 'sim' }]}
          />
          <Text size="xs" c="dimmed">
            Notifica todos os membros no aparelho, mesmo com o grupo silenciado. A marcação fica invisível, a mensagem não mostra "@todos".
          </Text>
        </Stack>

        {/* Quando */}
        <Stack gap={6}>
          <Text size="sm" fw={500}>Quando</Text>
          <SegmentedControl value={quando} onChange={setQuando} data={[{ label: 'Agora', value: 'agora' }, { label: 'Agendar', value: 'agendar' }]} />
          {quando === 'agendar' && (
            <DateTimeScheduler value={data} onChange={setData} minDate={new Date()} />
          )}
        </Stack>

        {/* Velocidade */}
        <Stack gap={6}>
          <Text size="sm" fw={500}>Velocidade (intervalo entre grupos)</Text>
          <Select data={VELOCIDADES} value={velocidade} onChange={setVelocidade} />
          {velocidade === 'custom' && (
            <Group grow>
              <NumberInput label="Mín (s)" value={intMin} onChange={setIntMin} min={60} />
              <NumberInput label="Máx (s)" value={intMax} onChange={setIntMax} min={intMin} />
            </Group>
          )}
          <Text size="xs" c="dimmed">Padrão definido nas Configurações da campanha. Intervalos aleatórios reduzem o padrão detectável pela Meta.</Text>
        </Stack>

        <Alert variant="light" color="whatsapp.8" p="xs" icon={<IconClock size={16} />}>
          <Stack gap={4}>
            <Group gap="xs" wrap="wrap">
              <Badge variant="light" color="gray">{nGrupos} grupo(s)</Badge>
              <Badge variant="light" color="gray">{contasEfetivas.length} conta(s)</Badge>
              <Badge variant="light" color="whatsapp.8">{formatDuration(estimativa.segundosMin)} a {formatDuration(estimativa.segundosMax)}</Badge>
            </Group>
            <Text size="xs">
              Distribuição aproximada: {estimativa.porConta.filter((qtd) => qtd > 0).join(', ') || '0'} grupo(s) por conta.
              Pacotes de {estimativa.pacoteTamanho} grupo(s), com pausa de {formatDuration(estimativa.pausaPacoteMin)} a {formatDuration(estimativa.pausaPacoteMax)} entre pacotes.
            </Text>
          </Stack>
        </Alert>

        {quando === 'agora' && (
          <Alert variant="light" color="orange" p="xs" icon={<IconAlertTriangle size={16} />}>
            <Text size="xs">"Disparar agora" envia para grupos reais imediatamente. Use o teste acima primeiro.</Text>
          </Alert>
        )}

        <Group justify="flex-end" mt="xs">
          <Button variant="default" onClick={onClose}>Cancelar</Button>
          <Button leftSection={<IconSend size={16} />} onClick={agendar} loading={busy} disabled={!podeAgendar} color={quando === 'agora' ? 'orange' : 'whatsapp.8'}>
            {quando === 'agora' ? 'Disparar agora' : 'Agendar'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function formatDuration(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  if (s < 60) return `${s}s`;
  const minutes = Math.round(s / 60);
  if (minutes < 60) return `${minutes}min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}min` : `${h}h`;
}
