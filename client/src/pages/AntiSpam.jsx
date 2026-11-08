import { Stack, Title, Text, Tabs, Center } from '@mantine/core';
import AdminNumbersTab from '../components/AdminNumbersTab';

// Área Anti-spam (nível de sistema, ao lado de Contas e Campanhas). Espelha o SendFlow:
// abas Números administrativos, Números bloqueados e Contas associadas. Por ora só a aba
// de administrativos é funcional (foco: omitir esses números na remoção de duplicados).
function Esqueleto({ titulo, descricao }) {
  return (
    <Center py="xl">
      <Stack align="center" gap={4} maw={520} ta="center">
        <Text fw={500}>{titulo}</Text>
        <Text c="dimmed" size="sm">{descricao}</Text>
      </Stack>
    </Center>
  );
}

export default function AntiSpam() {
  return (
    <Stack gap="md">
      <div>
        <Title order={2}>Anti-spam</Title>
        <Text c="dimmed" size="sm">
          Números válidos para todo o sistema, independentes de contas e campanhas.
        </Text>
      </div>
      <Tabs defaultValue="administrativos" keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="administrativos">Números administrativos</Tabs.Tab>
          <Tabs.Tab value="bloqueados">Números bloqueados</Tabs.Tab>
          <Tabs.Tab value="contas">Contas associadas</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="administrativos" pt="md">
          <AdminNumbersTab />
        </Tabs.Panel>
        <Tabs.Panel value="bloqueados" pt="md">
          <Esqueleto
            titulo="Números bloqueados"
            descricao="Cadastro de números bloqueados para todo o sistema."
          />
        </Tabs.Panel>
        <Tabs.Panel value="contas" pt="md">
          <Esqueleto
            titulo="Contas associadas"
            descricao="Restrinja quais contas podem executar ações de anti-spam."
          />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
