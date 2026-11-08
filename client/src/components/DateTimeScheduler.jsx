import { useEffect, useRef, useState } from 'react';
import {
  Popover,
  Input,
  ScrollArea,
  Stack,
  Group,
  Button,
  UnstyledButton,
  Text,
  Divider,
} from '@mantine/core';
import { DatePicker } from '@mantine/dates';
import { IconClock } from '@tabler/icons-react';

const HOURS = Array.from({ length: 24 }, (_, i) => i);
// Minutos em passos de 5 — força o agendamento em granularidade de 5 minutos.
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);

const pad = (n) => String(n).padStart(2, '0');
const fmt = (d) => (d ? `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}` : '');

// Arredonda para o próximo múltiplo de 5 minutos (futuro).
function roundUp5(date) {
  const d = new Date(date);
  d.setSeconds(0, 0);
  const r = Math.ceil(d.getMinutes() / 5) * 5;
  if (r === 60) {
    d.setHours(d.getHours() + 1);
    d.setMinutes(0);
  } else {
    d.setMinutes(r);
  }
  return d;
}

// Seletor de data/hora estilo "wheel" (calendário + colunas roláveis de hora e
// minuto), no tema claro da identidade. Minuto só em passos de 5 min.
export default function DateTimeScheduler({ value, onChange, minDate, placeholder = 'Escolha data e hora' }) {
  const [opened, setOpened] = useState(false);
  const [day, setDay] = useState(null);
  const [hour, setHour] = useState(0);
  const [minute, setMinute] = useState(0);
  const hourRef = useRef(null);
  const minRef = useRef(null);

  useEffect(() => {
    if (!opened) return;
    const base = value ? new Date(value) : roundUp5(new Date());
    setDay(base);
    setHour(base.getHours());
    setMinute(Math.round(base.getMinutes() / 5) * 5 % 60);
    setTimeout(() => {
      hourRef.current?.scrollIntoView({ block: 'center' });
      minRef.current?.scrollIntoView({ block: 'center' });
    }, 60);
  }, [opened, value]);

  function confirm() {
    const d = day ? new Date(day) : new Date();
    d.setHours(hour, minute, 0, 0);
    onChange(d);
    setOpened(false);
  }

  const optStyle = (active) => ({
    padding: '6px 0',
    borderRadius: 8,
    width: 48,
    textAlign: 'center',
    fontSize: 14,
    background: active ? 'var(--mantine-color-whatsapp-8)' : 'transparent',
    color: active ? 'white' : 'var(--mantine-color-gray-7)',
    fontWeight: active ? 600 : 400,
  });

  function Column({ items, selected, onPick, selRef, label }) {
    return (
      <Stack gap={4} align="center">
        <Text size="xs" c="dimmed">{label}</Text>
        <ScrollArea h={210} w={56} type="auto" offsetScrollbars>
          <Stack gap={2} align="center">
            {items.map((v) => (
              <UnstyledButton key={v} ref={v === selected ? selRef : undefined} style={optStyle(v === selected)} onClick={() => onPick(v)}>
                {pad(v)}
              </UnstyledButton>
            ))}
          </Stack>
        </ScrollArea>
      </Stack>
    );
  }

  return (
    <Popover opened={opened} onChange={setOpened} position="bottom-start" withinPortal shadow="md" radius="md">
      <Popover.Target>
        <Input
          component="button"
          type="button"
          pointer
          rightSection={<IconClock size={16} />}
          onClick={() => setOpened((o) => !o)}
        >
          {value ? fmt(value) : <Input.Placeholder>{placeholder}</Input.Placeholder>}
        </Input>
      </Popover.Target>
      <Popover.Dropdown p="sm">
        <Group align="flex-start" gap="sm" wrap="nowrap">
          <DatePicker value={day} onChange={setDay} minDate={minDate} size="sm" />
          <Divider orientation="vertical" />
          <Group gap="xs" wrap="nowrap">
            <Column items={HOURS} selected={hour} onPick={setHour} selRef={hourRef} label="Hora" />
            <Column items={MINUTES} selected={minute} onPick={setMinute} selRef={minRef} label="Min" />
          </Group>
        </Group>
        <Group justify="space-between" mt="sm">
          <Text size="xs" c="dimmed">Intervalos de 5 minutos</Text>
          <Button size="xs" onClick={confirm} disabled={!day}>OK</Button>
        </Group>
      </Popover.Dropdown>
    </Popover>
  );
}
