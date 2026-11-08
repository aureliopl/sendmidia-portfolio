import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  Modal,
  Stepper,
  Stack,
  Group,
  Text,
  Button,
  Select,
  Checkbox,
  TextInput,
  Loader,
  Center,
  ScrollArea,
  Alert,
  Badge,
} from '@mantine/core';
import { IconSearch, IconRefresh, IconInfoCircle, IconUsers } from '@tabler/icons-react';
import { api } from '../lib/api';

// Wizard de 3 passos (Tela 7.3): Origem (conta) → Grupos → Confirmar.
// Importar é read-only no WhatsApp: busca os grupos ao vivo e persiste os escolhidos
// na campanha. A origem "outra campanha" fica para depois.
export default function ImportGroupsWizard({ campaignId, opened, onClose, onImported }) {
  const [step, setStep] = useState(0);
  const [accounts, setAccounts] = useState([]);
  const [accountId, setAccountId] = useState(null);
  const [groups, setGroups] = useState([]);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [erroGrupos, setErroGrupos] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [search, setSearch] = useState('');
  const [importing, setImporting] = useState(false);

  // Reset ao abrir.
  useEffect(() => {
    if (opened) {
      setStep(0);
      setAccountId(null);
      setGroups([]);
      setSelected(new Set());
      setSearch('');
      setErroGrupos('');
      api('/api/accounts').then((d) => setAccounts(d.accounts)).catch(() => {});
    }
  }, [opened]);

  const fetchGroups = useCallback(async () => {
    if (!accountId) return;
    setLoadingGroups(true);
    setErroGrupos('');
    try {
      const d = await api(`/api/accounts/${accountId}/groups`);
      setGroups(d.groups);
    } catch (err) {
      setErroGrupos(err.message === 'not_connected' ? 'A conta precisa estar conectada para listar os grupos.' : 'Não foi possível listar os grupos.');
      setGroups([]);
    } finally {
      setLoadingGroups(false);
    }
  }, [accountId]);

  const visiveis = useMemo(
    () => groups.filter((g) => g.nome.toLowerCase().includes(search.toLowerCase())),
    [groups, search],
  );

  function toggle(waId) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(waId) ? next.delete(waId) : next.add(waId);
      return next;
    });
  }
  function toggleAll() {
    setSelected((prev) => (prev.size === visiveis.length ? new Set() : new Set(visiveis.map((g) => g.waGroupId))));
  }

  async function goToGroups() {
    setStep(1);
    await fetchGroups();
  }

  async function confirmar() {
    setImporting(true);
    try {
      const r = await api(`/api/campaigns/${campaignId}/groups/import`, {
        method: 'POST',
        body: JSON.stringify({ accountId, waGroupIds: [...selected] }),
      });
      window.alert(`${r.importados} grupo(s) importado(s).`);
      await onImported();
      onClose();
    } catch (err) {
      window.alert(err.message === 'not_connected' ? 'A conta desconectou.' : 'Falha ao importar.');
    } finally {
      setImporting(false);
    }
  }

  const accountOptions = accounts.map((a) => ({
    value: a.id,
    label: `${a.nome}${a.status === 'connected' ? '' : ' (desconectada)'}`,
    disabled: a.status !== 'connected',
  }));

  return (
    <Modal opened={opened} onClose={onClose} title="Importar grupos" size="lg" centered>
      <Stepper active={step} size="sm" mb="md">
        <Stepper.Step label="Origem" description="Conta" />
        <Stepper.Step label="Grupos" description="Selecionar" />
        <Stepper.Step label="Confirmar" />
      </Stepper>

      {step === 0 && (
        <Stack gap="sm">
          <Text size="sm" c="dimmed">Importe grupos de uma conta conectada. (Importar de outra campanha chega depois.)</Text>
          <Select
            label="Escolha uma conta"
            placeholder="Selecione"
            data={accountOptions}
            value={accountId}
            onChange={setAccountId}
            searchable
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>Cancelar</Button>
            <Button disabled={!accountId} onClick={goToGroups}>Próximo</Button>
          </Group>
        </Stack>
      )}

      {step === 1 && (
        <Stack gap="sm">
          <Alert variant="light" color="gray" icon={<IconInfoCircle size={16} />} p="xs">
            <Text size="xs">Para administrar o grupo depois, a conta precisa ser admin nele. A importação aqui apenas traz o grupo para a campanha.</Text>
          </Alert>
          <Group justify="space-between">
            <TextInput placeholder="Buscar" leftSection={<IconSearch size={14} />} value={search} onChange={(e) => setSearch(e.currentTarget.value)} w={220} />
            <Button variant="subtle" size="xs" leftSection={<IconRefresh size={14} />} onClick={fetchGroups} loading={loadingGroups}>Atualizar</Button>
          </Group>

          {loadingGroups ? (
            <Center py="lg"><Loader color="whatsapp.8" size="sm" /></Center>
          ) : erroGrupos ? (
            <Text c="red" size="sm" ta="center" py="lg">{erroGrupos}</Text>
          ) : visiveis.length === 0 ? (
            <Text c="dimmed" size="sm" ta="center" py="lg">Nenhum grupo encontrado.</Text>
          ) : (
            <Stack gap={4}>
              <Group justify="space-between">
                <Checkbox
                  label="Selecionar todos"
                  checked={selected.size === visiveis.length && visiveis.length > 0}
                  indeterminate={selected.size > 0 && selected.size < visiveis.length}
                  onChange={toggleAll}
                />
                <Badge variant="light" color="gray">{selected.size} selecionado(s)</Badge>
              </Group>
              <ScrollArea.Autosize mah={300}>
                <Stack gap={2}>
                  {visiveis.map((g) => (
                    <Checkbox
                      key={g.waGroupId}
                      checked={selected.has(g.waGroupId)}
                      onChange={() => toggle(g.waGroupId)}
                      label={
                        <Group gap={6} wrap="nowrap">
                          <IconUsers size={14} />
                          <Text size="sm">{g.nome}</Text>
                          <Text size="xs" c="dimmed">({g.participantes})</Text>
                        </Group>
                      }
                    />
                  ))}
                </Stack>
              </ScrollArea.Autosize>
            </Stack>
          )}

          <Group justify="space-between">
            <Button variant="default" onClick={() => setStep(0)}>Voltar</Button>
            <Button disabled={selected.size === 0} onClick={() => setStep(2)}>Próximo ({selected.size})</Button>
          </Group>
        </Stack>
      )}

      {step === 2 && (
        <Stack gap="sm">
          <Text size="sm">Você vai importar <b>{selected.size}</b> grupo(s) para esta campanha.</Text>
          <Text size="xs" c="dimmed">Grupos já presentes na campanha são ignorados automaticamente.</Text>
          <Group justify="space-between">
            <Button variant="default" onClick={() => setStep(1)}>Voltar</Button>
            <Button onClick={confirmar} loading={importing}>Importar</Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}
