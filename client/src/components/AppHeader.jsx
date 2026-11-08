import { Box, Group, Text, TextInput, Avatar, Menu, Burger, Drawer, Stack } from '@mantine/core';
import { NavLink, useLocation } from 'react-router-dom';
import { useDisclosure } from '@mantine/hooks';
import { IconBrandWhatsapp, IconSearch, IconLogout } from '@tabler/icons-react';
import { useAuth } from '../auth/AuthContext';

const links = [
  { to: '/contas', label: 'Contas' },
  { to: '/campanhas', label: 'Campanhas' },
  { to: '/anti-spam', label: 'Anti-spam' },
  { to: '/tutorial', label: 'Tutorial' },
];

function isActive(to, pathname) {
  return to === '/' ? pathname === '/' : pathname.startsWith(to);
}

export default function AppHeader() {
  const { pathname } = useLocation();
  const { logout } = useAuth();
  const [drawerOpen, { open: openDrawer, close: closeDrawer }] = useDisclosure(false);

  return (
    // A barra verde ocupa 100% da largura; o conteúdo do header fica centralizado em 1400px.
    <Box h="100%" bg="whatsapp.8">
      <Group h="100%" px="md" justify="space-between" wrap="nowrap" maw={1400} mx="auto">
      <Group gap="lg" wrap="nowrap">
        <Burger
          opened={drawerOpen}
          onClick={openDrawer}
          color="white"
          size="sm"
          hiddenFrom="xs"
          aria-label="Abrir menu"
        />
        <Group
          gap={8}
          c="white"
          wrap="nowrap"
          component={NavLink}
          to="/"
          style={{ textDecoration: 'none', opacity: pathname === '/' ? 1 : 0.92 }}
        >
          <IconBrandWhatsapp size={22} />
          <Text fw={500} size="lg">SendMídia</Text>
        </Group>
        <Group gap={4} wrap="nowrap" visibleFrom="xs">
          {links.map((l) => {
            const active = isActive(l.to, pathname);
            return (
              <Text
                key={l.to}
                component={NavLink}
                to={l.to}
                c="white"
                size="sm"
                style={{
                  padding: '6px 10px',
                  textDecoration: 'none',
                  opacity: active ? 1 : 0.78,
                  borderBottom: active ? '2px solid white' : '2px solid transparent',
                }}
              >
                {l.label}
              </Text>
            );
          })}
        </Group>
      </Group>
      <Group gap="sm" wrap="nowrap">
        <TextInput
          size="xs"
          placeholder="Buscar"
          leftSection={<IconSearch size={14} />}
          visibleFrom="sm"
        />
        <Menu position="bottom-end" shadow="sm">
          <Menu.Target>
            <Avatar color="whatsapp.2" radius="xl" size={30} style={{ cursor: 'pointer' }}>AP</Avatar>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item leftSection={<IconLogout size={16} />} onClick={logout}>
              Sair
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </Group>

      {/* Menu de navegação no celular (o header esconde os itens abaixo de xs) */}
      <Drawer
        opened={drawerOpen}
        onClose={closeDrawer}
        size="75%"
        hiddenFrom="xs"
        title={
          <Group gap={8} c="whatsapp.8" component={NavLink} to="/" onClick={closeDrawer} style={{ textDecoration: 'none' }}>
            <IconBrandWhatsapp size={20} />
            <Text fw={600}>SendMídia</Text>
          </Group>
        }
      >
        <Stack gap={4}>
          {links.map((l) => {
            const active = isActive(l.to, pathname);
            return (
              <Text
                key={l.to}
                component={NavLink}
                to={l.to}
                onClick={closeDrawer}
                fw={active ? 600 : 400}
                c={active ? 'whatsapp.8' : 'dark'}
                style={{
                  padding: '12px 14px',
                  borderRadius: 8,
                  textDecoration: 'none',
                  background: active ? 'var(--mantine-color-whatsapp-0)' : 'transparent',
                }}
              >
                {l.label}
              </Text>
            );
          })}
        </Stack>
      </Drawer>
      </Group>
    </Box>
  );
}
