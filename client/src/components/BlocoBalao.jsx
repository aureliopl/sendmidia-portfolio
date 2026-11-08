import { useState } from 'react';
import { Paper, Image, Text, Stack, Group, ThemeIcon, Button, ScrollArea, Avatar } from '@mantine/core';
import { IconFile, IconWand, IconChartBar, IconUser } from '@tabler/icons-react';
import { renderWhatsApp } from '../lib/whatsappFormat';
import { spin, hasSpintax } from '../lib/spintax';

// Cores que imitam a conversa do WhatsApp (mensagem enviada): fundo de conversa + balão verde.
export const WALLPAPER = '#efeae2';
const COR_ENVIADA = '#d9fdd3';

export function ehArquivoGif(midia, midiaNome) {
  return /\.gif($|\?)/i.test(midia || '') || /\.gif$/i.test(midiaNome || '');
}
export function ehImagemBloco(b) {
  return b.midiaTipo === 'image' || b.midiaTipo === 'sticker' || (b.midiaTipo === 'gif' && ehArquivoGif(b.midia, b.midiaNome));
}
function hostDe(url) {
  try {
    return new URL(url).hostname.replace('www.', '');
  } catch {
    return url;
  }
}

function iniciais(nome) {
  return (nome || '?').split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('');
}

const balaoStyle = { background: COR_ENVIADA, borderColor: 'rgba(0,0,0,0.06)' };

// Um bloco como balão de mensagem ENVIADA: texto/mídia, enquete ou contato.
export function BlocoBalao({ bloco, seed = 0, maxMidia = 200 }) {
  // Enquete
  if (bloco.tipo === 'enquete') {
    return (
      <Paper radius="md" p="xs" withBorder style={balaoStyle}>
        <Group gap={6} mb={6} wrap="nowrap">
          <ThemeIcon variant="light" color="whatsapp.8" size="sm"><IconChartBar size={14} /></ThemeIcon>
          <Text size="xs" c="dimmed">Enquete{bloco.multiplas ? ' · várias respostas' : ''}</Text>
        </Group>
        <Text size="sm" fw={600} mb={6}>{bloco.pergunta}</Text>
        <Stack gap={4}>
          {(bloco.opcoes || []).map((o, i) => (
            <Paper key={i} withBorder p={6} radius="sm" style={{ background: 'rgba(255,255,255,0.6)' }}>
              <Group gap={8} wrap="nowrap">
                <span style={{ width: 14, height: 14, flexShrink: 0, borderRadius: bloco.multiplas ? 3 : '50%', border: '2px solid var(--mantine-color-gray-4)' }} />
                <Text size="sm">{o}</Text>
              </Group>
            </Paper>
          ))}
        </Stack>
      </Paper>
    );
  }
  // Contato
  if (bloco.tipo === 'contato') {
    return (
      <Paper radius="md" p="xs" withBorder style={balaoStyle}>
        <Group gap={8} wrap="nowrap">
          <Avatar radius="xl" color="whatsapp.8">{iniciais(bloco.nome) || <IconUser size={18} />}</Avatar>
          <Stack gap={0} style={{ minWidth: 0 }}>
            <Text size="sm" fw={500} lineClamp={1}>{bloco.nome}</Text>
            <Text size="xs" c="dimmed">+{bloco.numero}</Text>
          </Stack>
        </Group>
      </Paper>
    );
  }

  const texto = hasSpintax(bloco.conteudo) ? spin(bloco.conteudo, seed) : bloco.conteudo;
  const lp = bloco.linkPreview;
  const mostrarLink = lp && bloco.usarPreviewLink !== false && !bloco.midia;

  let midiaEl = null;
  if (bloco.midia) {
    if (bloco.midiaTipo === 'video' || (bloco.midiaTipo === 'gif' && !ehArquivoGif(bloco.midia, bloco.midiaNome))) {
      midiaEl = <video src={bloco.midia} controls playsInline style={{ width: '100%', maxHeight: maxMidia, borderRadius: 8, marginBottom: 6 }} />;
    } else if (bloco.midiaTipo === 'audio') {
      midiaEl = <audio src={bloco.midia} controls style={{ width: '100%', marginBottom: 6 }} />;
    } else if (ehImagemBloco(bloco)) {
      midiaEl = <Image src={bloco.midia} radius="sm" mb={6} fit="contain" mah={maxMidia} fallbackSrc="" alt="" />;
    } else {
      midiaEl = (
        <Group gap="xs" wrap="nowrap" mb={6}>
          <ThemeIcon variant="light" color="whatsapp.8" size="lg"><IconFile size={18} /></ThemeIcon>
          <Text size="xs" c="dimmed" lineClamp={1}>{bloco.midiaNome || bloco.midia}</Text>
        </Group>
      );
    }
  }

  return (
    <Paper radius="md" p="xs" withBorder style={{ background: COR_ENVIADA, borderColor: 'rgba(0,0,0,0.06)' }}>
      {midiaEl}
      {mostrarLink && (
        <Paper radius="sm" mb={6} withBorder style={{ overflow: 'hidden', background: 'rgba(255,255,255,0.6)' }}>
          {lp.image && <Image src={lp.image} mah={130} fit="cover" alt="" />}
          <Stack gap={2} p={8}>
            <Text size="sm" fw={500} lineClamp={2}>{lp.title || lp.url}</Text>
            {lp.description && <Text size="xs" c="dimmed" lineClamp={2}>{lp.description}</Text>}
            <Text size="xs" c="dimmed">{hostDe(lp.url)}</Text>
          </Stack>
        </Paper>
      )}
      {texto && <Text size="sm" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{renderWhatsApp(texto)}</Text>}
    </Paper>
  );
}

// Uma linha de mensagem enviada: balão alinhado à DIREITA, com largura limitada (como no celular).
// `menu` é um nó opcional (ações de edição) renderizado à esquerda do balão.
export function LinhaBalao({ bloco, seed = 0, maxMidia = 200, menu = null }) {
  return (
    <Group justify="flex-end" align="flex-start" wrap="nowrap" gap={4} w="100%">
      {/* O menu fica "grudado" no topo enquanto o bloco rola: continua visível do início ao
          fim do próprio balão, e o balão seguinte traz o seu. */}
      {menu && (
        <div style={{ position: 'sticky', top: 4, alignSelf: 'flex-start', zIndex: 2 }}>{menu}</div>
      )}
      <div style={{ maxWidth: '82%', minWidth: 0 }}>
        <BlocoBalao bloco={bloco} seed={seed} maxMidia={maxMidia} />
      </div>
    </Group>
  );
}

// Pré-visualização (somente leitura) com cara de conversa do WhatsApp: o botão "Pré-visualizar
// variação" fica FIXO acima (fora do scroll) e a lista de balões rola por dentro.
export function BlocosPreview({ blocos, mah = 300 }) {
  const [seed, setSeed] = useState(0);
  const temSpintax = blocos.some((b) => hasSpintax(b.conteudo));
  return (
    <Stack gap={6}>
      {temSpintax && (
        <Button size="xs" variant="light" leftSection={<IconWand size={14} />} onClick={() => setSeed((s) => s + 1)} style={{ alignSelf: 'flex-start' }}>
          Pré-visualizar variação
        </Button>
      )}
      <Paper radius="md" p="sm" style={{ background: WALLPAPER }}>
        <ScrollArea.Autosize mah={mah}>
          <Stack gap="xs">
            {blocos.map((b, i) => <LinhaBalao key={i} bloco={b} seed={seed} maxMidia={160} />)}
          </Stack>
        </ScrollArea.Autosize>
      </Paper>
    </Stack>
  );
}
