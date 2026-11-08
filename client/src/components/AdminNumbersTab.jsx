import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Stack,
  Group,
  Text,
  Button,
  Table,
  TextInput,
  Select,
  Modal,
  Textarea,
  ActionIcon,
  Menu,
  Loader,
  Center,
  Alert,
} from '@mantine/core';
import {
  IconPlus,
  IconUpload,
  IconSearch,
  IconDots,
  IconTrash,
  IconInfoCircle,
  IconShieldCheck,
  IconAddressBook,
} from '@tabler/icons-react';
import { api } from '../lib/api';

// Exibe o número em formato internacional consistente para qualquer país: "+" e os
// dígitos, sem espaços nem traços (padrão E.164).
function fmtNumero(n) {
  const d = String(n || '').replace(/\D/g, '');
  return d ? `+${d}` : '';
}

// Cada linha do CSV/colagem: aceita "nome,numero", "numero,nome" ou só "numero".
// A parte com cara de telefone (>=6 dígitos) é o número; o resto vira nome.
function parseLista(texto) {
  return texto
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((linha) => {
      const partes = linha.split(/[,;\t]/).map((p) => p.trim()).filter(Boolean);
      if (partes.length >= 2) {
        const numero = partes.find((p) => (p.match(/\d/g) || []).length >= 6) || partes[partes.length - 1];
        const nome = partes.filter((p) => p !== numero).join(' ') || null;
        return { nome, numero };
      }
      return { nome: null, numero: partes[0] || '' };
    })
    .filter((it) => it.numero);
}

export default function AdminNumbersTab() {
  const [numbers, setNumbers] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState('');
  const [ordem, setOrdem] = useState('nome');

  const [addOpen, setAddOpen] = useState(false);
  const [novoNome, setNovoNome] = useState('');
  const [novoNumero, setNovoNumero] = useState('');
  const [salvando, setSalvando] = useState(false);

  const [csvOpen, setCsvOpen] = useState(false);
  const [csvTexto, setCsvTexto] = useState('');
  const [importando, setImportando] = useState(false);

  const carregar = useCallback(async () => {
    const r = await api('/api/admin-numbers');
    setNumbers(r.numbers);
  }, []);

  useEffect(() => {
    setLoading(true);
    carregar().finally(() => setLoading(false));
  }, [carregar]);

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const termoDigitos = busca.replace(/\D/g, '');
    let lista = (numbers || []).filter((n) => {
      if (!termo) return true;
      const nomeOk = (n.nome || '').toLowerCase().includes(termo);
      const numOk = termoDigitos && n.numero.includes(termoDigitos);
      return nomeOk || numOk;
    });
    lista = [...lista].sort((a, b) => {
      if (ordem === 'numero') return a.numero.localeCompare(b.numero);
      if (ordem === 'recentes') return new Date(b.criadoEm) - new Date(a.criadoEm);
      return (a.nome || '￿').localeCompare(b.nome || '￿');
    });
    return lista;
  }, [numbers, busca, ordem]);

  async function adicionar() {
    if (!novoNumero.trim()) return;
    setSalvando(true);
    try {
      await api('/api/admin-numbers', { method: 'POST', body: JSON.stringify({ numero: novoNumero, nome: novoNome }) });
      setNovoNome('');
      setNovoNumero('');
      setAddOpen(false);
      await carregar();
    } catch {
      window.alert('Número inválido.');
    } finally {
      setSalvando(false);
    }
  }

  async function importarCSV() {
    const itens = parseLista(csvTexto);
    if (itens.length === 0) {
      window.alert('Nenhum número válido encontrado. Use uma linha por número (ex.: "Nome, +55 69 99999-9999").');
      return;
    }
    setImportando(true);
    try {
      const r = await api('/api/admin-numbers/bulk', { method: 'POST', body: JSON.stringify({ itens }) });
      window.alert(`${r.adicionados} número(s) adicionado(s)${r.ignorados ? `, ${r.ignorados} ignorado(s)` : ''}.`);
      setCsvTexto('');
      setCsvOpen(false);
      await carregar();
    } finally {
      setImportando(false);
    }
  }

  async function remover(id, nome) {
    if (!window.confirm(`Remover ${nome || 'este número'} dos administrativos?`)) return;
    await api(`/api/admin-numbers/${id}`, { method: 'DELETE' });
    await carregar();
  }

  // Exporta os números administrativos como vCard (.vcf). O dono importa esse arquivo na agenda
  // de CADA celular/conta, deixando toda a equipe salva mutuamente. Números conhecidos (que se
  // têm na agenda) reduzem o risco de banimento ao adicionar/promover em grupos, e evita esquecer
  // de salvar um número em alguma conta. (O WhatsApp não deixa escrever na agenda pela API; por
  // isso a importação é manual, uma vez por aparelho.)
  function escVcf(s) {
    return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, ' ');
  }
  function exportarVCard() {
    const lista = numbers || [];
    if (lista.length === 0) {
      window.alert('Nenhum número administrativo cadastrado para exportar.');
      return;
    }
    const cards = lista.map((n) => {
      const tel = `+${n.numero}`;
      const fn = escVcf(n.nome?.trim() || tel);
      return ['BEGIN:VCARD', 'VERSION:3.0', `FN:${fn}`, `TEL;TYPE=CELL:${tel}`, 'END:VCARD'].join('\r\n');
    });
    const blob = new Blob([`${cards.join('\r\n')}\r\n`], { type: 'text/vcard;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sendmidia-administrativos.vcf';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Stack gap="sm">
      <Group justify="space-between" wrap="wrap">
        <Text fw={600} size="lg">Números administrativos</Text>
        <Group gap="xs">
          <Button leftSection={<IconPlus size={16} />} onClick={() => setAddOpen(true)}>Adicionar</Button>
          <Button variant="default" leftSection={<IconUpload size={16} />} onClick={() => setCsvOpen(true)}>Adicionar CSV</Button>
          <Button
            variant="default"
            leftSection={<IconAddressBook size={16} />}
            onClick={exportarVCard}
            disabled={!numbers?.length}
          >
            Exportar contatos (.vcf)
          </Button>
        </Group>
      </Group>

      <Alert variant="light" color="gray" icon={<IconInfoCircle size={16} />} p="xs">
        <Text size="xs">
          Cadastre aqui, de uma vez, todos os seus números administrativos. Eles <b>nunca</b> são listados como
          participantes duplicados nem removidos dos grupos. Os telefones das suas contas conectadas já entram
          automaticamente. Use <b>"Exportar contatos (.vcf)"</b> e importe o arquivo na agenda de cada celular ou
          conta: assim toda a equipe fica salva mutuamente, o que reduz o risco de banimento ao promover
          administradores (o WhatsApp não permite salvar contatos pela plataforma, só pela agenda do aparelho).
        </Text>
      </Alert>

      <Group justify="space-between" wrap="wrap">
        <TextInput
          placeholder="Buscar por nome ou número"
          leftSection={<IconSearch size={14} />}
          value={busca}
          onChange={(e) => setBusca(e.currentTarget.value)}
          w={280}
        />
        <Select
          label={null}
          w={180}
          data={[
            { value: 'nome', label: 'Ordem: alfabética' },
            { value: 'numero', label: 'Ordem: número' },
            { value: 'recentes', label: 'Ordem: mais recentes' },
          ]}
          value={ordem}
          onChange={(v) => setOrdem(v || 'nome')}
          allowDeselect={false}
        />
      </Group>

      {loading ? (
        <Center py="xl"><Loader color="whatsapp.8" size="sm" /></Center>
      ) : visiveis.length === 0 ? (
        <Stack align="center" py="xl" gap={4}>
          <IconShieldCheck size={28} color="var(--mantine-color-gray-5)" />
          <Text c="dimmed" size="sm">{numbers?.length ? 'Nenhum número encontrado para a busca.' : 'Nenhum número administrativo cadastrado.'}</Text>
          {!numbers?.length && <Text c="dimmed" size="xs">Use "Adicionar" ou "Adicionar CSV" para cadastrar.</Text>}
        </Stack>
      ) : (
        <Table verticalSpacing="xs" highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Nome</Table.Th>
              <Table.Th>Número</Table.Th>
              <Table.Th w={48} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {visiveis.map((n) => (
              <Table.Tr key={n.id}>
                <Table.Td>{n.nome || <Text c="dimmed" size="sm">—</Text>}</Table.Td>
                <Table.Td><Text ff="monospace" size="sm">{fmtNumero(n.numero)}</Text></Table.Td>
                <Table.Td>
                  <Menu position="bottom-end" shadow="sm">
                    <Menu.Target>
                      <ActionIcon variant="subtle" color="gray" aria-label="Ações"><IconDots size={16} /></ActionIcon>
                    </Menu.Target>
                    <Menu.Dropdown>
                      <Menu.Item color="red" leftSection={<IconTrash size={14} />} onClick={() => remover(n.id, n.nome)}>
                        Remover
                      </Menu.Item>
                    </Menu.Dropdown>
                  </Menu>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

      <Text c="dimmed" size="xs">{visiveis.length} de {numbers?.length || 0} número(s).</Text>

      {/* Modal Adicionar */}
      <Modal opened={addOpen} onClose={() => setAddOpen(false)} title="Adicionar número administrativo" centered>
        <Stack gap="sm">
          <TextInput label="Nome (opcional)" placeholder="ex.: Aurélio" value={novoNome} onChange={(e) => setNovoNome(e.currentTarget.value)} />
          <TextInput
            label="Número"
            placeholder="ex.: +55 69 99225-9054"
            value={novoNumero}
            onChange={(e) => setNovoNumero(e.currentTarget.value)}
            onKeyDown={(e) => e.key === 'Enter' && adicionar()}
            data-autofocus
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setAddOpen(false)}>Cancelar</Button>
            <Button onClick={adicionar} loading={salvando} disabled={!novoNumero.trim()}>Adicionar</Button>
          </Group>
        </Stack>
      </Modal>

      {/* Modal Adicionar CSV */}
      <Modal opened={csvOpen} onClose={() => setCsvOpen(false)} title="Adicionar em lote (CSV)" size="lg" centered>
        <Stack gap="sm">
          <Text size="sm" c="dimmed">
            Cole uma linha por número. Aceita "nome, número" ou só o número. Ex.:
          </Text>
          <Textarea
            autosize
            minRows={6}
            maxRows={14}
            placeholder={'Aurélio, +55 69 99225-9054\nCamila, +55 69 99357-3327\n+55 69 99322-9153'}
            value={csvTexto}
            onChange={(e) => setCsvTexto(e.currentTarget.value)}
            styles={{ input: { fontFamily: 'monospace' } }}
          />
          <Group justify="space-between">
            <Text size="xs" c="dimmed">{parseLista(csvTexto).length} número(s) detectado(s).</Text>
            <Group>
              <Button variant="default" onClick={() => setCsvOpen(false)}>Cancelar</Button>
              <Button onClick={importarCSV} loading={importando} disabled={parseLista(csvTexto).length === 0}>Importar</Button>
            </Group>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
