import { useState } from 'react';
import { Anchor, Button, Card, Center, Group, PasswordInput, Stack, Text, Title } from '@mantine/core';
import { IconBrandWhatsapp } from '@tabler/icons-react';
import { useAuth } from '../auth/AuthContext';

export default function Login() {
  const { login } = useAuth();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await login(password);
    } catch (err) {
      setError(err.message || 'Não foi possível entrar.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Center h="100vh" bg="gray.0">
      <Card withBorder padding="xl" radius="md" w={360}>
        <Stack gap="md">
          <Group gap={8} c="whatsapp.8">
            <IconBrandWhatsapp size={26} />
            <Title order={3}>SendMídia</Title>
          </Group>
          <Text c="dimmed" size="sm">Entre com a senha de acesso para continuar.</Text>
          <form onSubmit={handleSubmit}>
            <Stack gap="sm">
              <PasswordInput
                label="Senha"
                placeholder="Sua senha de acesso"
                value={password}
                onChange={(event) => setPassword(event.currentTarget.value)}
                error={error || undefined}
                autoFocus
                required
              />
              <Button type="submit" loading={submitting} fullWidth>
                Entrar
              </Button>
            </Stack>
          </form>
          <Anchor c="dimmed" size="xs" underline="never">Sendmidia Portfolio</Anchor>
        </Stack>
      </Card>
    </Center>
  );
}
