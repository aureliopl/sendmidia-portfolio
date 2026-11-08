import { Title, Text, List, Stack, Alert, Code, Anchor } from '@mantine/core';
import { IconAlertTriangle, IconInfoCircle } from '@tabler/icons-react';
import { Link } from 'react-router-dom';

// Conteúdo das páginas de ajuda (Tutorial). Cada artigo tem uma categoria (vira o grupo na
// barra lateral), um slug (vira a URL /tutorial/:slug) e um Conteudo (componente React).
// Para adicionar um novo artigo, é só incluir um objeto novo nesta lista.
export const tutorialArticles = [
  {
    slug: 'salvar-administrativos-na-agenda',
    categoria: 'Anti-banimento',
    titulo: 'Salvar os números administrativos na agenda de cada conta',
    resumo: 'Por que e como deixar todas as contas com os números da equipe salvos no celular.',
    Conteudo: () => (
      <Stack gap="md">
        <Title order={2}>Salvar os números administrativos na agenda de cada conta</Title>

        <Text>
          Cada conta de WhatsApp conectada na plataforma está ligada a um número e a um aparelho.
          Quando essa conta interage com um número que <b>não está salvo na sua agenda</b>, o
          WhatsApp trata essa interação como mais arriscada. Isso é especialmente importante na
          hora de <b>promover administradores</b> nos grupos.
        </Text>

        <Title order={3}>Por que isso importa</Title>
        <Text>
          A plataforma só consegue <b>promover a administrador</b> um número que já participa do
          grupo. Ela não adiciona ninguém automaticamente, porque adicionar pessoas a grupos é uma
          das ações que o WhatsApp mais associa a spam, e isso pode levar a conta a ser desconectada
          ou até banida.
        </Text>
        <Text>
          Além disso, a plataforma também não consegue gravar contatos na agenda do celular: o
          WhatsApp não permite isso por API. Quem cadastra um número como "administrativo" aqui
          dentro está só guardando essa informação no sistema, não na agenda de nenhum aparelho.
        </Text>
        <Text>
          Por isso, o caminho mais seguro é garantir, manualmente e de uma vez, que <b>todos os
          números da equipe estejam salvos na agenda de todos os celulares</b> que têm uma conta
          conectada na plataforma. Números conhecidos reduzem o risco de qualquer ação
          administrativa e evitam o erro comum de esquecer de salvar um número numa das contas.
        </Text>

        <Alert variant="light" color="orange" icon={<IconAlertTriangle size={16} />}>
          Mesmo com os números salvos, evite adicionar pessoas a grupos em massa. O caminho mais
          seguro para um novo administrador é ele <b>entrar pelo link de convite do grupo</b> e só
          depois ser promovido.
        </Alert>

        <Title order={3}>Passo a passo</Title>
        <List type="ordered" spacing="sm">
          <List.Item>
            Cadastre todos os números da equipe (incluindo os números das próprias contas, se
            quiser deixá-los visíveis) em{' '}
            <Anchor component={Link} to="/anti-spam">Anti-spam → Números administrativos</Anchor>.
            Pode usar o cadastro manual ou colar uma lista no formato "nome, número".
          </List.Item>
          <List.Item>
            Na mesma tela, clique em <b>"Exportar contatos (.vcf)"</b>. Isso baixa um arquivo com
            todos os números cadastrados, no formato padrão de contatos (vCard).
          </List.Item>
          <List.Item>
            Envie esse arquivo <Code>.vcf</Code> para cada celular que tem uma conta conectada na
            plataforma (por e-mail, Google Drive, WhatsApp para si mesmo ou qualquer outro meio).
          </List.Item>
          <List.Item>
            Abra o arquivo <Code>.vcf</Code> em cada celular e importe os contatos na agenda do
            aparelho. O sistema do celular pode pedir para confirmar a importação de vários
            contatos de uma vez, basta confirmar.
          </List.Item>
          <List.Item>
            Repita a importação sempre que cadastrar um número administrativo novo em Anti-spam.
          </List.Item>
        </List>

        <Title order={3}>Como importar o arquivo .vcf</Title>
        <Text fw={500}>No Android:</Text>
        <List spacing={4}>
          <List.Item>Abra o arquivo <Code>.vcf</Code> baixado (pelo Drive, e-mail ou Arquivos).</List.Item>
          <List.Item>O Android abre o app Contatos automaticamente e pergunta onde salvar (conta do Google, por exemplo).</List.Item>
          <List.Item>Confirme a importação de todos os contatos do arquivo.</List.Item>
        </List>
        <Text fw={500}>No iPhone:</Text>
        <List spacing={4}>
          <List.Item>Abra o arquivo <Code>.vcf</Code> (pelo Arquivos, Mail ou outro app).</List.Item>
          <List.Item>Toque em "Adicionar todos os contatos" quando o app Contatos abrir.</List.Item>
        </List>

        <Alert variant="light" color="gray" icon={<IconInfoCircle size={16} />}>
          O resultado esperado: ao abrir qualquer conversa ou grupo numa das contas, os números da
          equipe aparecem com nome (e não só o número cru). Isso é o sinal de que a importação
          funcionou naquele aparelho.
        </Alert>
      </Stack>
    ),
  },
];
