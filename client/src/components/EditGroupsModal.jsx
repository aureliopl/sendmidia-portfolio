import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  Tabs,
  Stack,
  Group,
  Text,
  Button,
  TextInput,
  Textarea,
  Checkbox,
  Switch,
  NumberInput,
  Select,
  SegmentedControl,
  MultiSelect,
  Alert,
  Divider,
  Loader,
  Center,
  Progress,
  Badge,
  Anchor,
  Code,
} from '@mantine/core';
import {
  IconInfoCircle,
  IconShieldCheck,
  IconAlertTriangle,
} from '@tabler/icons-react';
import { api } from '../lib/api';
import { socket } from '../lib/socket';

const soDigitos = (s) => String(s || '').replace(/\D/g, '');

// Número em formato internacional consistente (E.164): "+" e os dígitos.
function fmtNumero(n) {
  const d = soDigitos(n);
  return d ? `+${d}` : '';
}

const PERM_OPCOES = [
  { label: 'Não alterar', value: 'manter' },
  { label: 'Ativar', value: 'ativar' },
  { label: 'Desativar', value: 'desativar' },
];

const TEMP_OPCOES = [
  { value: 'manter', label: 'Não alterar' },
  { value: '0', label: 'Desativadas' },
  { value: '86400', label: '24 horas' },
  { value: '604800', label: '7 dias' },
  { value: '7776000', label: '90 dias' },
];

// Bloco de permissão em três estados (não alterar / ativar / desativar) — em lote não
// sabemos o estado atual de cada grupo, então o padrão é "não alterar".
function PermissaoTri({ titulo, value, onChange, disabled }) {
  return (
    <Stack gap={4}>
      <Text size="sm" fw={500}>{titulo}</Text>
      <SegmentedControl size="xs" data={PERM_OPCOES} value={value} onChange={onChange} disabled={disabled} />
    </Stack>
  );
}

// Alterar grupos em lote (M6.3) — aplica edições REAIS no WhatsApp aos grupos selecionados,
// via FILA/WORKER (devagar, espaçado, anti-banimento). O modal acompanha o progresso ao vivo.
export default function EditGroupsModal({ campaignId, opened, onClose, selectedGroups = [] }) {
  const [aba, setAba] = useState('info');
  const [alterarNome, setAlterarNome] = useState(false);
  const [nome, setNome] = useState('');
  const [numerarNome, setNumerarNome] = useState(true);
  const [numeroInicial, setNumeroInicial] = useState(1);
  const [posicaoNumero, setPosicaoNumero] = useState('depois');
  const [alterarDescricao, setAlterarDescricao] = useState(false);
  const [descricao, setDescricao] = useState('');
  const [permEnvia, setPermEnvia] = useState('manter');
  const [permEditaInfo, setPermEditaInfo] = useState('manter');
  const [permAprovar, setPermAprovar] = useState('manter');
  const [mensagensTemp, setMensagensTemp] = useState('manter');
  const [promoverSel, setPromoverSel] = useState([]); // números (só dígitos) selecionados
  const [adicionarSeFora, setAdicionarSeFora] = useState(false); // opt-in arriscado: adicionar ao grupo
  const [admins, setAdmins] = useState(null); // números administrativos (Anti-spam)
  const [contas, setContas] = useState(null);
  const [progress, setProgress] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  // quantidade de grupos da rodada enviada (para o cabeçalho não mostrar 0 quando a lista recarrega)
  const qtdRodadaRef = useRef(0);

  const qtdSel = selectedGroups.length;
  const ativo = progress && progress.queued > 0;
  const temRodada = progress && progress.total > 0;
  const qtd = temRodada ? qtdRodadaRef.current || progress.total : qtdSel;
  const umGrupo = qtdSel === 1;

  useEffect(() => {
    if (!opened) return;
    setAba('info');
    setAlterarNome(false);
    setNome(umGrupo ? selectedGroups[0]?.nome || '' : '');
    setNumerarNome(qtdSel > 1);
    setNumeroInicial(1);
    setPosicaoNumero('depois');
    setAlterarDescricao(false);
    setDescricao('');
    setPermEnvia('manter');
    setPermEditaInfo('manter');
    setPermAprovar('manter');
    setMensagensTemp('manter');
    setPromoverSel([]);
    setAdicionarSeFora(false);
    setErro('');
    setAdmins(null);
    setContas(null);
    setProgress(null);
    qtdRodadaRef.current = 0;
    api('/api/admin-numbers').then((d) => setAdmins(d.numbers)).catch(() => setAdmins([]));
    api(`/api/campaigns/${campaignId}/accounts`)
      .then((d) => setContas(d.accounts.filter((a) => a.associada)))
      .catch(() => setContas([]));
    api(`/api/campaigns/${campaignId}/group-edits/progress`)
      .then((p) => setProgress(p.progress))
      .catch(() => setProgress(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened]);

  // Progresso ao vivo da alteração via Socket.IO.
  useEffect(() => {
    function onProg(d) {
      if (d.campaignId !== campaignId) return;
      setProgress({ queued: d.queued, done: d.done, failed: d.failed, canceled: d.canceled, total: d.total });
    }
    socket.on('groupedit:progress', onProg);
    return () => socket.off('groupedit:progress', onProg);
  }, [campaignId]);

  // Polling de apoio enquanto há alteração em andamento.
  useEffect(() => {
    if (!opened || !ativo) return;
    const t = setInterval(async () => {
      try {
        const r = await api(`/api/campaigns/${campaignId}/group-edits/progress`);
        setProgress(r.progress);
      } catch {
        // ignora — próxima iteração tenta de novo
      }
    }, 5000);
    return () => clearInterval(t);
  }, [opened, ativo, campaignId]);

  // Config de renomeação (nome base + numeração #NN). null quando não vai alterar o nome.
  const nomeConfig = useMemo(() => {
    if (!alterarNome || !nome.trim()) return null;
    return { base: nome.trim(), numerar: numerarNome, numeroInicial: Number(numeroInicial) || 1, posicao: posicaoNumero };
  }, [alterarNome, nome, numerarNome, numeroInicial, posicaoNumero]);

  // Campos comuns a todos os grupos (o nome é tratado à parte por variar com a numeração).
  const edits = useMemo(() => {
    const e = {};
    if (alterarDescricao) e.descricao = descricao;
    if (permEnvia !== 'manter') e.soAdminEnvia = permEnvia === 'ativar';
    if (permEditaInfo !== 'manter') e.soAdminEditaInfo = permEditaInfo === 'ativar';
    if (permAprovar !== 'manter') e.aprovarEntrada = permAprovar === 'ativar';
    if (mensagensTemp !== 'manter') e.mensagensTemporarias = Number(mensagensTemp);
    const nums = [...new Set(promoverSel.map(soDigitos).filter((n) => n.length >= 6))];
    if (nums.length) {
      e.promover = nums;
      if (adicionarSeFora) e.adicionarSeFora = true;
    }
    return e;
  }, [alterarDescricao, descricao, permEnvia, permEditaInfo, permAprovar, mensagensTemp, promoverSel, adicionarSeFora]);

  const temAlteracao = Object.keys(edits).length > 0 || nomeConfig !== null;

  const adminOptions = (admins || []).map((a) => {
    const num = soDigitos(a.numero);
    return { value: num, label: a.nome ? `${a.nome} · ${fmtNumero(num)}` : fmtNumero(num) };
  });

  // Nome resultante do i-ésimo grupo (preview), seguindo a mesma regra do servidor.
  function previewNome(i) {
    const base = nome.trim();
    if (!numerarNome) return base;
    const nn = `#${String((Number(numeroInicial) || 1) + i).padStart(2, '0')}`;
    return posicaoNumero === 'antes' ? `${nn} ${base}` : `${base} ${nn}`;
  }

  async function aplicar() {
    const resumo = [];
    if (nomeConfig) resumo.push(nomeConfig.numerar ? 'nome com numeração' : 'nome');
    if (edits.descricao !== undefined) resumo.push('descrição');
    if (edits.soAdminEnvia !== undefined) resumo.push('quem envia mensagem');
    if (edits.soAdminEditaInfo !== undefined) resumo.push('quem edita as informações');
    if (edits.aprovarEntrada !== undefined) resumo.push('aprovação de entrada');
    if (edits.mensagensTemporarias !== undefined) resumo.push('mensagens temporárias');
    if (edits.promover !== undefined) resumo.push(`promover ${edits.promover.length} administrador(es)`);
    const avisoAdd = edits.adicionarSeFora
      ? '\n\nATENÇÃO: você ativou "adicionar ao grupo quem não participa". Adicionar pessoas a grupos ' +
        'aumenta muito o risco de banimento da conta. Confirme só se tem certeza.'
      : '';
    const msg =
      `Aplicar as alterações (${resumo.join(', ')}) a ${qtdSel} grupo(s)?\n\n` +
      'A mudança é feita nos grupos reais do WhatsApp, devagar e em pacotes (anti-banimento): ' +
      '45 a 90 segundos entre cada grupo e, a cada 30 grupos por conta, uma pausa de 30 a 45 minutos ' +
      'antes do próximo pacote. Em lotes grandes pode levar horas. Você acompanha o progresso aqui e ' +
      `pode fechar a janela, o processo continua.${avisoAdd}`;
    if (!window.confirm(msg)) return;

    setErro('');
    setSalvando(true);
    try {
      const r = await api(`/api/campaigns/${campaignId}/groups/edit`, {
        method: 'POST',
        body: JSON.stringify({ ids: selectedGroups.map((g) => g.id), edits, nomeConfig }),
      });
      qtdRodadaRef.current = r.enfileirados || qtdSel;
      setProgress(r.progress);
    } catch (err) {
      setErro(err.message === 'ja_em_andamento' ? 'Já existe uma alteração em andamento nesta campanha.' : 'Não foi possível iniciar as alterações.');
    } finally {
      setSalvando(false);
    }
  }

  async function cancelar() {
    if (!window.confirm('Cancelar as alterações que ainda não foram aplicadas? (as já feitas permanecem)')) return;
    await api(`/api/campaigns/${campaignId}/group-edits/cancel`, { method: 'POST' });
    const r = await api(`/api/campaigns/${campaignId}/group-edits/progress`);
    setProgress(r.progress);
  }

  const processados = progress ? progress.done + progress.failed + progress.canceled : 0;
  const pct = progress && progress.total > 0 ? Math.round((processados / progress.total) * 100) : 0;
  const previewCount = Math.min(Math.max(qtdSel, 1), 4);

  return (
    <Modal opened={opened} onClose={onClose} title="Alterar grupos em lote" size="lg" centered>
      <Stack gap="sm">
        <Text size="sm" c="dimmed">
          {qtd === 1 ? '1 grupo' : `${qtd} grupos`} {temRodada ? 'nesta alteração' : 'selecionados'}. Só os campos marcados são alterados.
        </Text>

        <Tabs value={aba} onChange={setAba}>
          <Tabs.List>
            <Tabs.Tab value="info" leftSection={<IconInfoCircle size={16} />}>Informações</Tabs.Tab>
            <Tabs.Tab value="admins" leftSection={<IconShieldCheck size={16} />}>Administradores</Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="info" pt="md">
            <Stack gap="md">
              <Stack gap={6}>
                <Checkbox
                  label="Alterar nome do grupo"
                  checked={alterarNome}
                  disabled={ativo}
                  onChange={(e) => setAlterarNome(e.currentTarget.checked)}
                />
                {alterarNome && (
                  <>
                    <TextInput
                      placeholder="Nome base do grupo"
                      value={nome}
                      disabled={ativo}
                      onChange={(e) => setNome(e.currentTarget.value)}
                    />
                    <Switch
                      label="Numerar automaticamente (#01, #02, …)"
                      description="Cada grupo recebe um número em sequência, evitando nomes iguais."
                      checked={numerarNome}
                      disabled={ativo}
                      onChange={(e) => setNumerarNome(e.currentTarget.checked)}
                    />
                    {numerarNome && (
                      <Group grow align="flex-end">
                        <NumberInput
                          label="Início da contagem"
                          min={1}
                          value={numeroInicial}
                          disabled={ativo}
                          onChange={setNumeroInicial}
                        />
                        <Select
                          label="Posição do número"
                          data={[
                            { value: 'depois', label: 'Depois do nome' },
                            { value: 'antes', label: 'Antes do nome' },
                          ]}
                          value={posicaoNumero}
                          disabled={ativo}
                          onChange={(v) => setPosicaoNumero(v || 'depois')}
                          allowDeselect={false}
                        />
                      </Group>
                    )}
                    {nome.trim() && (
                      <Alert
                        variant="light"
                        color={!numerarNome && qtdSel > 1 ? 'orange' : 'gray'}
                        icon={<IconInfoCircle size={16} />}
                        p="xs"
                      >
                        {!numerarNome && qtdSel > 1 ? (
                          <Text size="xs">
                            Os {qtdSel} grupos ficariam com o mesmo nome "{nome.trim()}". Ative a numeração para diferenciá-los.
                          </Text>
                        ) : (
                          <>
                            <Text size="xs" mb={4}>Nomes resultantes:</Text>
                            <Group gap={6}>
                              {Array.from({ length: previewCount }).map((_, i) => (
                                <Code key={i}>{previewNome(i)}</Code>
                              ))}
                              {qtdSel > previewCount && <Text size="xs" c="dimmed">+{qtdSel - previewCount}</Text>}
                            </Group>
                          </>
                        )}
                      </Alert>
                    )}
                  </>
                )}
              </Stack>

              <Stack gap={4}>
                <Checkbox
                  label="Alterar descrição do grupo"
                  checked={alterarDescricao}
                  disabled={ativo}
                  onChange={(e) => setAlterarDescricao(e.currentTarget.checked)}
                />
                {alterarDescricao && (
                  <Textarea
                    placeholder="Descrição do grupo"
                    autosize
                    minRows={2}
                    maxRows={5}
                    value={descricao}
                    disabled={ativo}
                    onChange={(e) => setDescricao(e.currentTarget.value)}
                  />
                )}
              </Stack>

              <Divider label="Permissões" labelPosition="left" />

              <PermissaoTri titulo="Apenas administradores enviam mensagem" value={permEnvia} onChange={setPermEnvia} disabled={ativo} />
              <PermissaoTri titulo="Apenas administradores editam as informações do grupo" value={permEditaInfo} onChange={setPermEditaInfo} disabled={ativo} />
              <PermissaoTri titulo="Exigir aprovação de administrador para entrar" value={permAprovar} onChange={setPermAprovar} disabled={ativo} />

              <Select
                label="Mensagens temporárias"
                description="Tempo até as mensagens do grupo desaparecerem."
                data={TEMP_OPCOES}
                value={mensagensTemp}
                disabled={ativo}
                onChange={(v) => setMensagensTemp(v || 'manter')}
                allowDeselect={false}
              />
            </Stack>
          </Tabs.Panel>

          <Tabs.Panel value="admins" pt="md">
            <Stack gap="md">
              <Text size="sm">
                Promova a administrador, nos grupos selecionados, números do cadastro de Anti-spam.
              </Text>

              <Alert variant="light" color="orange" icon={<IconAlertTriangle size={16} />} p="xs">
                <Text size="xs">
                  Só são promovidos os números que <b>já participam</b> do grupo. Adicionar pessoas a grupos é um
                  dos maiores motivos de banimento do WhatsApp, então a plataforma <b>não adiciona</b> ninguém por
                  padrão. O caminho seguro para um novo administrador é ele <b>entrar pelo link de convite</b> e só
                  então ser promovido.
                </Text>
              </Alert>

              {admins === null ? (
                <Center py="sm"><Loader size="xs" color="whatsapp.8" /></Center>
              ) : adminOptions.length === 0 ? (
                <Alert variant="light" color="gray" icon={<IconInfoCircle size={16} />} p="xs">
                  <Text size="xs">
                    Nenhum número administrativo cadastrado. Cadastre em <Anchor href="/anti-spam" size="xs">Anti-spam</Anchor>, na aba Números administrativos.
                  </Text>
                </Alert>
              ) : (
                <>
                  <MultiSelect
                    label="Promover a administrador"
                    placeholder="Selecione os números"
                    data={adminOptions}
                    value={promoverSel}
                    onChange={setPromoverSel}
                    disabled={ativo}
                    searchable
                    clearable
                    nothingFoundMessage="Nenhum número encontrado"
                  />
                  {promoverSel.length > 0 && (
                    <Switch
                      color="red"
                      label="Adicionar ao grupo quem ainda não participa"
                      description="Risco alto de banimento. Use só com números que já têm esta conta na agenda, poucos por vez."
                      checked={adicionarSeFora}
                      disabled={ativo}
                      onChange={(e) => setAdicionarSeFora(e.currentTarget.checked)}
                    />
                  )}
                </>
              )}

              <Divider label="Administradores das contas associadas" labelPosition="left" />
              {contas === null ? (
                <Center py="sm"><Loader size="xs" color="whatsapp.8" /></Center>
              ) : contas.length === 0 ? (
                <Text size="xs" c="dimmed">Nenhuma conta associada a esta campanha.</Text>
              ) : (
                <Stack gap={4}>
                  {contas.map((c) => (
                    <Group key={c.id} justify="space-between" wrap="nowrap">
                      <Text size="sm">{c.nome}</Text>
                      <Text size="xs" c="dimmed" ff="monospace">{fmtNumero(c.telefone)}</Text>
                    </Group>
                  ))}
                  <Text size="xs" c="dimmed">
                    As contas que criaram ou importaram os grupos já entram como administradoras.
                  </Text>
                </Stack>
              )}
            </Stack>
          </Tabs.Panel>
        </Tabs>

        {/* Progresso da alteração (quando há rodada em andamento ou recém-terminada) */}
        {temRodada && (
          <Stack gap={4}>
            <Group justify="space-between">
              <Text size="sm" fw={500}>{ativo ? 'Aplicando alterações…' : 'Alteração concluída'}</Text>
              <Text size="xs" c="dimmed">{processados}/{progress.total}</Text>
            </Group>
            <Progress value={pct} color={ativo ? 'whatsapp.8' : 'gray'} animated={ativo} />
            <Group gap="xs">
              <Badge size="xs" variant="light" color="whatsapp.8">alterados: {progress.done}</Badge>
              {progress.failed > 0 && <Badge size="xs" variant="light" color="red">falhas: {progress.failed}</Badge>}
              {progress.queued > 0 && <Badge size="xs" variant="light" color="blue">na fila: {progress.queued}</Badge>}
              {progress.canceled > 0 && <Badge size="xs" variant="light" color="gray">cancelados: {progress.canceled}</Badge>}
              {ativo && <Button size="compact-xs" variant="subtle" color="red" onClick={cancelar}>Cancelar</Button>}
            </Group>
          </Stack>
        )}

        {erro && (
          <Alert variant="light" color="red" icon={<IconAlertTriangle size={16} />} p="xs">
            <Text size="sm">{erro}</Text>
          </Alert>
        )}

        <Text c="dimmed" size="xs">
          As alterações são aplicadas devagar e em pacotes, nos grupos reais do WhatsApp (anti-banimento): 45 a 90 segundos
          entre cada grupo e uma pausa de 30 a 45 minutos a cada 30 grupos por conta. Em lotes grandes pode levar bastante tempo.
        </Text>

        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>Fechar</Button>
          <Button disabled={!temAlteracao || ativo} loading={salvando} onClick={aplicar}>
            Aplicar
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
