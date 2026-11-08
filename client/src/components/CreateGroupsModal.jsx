import { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Stack,
  Group,
  Text,
  Button,
  Select,
  TextInput,
  NumberInput,
  Switch,
  Alert,
  Code,
} from '@mantine/core';
import { IconInfoCircle, IconUsersPlus } from '@tabler/icons-react';
import { api } from '../lib/api';

// Pré-visualização dos nomes — mesma regra do servidor (montarNomes): com numeração,
// anexa " #NN" (2 dígitos) a partir do número inicial.
function previewNomes(nomeBase, quantidade, numerar, numeroInicial) {
  const base = (nomeBase || '').trim();
  if (!base) return [];
  const qtd = Math.max(1, Math.min(20, Number(quantidade) || 1));
  if (!numerar) return Array.from({ length: qtd }, () => base);
  const inicio = Math.max(1, Number(numeroInicial) || 1);
  return Array.from({ length: qtd }, (_, i) => `${base} #${String(inicio + i).padStart(2, '0')}`);
}

// Criar grupos (M6.2) — cria grupos REAIS no WhatsApp pela conta escolhida.
export default function CreateGroupsModal({ campaignId, opened, onClose, onCreated }) {
  const [accounts, setAccounts] = useState([]);
  const [accountId, setAccountId] = useState(null);
  const [nomeBase, setNomeBase] = useState('');
  const [quantidade, setQuantidade] = useState(1);
  const [numerar, setNumerar] = useState(true);
  const [numeroInicial, setNumeroInicial] = useState(1);
  const [aprovarEntrada, setAprovarEntrada] = useState(false);
  const [criando, setCriando] = useState(false);
  const [erro, setErro] = useState('');

  useEffect(() => {
    if (opened) {
      setAccountId(null);
      setNomeBase('');
      setQuantidade(1);
      setNumerar(true);
      setNumeroInicial(1);
      setSoAdminEnvia(false);
      setAprovarEntrada(false);
      setErro('');
      api('/api/accounts').then((d) => setAccounts(d.accounts)).catch(() => {});
    }
  }, [opened]);

  const nomes = useMemo(
    () => previewNomes(nomeBase, quantidade, numerar, numeroInicial),
    [nomeBase, quantidade, numerar, numeroInicial],
  );

  const accountOptions = accounts.map((a) => ({
    value: a.id,
    label: `${a.nome}${a.status === 'connected' ? '' : ' (desconectada)'}`,
    disabled: a.status !== 'connected',
  }));

  async function criar() {
    setErro('');
    setCriando(true);
    try {
      const r = await api(`/api/campaigns/${campaignId}/groups/create`, {
        method: 'POST',
        body: JSON.stringify({
          accountId,
          nomeBase: nomeBase.trim(),
          quantidade: Number(quantidade),
          numerar,
          numeroInicial: Number(numeroInicial),
          aprovarEntrada,
        }),
      });
      const falhou = r.falhas?.length
        ? `\n${r.falhas.length} falhou(ram), verifique se a conta segue conectada.`
        : '';
      window.alert(`${r.criados} de ${r.total} grupo(s) criado(s).${falhou}`);
      await onCreated();
      onClose();
    } catch (err) {
      setErro(err.message === 'not_connected' ? 'A conta precisa estar conectada.' : 'Não foi possível criar os grupos.');
    } finally {
      setCriando(false);
    }
  }

  const podeCriar = accountId && nomeBase.trim().length > 0 && Number(quantidade) >= 1;

  return (
    <Modal opened={opened} onClose={onClose} title="Criar grupos" size="lg" centered>
      <Stack gap="sm">
        <Select
          label="Conta criadora"
          description="A conta entra como administradora dos grupos criados."
          placeholder="Selecione uma conta conectada"
          data={accountOptions}
          value={accountId}
          onChange={setAccountId}
          searchable
        />

        <TextInput
          label="Nome base"
          placeholder="ex.: Promoções"
          value={nomeBase}
          onChange={(e) => setNomeBase(e.currentTarget.value)}
        />

        <Group grow align="flex-end">
          <NumberInput label="Quantidade" min={1} max={20} value={quantidade} onChange={setQuantidade} />
          <NumberInput
            label="Número inicial"
            min={1}
            value={numeroInicial}
            onChange={setNumeroInicial}
            disabled={!numerar}
          />
        </Group>

        <Switch
          label="Numerar automaticamente (#01, #02, …)"
          description="Anexa o número ao nome, útil para a regra de participantes duplicados."
          checked={numerar}
          onChange={(e) => setNumerar(e.currentTarget.checked)}
        />

        <Switch
          label="Aprovar entrada de novos membros"
          checked={aprovarEntrada}
          onChange={(e) => setAprovarEntrada(e.currentTarget.checked)}
        />
        <Text c="dimmed" size="xs">
          Quem pode enviar mensagem segue a configuração da campanha (Configurações, "Abertura da
          interação em grupos novos"): por padrão o grupo abre por um tempo e fecha sozinho depois.
        </Text>

        {nomes.length > 0 && (
          <Alert variant="light" color="gray" icon={<IconInfoCircle size={16} />} p="xs">
            <Text size="xs" mb={4}>Serão criados {nomes.length} grupo(s):</Text>
            <Group gap={6}>
              {nomes.slice(0, 4).map((n, i) => <Code key={i}>{n}</Code>)}
              {nomes.length > 4 && <Text size="xs" c="dimmed">+{nomes.length - 4}</Text>}
            </Group>
          </Alert>
        )}

        {erro && <Text c="red" size="sm">{erro}</Text>}

        <Text c="dimmed" size="xs">
          Criação real no WhatsApp. Crie poucos por vez e em conta saudável. Capacidade recomendada: até 600 por grupo.
        </Text>

        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>Cancelar</Button>
          <Button leftSection={<IconUsersPlus size={16} />} disabled={!podeCriar} loading={criando} onClick={criar}>
            Criar {nomes.length > 0 ? `(${nomes.length})` : ''}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
