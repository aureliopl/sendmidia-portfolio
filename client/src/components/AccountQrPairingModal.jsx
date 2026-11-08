import { useEffect, useState } from 'react';
import {
  Modal,
  Stack,
  Group,
  Image,
  Text,
  Badge,
  Button,
  List,
  ThemeIcon,
  CopyButton,
  ActionIcon,
  Tooltip,
  Center,
  Loader,
  Divider,
} from '@mantine/core';
import { IconCheck, IconCopy, IconAlertTriangle, IconNumber1Small, IconNumber2Small, IconNumber3Small, IconNumber4Small } from '@tabler/icons-react';
import { socket } from '../lib/socket';

const STEPS = [
  { icon: IconNumber1Small, text: 'Abra o WhatsApp no celular.' },
  { icon: IconNumber2Small, text: 'Toque em Mais opções (Android) ou Configurações (iPhone).' },
  { icon: IconNumber3Small, text: 'Toque em Dispositivos conectados → Conectar um dispositivo.' },
  { icon: IconNumber4Small, text: 'Aponte a câmera do celular para a tela e capture o QR Code.' },
];

// Fluxo de pareamento (Tela 2 do fluxo-de-trabalho.md): Iniciar Sessão → QR Code →
// Aguardando leitura → Conectado. Recebe os eventos em tempo real via Socket.IO
// (emitidos por server/src/whatsapp/manager.js).
// Tempo (ms) que o modal espera parado em "Iniciando sessão..." antes de assumir que a conta é
// pareada e está com dificuldade para conectar (nunca vai gerar QR). Rede de segurança para o caso
// de o evento de recusa demorar a chegar; o servidor normalmente avisa antes disto.
const STALL_TIMEOUT_MS = 25000;

export default function AccountQrPairingModal({ accountId, accountName, opened, onClose }) {
  const [stage, setStage] = useState('starting'); // starting | qr | connecting | connected | error | retrying
  const [qr, setQr] = useState(null);
  const [qrRaw, setQrRaw] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [failStatusCode, setFailStatusCode] = useState(null);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    if (!opened || !accountId) return;
    setStage('starting');
    setQr(null);
    setQrRaw(null);
    setAttempt(0);
    setFailStatusCode(null);

    function onPairing(data) {
      if (data.accountId !== accountId) return;
      if (data.stage === 'qr') {
        setQr(data.qr);
        setQrRaw(data.qrRaw);
        setAttempt(data.attempt);
        setStage('qr');
      } else if (data.stage === 'connecting') {
        // Só é "aguardando confirmação" se já tínhamos mostrado um QR antes —
        // a mesma fase também ocorre antes do primeiro QR ser gerado.
        setStage((prev) => (prev === 'qr' ? 'connecting' : prev));
      } else if (data.stage === 'connected') {
        setStage('connected');
      } else if (data.stage === 'retrying') {
        // Conta pareada que não conseguiu subir a conexão (o WhatsApp recusou/derrubou). Ela nunca
        // vai gerar QR, então mostramos o motivo em vez de deixar o modal preso "Iniciando sessão...".
        // Se um QR estiver visível (conta ainda em pareamento), não atrapalha o fluxo do QR.
        setFailStatusCode(typeof data.statusCode === 'number' ? data.statusCode : null);
        setStage((prev) => (prev === 'starting' || prev === 'connecting' || prev === 'retrying' ? 'retrying' : prev));
      }
    }

    // Ouve o socket ANTES de iniciar a sessão, para não perder o primeiro QR.
    socket.on('account:pairing', onPairing);

    // Rede de segurança: se ficar parado em "Iniciando sessão..." além do tempo limite (sem QR,
    // sem conexão e sem aviso do servidor), assume que é conta pareada com dificuldade de conectar.
    const stallTimer = setTimeout(() => {
      setStage((prev) => (prev === 'starting' ? 'retrying' : prev));
    }, STALL_TIMEOUT_MS);

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/accounts/${accountId}/session/start`, { method: 'POST' });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || 'falha');
      } catch {
        if (!cancelled) setStage('error');
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(stallTimer);
      socket.off('account:pairing', onPairing);
    };
  }, [opened, accountId, retryNonce]);

  return (
    <Modal opened={opened} onClose={onClose} title={`Conectar conta${accountName ? `: ${accountName}` : ''}`} centered size="lg">
      {stage === 'starting' && (
        <Center py="xl">
          <Stack align="center" gap="xs">
            <Loader color="whatsapp.8" />
            <Text c="dimmed" size="sm">Iniciando sessão...</Text>
          </Stack>
        </Center>
      )}

      {stage === 'error' && (
        <Center py="xl">
          <Stack align="center" gap="xs">
            <ThemeIcon color="red" radius="xl" size={48} variant="light">
              <IconAlertTriangle size={28} />
            </ThemeIcon>
            <Text size="sm">Não foi possível iniciar a sessão.</Text>
            <Button mt="sm" onClick={() => setRetryNonce((n) => n + 1)}>Tentar novamente</Button>
          </Stack>
        </Center>
      )}

      {stage === 'retrying' && (
        <Center py="xl">
          <Stack align="center" gap="xs" maw={420}>
            <ThemeIcon color="orange" radius="xl" size={48} variant="light">
              <IconAlertTriangle size={28} />
            </ThemeIcon>
            <Text size="sm" fw={500} ta="center">Não foi possível conectar esta conta agora.</Text>
            {failStatusCode != null && (
              <Text c="dimmed" size="xs" ta="center">O WhatsApp recusou a conexão (código {failStatusCode}).</Text>
            )}
            <Text c="dimmed" size="sm" ta="center">
              A conta continua tentando reconectar sozinha em segundo plano. Se não voltar, finalize a
              sessão desta conta e leia um novo QR Code.
            </Text>
            <Group mt="sm" gap="sm">
              <Button variant="default" onClick={() => setRetryNonce((n) => n + 1)}>Tentar novamente</Button>
              <Button onClick={onClose}>Fechar</Button>
            </Group>
          </Stack>
        </Center>
      )}

      {stage === 'connecting' && (
        <Center py="xl">
          <Stack align="center" gap="xs">
            <Loader color="yellow.6" />
            <Badge color="yellow" variant="dot">Aguardando leitura do QrCode...</Badge>
            <Text c="dimmed" size="sm">Confirme o pareamento no celular.</Text>
          </Stack>
        </Center>
      )}

      {stage === 'connected' && (
        <Center py="xl">
          <Stack align="center" gap="xs">
            <ThemeIcon color="whatsapp.8" radius="xl" size={48}>
              <IconCheck size={28} />
            </ThemeIcon>
            <Badge color="whatsapp.8" variant="dot">Conectado</Badge>
            <Text size="sm">A conta está pronta para uso.</Text>
            <Button mt="sm" onClick={onClose}>Concluir</Button>
          </Stack>
        </Center>
      )}

      {stage === 'qr' && (
        <Group align="flex-start" gap="xl" wrap="wrap">
          <Stack gap="sm" style={{ flex: 1, minWidth: 220 }}>
            <Text fw={500} size="sm">Passo a passo</Text>
            <List spacing="xs" size="sm">
              {STEPS.map((step) => (
                <List.Item key={step.text} icon={<ThemeIcon size={20} radius="xl" color="whatsapp.8"><step.icon size={14} /></ThemeIcon>}>
                  {step.text}
                </List.Item>
              ))}
            </List>
            <Divider my="xs" />
            <Text fw={500} size="sm">Código de pareamento</Text>
            <Group gap="xs" wrap="nowrap">
              <Text size="xs" c="dimmed" truncate style={{ maxWidth: 220 }}>{qrRaw}</Text>
              <CopyButton value={qrRaw || ''} timeout={1500}>
                {({ copied, copy }) => (
                  <Tooltip label={copied ? 'Copiado!' : 'Copiar código'} withArrow>
                    <ActionIcon color={copied ? 'whatsapp.8' : 'gray'} onClick={copy} variant="light">
                      {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                    </ActionIcon>
                  </Tooltip>
                )}
              </CopyButton>
            </Group>
            <Text c="dimmed" size="xs">
              Dificuldades para ler o QR Code? Espere o código atual expirar antes de pedir um novo
              e, se persistir, finalize a sessão e tente de novo.
            </Text>
          </Stack>
          <Stack align="center" gap="xs">
            <Image src={qr} alt="QR Code de pareamento" w={240} h={240} fit="contain" />
            <Badge variant="light" color="gray">Código QR {attempt}</Badge>
            <Text c="dimmed" size="xs" ta="center" maw={240}>
              O número de WhatsApp é identificado automaticamente após a leitura, não
              é preciso informá-lo.
            </Text>
          </Stack>
        </Group>
      )}
    </Modal>
  );
}
