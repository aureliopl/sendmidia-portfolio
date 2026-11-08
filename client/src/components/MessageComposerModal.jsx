import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  Stack,
  Group,
  Textarea,
  Button,
  Switch,
  TextInput,
  Text,
  Paper,
  Image,
  ActionIcon,
  Badge,
  Grid,
  Tooltip,
  Divider,
  Center,
  FileButton,
  ThemeIcon,
  Menu,
  ScrollArea,
} from '@mantine/core';
import {
  IconWand,
  IconLink,
  IconX,
  IconBold,
  IconItalic,
  IconStrikethrough,
  IconCode,
  IconBlockquote,
  IconPhoto,
  IconVideo,
  IconMusic,
  IconGif,
  IconSticker,
  IconFile,
  IconUpload,
  IconPlus,
  IconDotsVertical,
  IconPencil,
  IconArrowUp,
  IconArrowDown,
  IconTrash,
  IconChartBar,
  IconUser,
} from '@tabler/icons-react';
import { api } from '../lib/api';
import { hasSpintax } from '../lib/spintax';
import { LinhaBalao, WALLPAPER, ehArquivoGif } from './BlocoBalao';

const URL_RE = /(https?:\/\/[^\s]+)/i;
const MAX_BLOCOS = 5;

const FORMATOS = [
  { icon: IconBold, marca: '*', label: 'Negrito' },
  { icon: IconItalic, marca: '_', label: 'Itálico' },
  { icon: IconStrikethrough, marca: '~', label: 'Tachado' },
  { icon: IconCode, marca: '```', label: 'Monoespaçado' },
];

const TIPOS_MIDIA = [
  { tipo: 'image', label: 'Imagem', icon: IconPhoto, accept: 'image/*' },
  { tipo: 'video', label: 'Vídeo', icon: IconVideo, accept: 'video/*' },
  { tipo: 'audio', label: 'Áudio', icon: IconMusic, accept: 'audio/*' },
  { tipo: 'gif', label: 'GIF', icon: IconGif, accept: 'image/gif,video/mp4' },
  { tipo: 'sticker', label: 'Sticker', icon: IconSticker, accept: 'image/*' },
  { tipo: 'document', label: 'Documento', icon: IconFile, accept: '' },
];
const tipoInfo = (t) => TIPOS_MIDIA.find((x) => x.tipo === t);

export default function MessageComposerModal({ campaignId, message, opened, onClose, onSaved }) {
  const editing = Boolean(message);

  // Blocos já adicionados à mensagem.
  const [blocos, setBlocos] = useState([]);
  const [editIndex, setEditIndex] = useState(null); // posição do bloco em edição (re-inserção)
  const [seed, setSeed] = useState(0);

  // Editor do bloco atual.
  const [conteudo, setConteudo] = useState('');
  const [midia, setMidia] = useState('');
  const [midiaTipo, setMidiaTipo] = useState(null);
  const [midiaNome, setMidiaNome] = useState(null);
  const [usarPreviewLink, setUsarPreviewLink] = useState(true);
  const [linkPreview, setLinkPreview] = useState(null);
  const [linkLoading, setLinkLoading] = useState(false);

  const [tipoSel, setTipoSel] = useState(null);
  const [urlInput, setUrlInput] = useState('');
  const [uploadingMidia, setUploadingMidia] = useState(false);
  const [uploadErro, setUploadErro] = useState('');

  // Bloco especial sendo composto (enquete ou contato), com seus campos.
  const [especial, setEspecial] = useState(null); // 'enquete' | 'contato'
  const [enqPergunta, setEnqPergunta] = useState('');
  const [enqOpcoes, setEnqOpcoes] = useState(['', '']);
  const [enqMultiplas, setEnqMultiplas] = useState(false);
  const [contNome, setContNome] = useState('');
  const [contNumero, setContNumero] = useState('');

  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const textareaRef = useRef(null);
  const lastFetchedUrl = useRef(null);

  function limparEditor() {
    setConteudo('');
    setMidia('');
    setMidiaTipo(null);
    setMidiaNome(null);
    setUsarPreviewLink(true);
    setLinkPreview(null);
    setTipoSel(null);
    setUrlInput('');
    setUploadErro('');
    setEspecial(null);
    setEnqPergunta('');
    setEnqOpcoes(['', '']);
    setEnqMultiplas(false);
    setContNome('');
    setContNumero('');
    lastFetchedUrl.current = null;
  }

  useEffect(() => {
    if (!opened) return;
    setBlocos(Array.isArray(message?.blocos) ? message.blocos.map((b) => ({ ...b })) : []);
    setEditIndex(null);
    setSeed(0);
    setError('');
    limparEditor();
  }, [opened, message]);

  const primeiroLink = useMemo(() => conteudo.match(URL_RE)?.[1] || null, [conteudo]);

  async function buscarLinkPreview(url) {
    if (!url) return;
    setLinkLoading(true);
    try {
      const r = await api('/api/link-preview', { method: 'POST', body: JSON.stringify({ url }) });
      setLinkPreview(r.preview);
    } catch {
      setLinkPreview({ url, image: null, title: null, description: 'Preview indisponível.' });
    } finally {
      setLinkLoading(false);
    }
  }

  useEffect(() => {
    if (!opened || !primeiroLink || !usarPreviewLink) return;
    if (lastFetchedUrl.current === primeiroLink) return;
    const t = setTimeout(() => {
      lastFetchedUrl.current = primeiroLink;
      buscarLinkPreview(primeiroLink);
    }, 700);
    return () => clearTimeout(t);
  }, [opened, primeiroLink, usarPreviewLink]);

  function envolver(marca) {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart ?? conteudo.length;
    const end = ta.selectionEnd ?? conteudo.length;
    const sel = conteudo.slice(start, end) || 'texto';
    const novo = conteudo.slice(0, start) + marca + sel + marca + conteudo.slice(end);
    setConteudo(novo);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(start + marca.length, start + marca.length + sel.length);
    });
  }
  function citar() {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart ?? 0;
    const lineStart = conteudo.lastIndexOf('\n', start - 1) + 1;
    setConteudo(`${conteudo.slice(0, lineStart)}> ${conteudo.slice(lineStart)}`);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(start + 2, start + 2);
    });
  }

  // ── Mídia ──
  async function uploadArquivo(file) {
    if (!file || !tipoSel) return;
    setUploadingMidia(true);
    setUploadErro('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await fetch(`/api/uploads?tipo=${tipoSel}`, { method: 'POST', body: fd, credentials: 'same-origin' });
      const data = await r.json();
      if (!r.ok || !data.ok) throw new Error(data.error || 'falha');
      setMidia(data.midia);
      setMidiaTipo(data.midiaTipo);
      setMidiaNome(data.midiaNome);
      setTipoSel(null);
      setUrlInput('');
    } catch (e) {
      setUploadErro(e.message === 'arquivo_grande' ? 'Arquivo muito grande (máximo 64MB).' : 'Não foi possível enviar o arquivo.');
    } finally {
      setUploadingMidia(false);
    }
  }
  function anexarUrl() {
    if (!urlInput.trim() || !tipoSel) return;
    setMidia(urlInput.trim());
    setMidiaTipo(tipoSel);
    setMidiaNome(null);
    setTipoSel(null);
    setUrlInput('');
  }
  function removerMidia() {
    setMidia('');
    setMidiaTipo(null);
    setMidiaNome(null);
    setTipoSel(null);
    setUrlInput('');
    setUploadErro('');
  }

  // ── Blocos ──
  const enqOpcoesValidas = enqOpcoes.map((o) => o.trim()).filter(Boolean);
  const especialValido =
    especial === 'enquete' ? Boolean(enqPergunta.trim() && enqOpcoesValidas.length >= 2)
      : especial === 'contato' ? Boolean(contNome.trim() && contNumero.replace(/\D/g, '').length >= 8)
        : false;
  const editorVazio = especial ? !especialValido : (!conteudo.trim() && !midia);
  const cheio = editIndex == null && blocos.length >= MAX_BLOCOS;

  function abrirEspecial(tipo) {
    setEspecial(tipo);
    setTipoSel(null);
    setUploadErro('');
  }

  async function adicionarBloco() {
    if (editorVazio || cheio) return;
    let bloco;
    if (especial === 'enquete') {
      bloco = { tipo: 'enquete', pergunta: enqPergunta.trim(), opcoes: enqOpcoesValidas, multiplas: enqMultiplas };
    } else if (especial === 'contato') {
      bloco = { tipo: 'contato', nome: contNome.trim(), numero: contNumero.replace(/\D/g, '') };
    } else {
      // texto/mídia. Persiste o preview do link no bloco (garante o carregamento).
      let lp = null;
      if (!midia && primeiroLink && usarPreviewLink) {
        lp = linkPreview && linkPreview.url === primeiroLink ? linkPreview : null;
        if (!lp) {
          try {
            const r = await api('/api/link-preview', { method: 'POST', body: JSON.stringify({ url: primeiroLink }) });
            lp = r.preview;
          } catch {
            lp = null;
          }
        }
      }
      bloco = {
        tipo: midia ? 'midia' : 'texto',
        conteudo,
        midia: midia || null,
        midiaTipo: midia ? midiaTipo : null,
        midiaNome: midia ? midiaNome : null,
        usarPreviewLink,
        linkPreview: lp,
      };
    }
    setBlocos((prev) => {
      const next = [...prev];
      if (editIndex != null) next.splice(editIndex, 0, bloco);
      else next.push(bloco);
      return next;
    });
    setEditIndex(null);
    limparEditor();
  }

  function editarBloco(i) {
    const b = blocos[i];
    limparEditor();
    if (b.tipo === 'enquete') {
      setEspecial('enquete');
      setEnqPergunta(b.pergunta || '');
      setEnqOpcoes(b.opcoes?.length ? [...b.opcoes] : ['', '']);
      setEnqMultiplas(b.multiplas === true);
    } else if (b.tipo === 'contato') {
      setEspecial('contato');
      setContNome(b.nome || '');
      setContNumero(b.numero || '');
    } else {
      setConteudo(b.conteudo || '');
      setMidia(b.midia || '');
      setMidiaTipo(b.midiaTipo || null);
      setMidiaNome(b.midiaNome || null);
      setUsarPreviewLink(b.usarPreviewLink !== false);
      setLinkPreview(b.linkPreview || null);
      lastFetchedUrl.current = b.linkPreview?.url || null;
    }
    setBlocos((prev) => prev.filter((_, idx) => idx !== i));
    setEditIndex(i);
  }
  function moverBloco(i, dir) {
    setBlocos((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }
  function excluirBloco(i) {
    setBlocos((prev) => prev.filter((_, idx) => idx !== i));
  }

  const temSpintaxNosBlocos = useMemo(() => blocos.some((b) => hasSpintax(b.conteudo)), [blocos]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (blocos.length === 0) {
      setError('Adicione ao menos um conteúdo com o botão "Adicionar".');
      return;
    }
    setSubmitting(true);
    try {
      if (editing) {
        await api(`/api/messages/${message.id}`, { method: 'PATCH', body: JSON.stringify({ blocos, gruposAlvo: [] }) });
      } else {
        await api(`/api/campaigns/${campaignId}/messages`, { method: 'POST', body: JSON.stringify({ blocos, gruposAlvo: [] }) });
      }
      await onSaved();
      onClose();
    } catch (err) {
      setError('Não foi possível salvar.');
    } finally {
      setSubmitting(false);
    }
  }

  const ehImagemEditor = midiaTipo === 'image' || midiaTipo === 'sticker' || (midiaTipo === 'gif' && ehArquivoGif(midia, midiaNome));

  return (
    <Modal opened={opened} onClose={onClose} title={editing ? 'Editar mensagem' : 'Nova mensagem'} size={960} centered>
      <form onSubmit={handleSubmit}>
        <Grid gutter="md">
          {/* Pré-visualização (lista de blocos) */}
          <Grid.Col span={{ base: 12, md: 5 }}>
            <Group justify="space-between" mb={6} wrap="nowrap">
              <Text size="sm" fw={500}>Pré-visualização</Text>
              {temSpintaxNosBlocos && (
                <Button size="xs" variant="light" leftSection={<IconWand size={14} />} onClick={() => setSeed((s) => s + 1)}>Pré-visualizar variação</Button>
              )}
            </Group>
            <Paper radius="md" p="md" style={{ background: WALLPAPER, minHeight: 380 }}>
              {blocos.length === 0 ? (
                <Center h={340}>
                  <Text c="dimmed" size="sm" ta="center">Escreva um conteúdo ou anexe uma mídia no editor e clique em "Adicionar" para montar a mensagem.</Text>
                </Center>
              ) : (
                <ScrollArea.Autosize mah={520}>
                  <Stack gap="xs">
                    {blocos.map((b, i) => (
                      <BlocoPreview
                        key={i}
                        bloco={b}
                        seed={seed}
                        primeiro={i === 0}
                        ultimo={i === blocos.length - 1}
                        onEditar={() => editarBloco(i)}
                        onSubir={() => moverBloco(i, -1)}
                        onDescer={() => moverBloco(i, 1)}
                        onExcluir={() => excluirBloco(i)}
                      />
                    ))}
                  </Stack>
                </ScrollArea.Autosize>
              )}
            </Paper>
          </Grid.Col>

          {/* Editor */}
          <Grid.Col span={{ base: 12, md: 7 }}>
            <Stack gap="sm">
              {especial ? (
                /* Formulário de enquete ou contato (substitui o editor de texto/mídia). */
                <Paper withBorder p="sm" radius="md">
                  <Group justify="space-between" mb="sm">
                    <Text size="sm" fw={500}>{especial === 'enquete' ? 'Enquete' : 'Contato'}</Text>
                    <ActionIcon variant="subtle" color="gray" onClick={() => setEspecial(null)} aria-label="Cancelar"><IconX size={14} /></ActionIcon>
                  </Group>
                  {especial === 'enquete' ? (
                    <Stack gap="xs">
                      <TextInput label="Pergunta" placeholder="Ex.: Qual conteúdo você prefere?" value={enqPergunta} onChange={(e) => setEnqPergunta(e.currentTarget.value)} />
                      <Text size="xs" fw={500}>Opções (2 a 12)</Text>
                      {enqOpcoes.map((o, i) => (
                        <Group key={i} gap={4} wrap="nowrap">
                          <TextInput placeholder={`Opção ${i + 1}`} value={o} onChange={(e) => setEnqOpcoes((prev) => prev.map((x, j) => (j === i ? e.currentTarget.value : x)))} style={{ flex: 1 }} />
                          {enqOpcoes.length > 2 && <ActionIcon variant="subtle" color="red" onClick={() => setEnqOpcoes((prev) => prev.filter((_, j) => j !== i))} aria-label="Remover opção"><IconX size={14} /></ActionIcon>}
                        </Group>
                      ))}
                      {enqOpcoes.length < 12 && (
                        <Button variant="subtle" size="xs" leftSection={<IconPlus size={14} />} onClick={() => setEnqOpcoes((prev) => [...prev, ''])} style={{ alignSelf: 'flex-start' }}>Opção</Button>
                      )}
                      <Switch label="Permitir várias respostas" checked={enqMultiplas} onChange={(e) => setEnqMultiplas(e.currentTarget.checked)} color="whatsapp.8" />
                    </Stack>
                  ) : (
                    <Stack gap="xs">
                      <TextInput label="Nome" placeholder="Nome do contato" value={contNome} onChange={(e) => setContNome(e.currentTarget.value)} />
                      <TextInput label="Número" placeholder="5511999999999" description="Com código do país e DDD, apenas dígitos." value={contNumero} onChange={(e) => setContNumero(e.currentTarget.value)} />
                    </Stack>
                  )}
                </Paper>
              ) : (
                <>
                  <Group gap={4}>
                    {FORMATOS.map((f) => (
                      <Tooltip key={f.label} label={f.label} withArrow>
                        <ActionIcon variant="default" onClick={() => envolver(f.marca)} aria-label={f.label}><f.icon size={16} /></ActionIcon>
                      </Tooltip>
                    ))}
                    <Tooltip label="Citação" withArrow>
                      <ActionIcon variant="default" onClick={citar} aria-label="Citação"><IconBlockquote size={16} /></ActionIcon>
                    </Tooltip>
                    <Text size="xs" c="dimmed" ml={4}>Selecione o texto e aplique a formatação.</Text>
                  </Group>

                  <Textarea
                    ref={textareaRef}
                    placeholder="Escreva um conteúdo. Use *negrito*, _itálico_, ~tachado~ e Spintax {opção 1|opção 2}."
                    value={conteudo}
                    onChange={(e) => setConteudo(e.currentTarget.value)}
                    autosize
                    minRows={6}
                    maxRows={12}
                  />

                  {primeiroLink && !midia && (
                    <Group justify="space-between">
                      <Group gap={6}><IconLink size={14} /><Text size="sm" lineClamp={1} maw={220}>{primeiroLink}</Text>{linkLoading && <Badge size="xs" variant="light" color="gray">carregando…</Badge>}</Group>
                      <Switch size="xs" label="Enviar com preview" checked={usarPreviewLink} onChange={(e) => setUsarPreviewLink(e.currentTarget.checked)} color="whatsapp.8" />
                    </Group>
                  )}

                  {/* Mídia, enquete ou contato */}
                  <Stack gap={6}>
                    <Text size="sm" fw={500}>Mídia</Text>
                    {midia ? (
                      <Paper withBorder p="xs" radius="md">
                        <Group justify="space-between" wrap="nowrap">
                          <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
                            {ehImagemEditor ? (
                              <Image src={midia} w={44} h={44} radius="sm" fit="cover" fallbackSrc="" alt="" />
                            ) : (
                              <ThemeIcon variant="light" color="whatsapp.8" size={44}>{(() => { const I = tipoInfo(midiaTipo)?.icon || IconFile; return <I size={20} />; })()}</ThemeIcon>
                            )}
                            <Stack gap={0} style={{ minWidth: 0 }}>
                              <Text size="sm" fw={500}>{tipoInfo(midiaTipo)?.label || 'Mídia'}</Text>
                              <Text size="xs" c="dimmed" lineClamp={1}>{midiaNome || midia}</Text>
                            </Stack>
                          </Group>
                          <ActionIcon variant="subtle" color="red" onClick={removerMidia} aria-label="Remover mídia"><IconX size={16} /></ActionIcon>
                        </Group>
                      </Paper>
                    ) : tipoSel ? (
                      <Paper withBorder p="sm" radius="md">
                        <Group justify="space-between" mb="xs">
                          <Text size="sm" fw={500}>{tipoInfo(tipoSel)?.label}</Text>
                          <ActionIcon variant="subtle" color="gray" onClick={() => { setTipoSel(null); setUploadErro(''); }} aria-label="Cancelar"><IconX size={14} /></ActionIcon>
                        </Group>
                        <Group gap="xs" wrap="nowrap" align="flex-end">
                          <FileButton onChange={uploadArquivo} accept={tipoInfo(tipoSel)?.accept || undefined}>
                            {(props) => <Button {...props} variant="light" size="xs" leftSection={<IconUpload size={14} />} loading={uploadingMidia}>Enviar arquivo</Button>}
                          </FileButton>
                          {tipoSel === 'image' && (
                            <>
                              <Text size="xs" c="dimmed">ou</Text>
                              <TextInput size="xs" placeholder="cole a URL da imagem" value={urlInput} onChange={(e) => setUrlInput(e.currentTarget.value)} style={{ flex: 1 }} />
                              <Button variant="default" size="xs" onClick={anexarUrl} disabled={!urlInput.trim()}>Usar URL</Button>
                            </>
                          )}
                        </Group>
                        {uploadErro && <Text size="xs" c="red" mt={4}>{uploadErro}</Text>}
                        <Text size="xs" c="dimmed" mt={6}>O arquivo enviado fica no servidor por 90 dias e depois é excluído automaticamente.</Text>
                      </Paper>
                    ) : (
                      <Group gap={6} wrap="nowrap">
                        {TIPOS_MIDIA.map((t) => (
                          <Tooltip key={t.tipo} label={t.label} withArrow>
                            <ActionIcon variant="default" size="md" onClick={() => { setTipoSel(t.tipo); setUploadErro(''); }} aria-label={t.label}><t.icon size={16} /></ActionIcon>
                          </Tooltip>
                        ))}
                        <Tooltip label="Enquete" withArrow>
                          <ActionIcon variant="default" size="md" onClick={() => abrirEspecial('enquete')} aria-label="Enquete"><IconChartBar size={16} /></ActionIcon>
                        </Tooltip>
                        <Tooltip label="Contato" withArrow>
                          <ActionIcon variant="default" size="md" onClick={() => abrirEspecial('contato')} aria-label="Contato"><IconUser size={16} /></ActionIcon>
                        </Tooltip>
                      </Group>
                    )}
                  </Stack>
                </>
              )}

              {/* Adicionar bloco */}
              <Button
                variant="light"
                color="whatsapp.8"
                leftSection={editIndex != null ? <IconPencil size={16} /> : <IconPlus size={16} />}
                onClick={adicionarBloco}
                disabled={editorVazio || cheio}
              >
                {editIndex != null ? 'Adicionar (atualizar conteúdo)' : 'Adicionar'}
              </Button>
              {cheio && <Text size="xs" c="dimmed">Limite de {MAX_BLOCOS} conteúdos por mensagem.</Text>}
              {error && <Text size="xs" c="red">{error}</Text>}

              <Divider />
              <Group justify="flex-end">
                <Button variant="default" onClick={onClose}>Cancelar</Button>
                <Button type="submit" loading={submitting} disabled={blocos.length === 0}>{editing ? 'Salvar' : 'Criar mensagem'}</Button>
              </Group>
            </Stack>
          </Grid.Col>
        </Grid>
      </form>
    </Modal>
  );
}

// Um bloco na pré-visualização (balão à direita, estilo celular) + menu de ações à esquerda.
function BlocoPreview({ bloco, seed, primeiro, ultimo, onEditar, onSubir, onDescer, onExcluir }) {
  const menu = (
    <Menu position="bottom-start" withinPortal shadow="md">
      <Menu.Target>
        <ActionIcon variant="subtle" color="gray" aria-label="Opções do conteúdo"><IconDotsVertical size={16} /></ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item leftSection={<IconPencil size={14} />} onClick={onEditar}>Editar</Menu.Item>
        <Menu.Item leftSection={<IconArrowUp size={14} />} onClick={onSubir} disabled={primeiro}>Mover para cima</Menu.Item>
        <Menu.Item leftSection={<IconArrowDown size={14} />} onClick={onDescer} disabled={ultimo}>Mover para baixo</Menu.Item>
        <Menu.Divider />
        <Menu.Item leftSection={<IconTrash size={14} />} color="red" onClick={onExcluir}>Excluir</Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
  return <LinhaBalao bloco={bloco} seed={seed} maxMidia={180} menu={menu} />;
}
