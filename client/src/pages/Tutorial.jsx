import { useMemo } from 'react';
import { useParams, Navigate, NavLink as RouterNavLink } from 'react-router-dom';
import { Box, Stack, Text, Group, ScrollArea } from '@mantine/core';
import { IconBook2 } from '@tabler/icons-react';
import { tutorialArticles } from '../data/tutorialArticles';

// Agrupa os artigos por categoria, preservando a ordem em que aparecem em tutorialArticles
// (é essa ordem que decide a posição na barra lateral).
function agruparPorCategoria(artigos) {
  const grupos = [];
  for (const artigo of artigos) {
    let grupo = grupos.find((g) => g.categoria === artigo.categoria);
    if (!grupo) {
      grupo = { categoria: artigo.categoria, artigos: [] };
      grupos.push(grupo);
    }
    grupo.artigos.push(artigo);
  }
  return grupos;
}

// Páginas de ajuda do sistema (Tutorial): layout clássico de documentação, com índice na
// barra lateral e conteúdo centrado. Para adicionar uma página nova, edite
// client/src/data/tutorialArticles.jsx — esta tela só monta o índice e a navegação.
export default function Tutorial() {
  const { slug } = useParams();
  const grupos = useMemo(() => agruparPorCategoria(tutorialArticles), []);

  if (!slug) {
    const primeiro = tutorialArticles[0];
    if (!primeiro) return null;
    return <Navigate to={`/tutorial/${primeiro.slug}`} replace />;
  }

  const artigo = tutorialArticles.find((a) => a.slug === slug);

  return (
    <Box maw={1200} mx="auto">
      <Group align="flex-start" gap="xl" wrap="wrap">
        {/* Índice (barra lateral) */}
        <Box w={260} flex="0 0 260px" visibleFrom="sm">
          <Group gap={6} mb="sm" c="whatsapp.8">
            <IconBook2 size={18} />
            <Text fw={600} size="sm">Tutorial</Text>
          </Group>
          <ScrollArea.Autosize mah="calc(100vh - 140px)" type="auto">
            <Stack gap="md">
              {grupos.map((grupo) => (
                <Stack key={grupo.categoria} gap={2}>
                  <Text size="xs" fw={600} c="dimmed" tt="uppercase">{grupo.categoria}</Text>
                  <Stack gap={0}>
                    {grupo.artigos.map((a) => (
                      <Text
                        key={a.slug}
                        component={RouterNavLink}
                        to={`/tutorial/${a.slug}`}
                        size="sm"
                        py={6}
                        px={8}
                        style={({ isActive }) => ({
                          textDecoration: 'none',
                          borderRadius: 6,
                          color: isActive ? 'var(--mantine-color-whatsapp-9)' : 'var(--mantine-color-gray-7)',
                          background: isActive ? 'var(--mantine-color-whatsapp-0)' : 'transparent',
                          fontWeight: isActive ? 600 : 400,
                        })}
                      >
                        {a.titulo}
                      </Text>
                    ))}
                  </Stack>
                </Stack>
              ))}
            </Stack>
          </ScrollArea.Autosize>
        </Box>

        {/* Conteúdo */}
        <Box flex="1 1 480px" miw={280} pb="xl">
          {artigo ? (
            <artigo.Conteudo />
          ) : (
            <Text c="dimmed">Página não encontrada. Escolha um tópico na barra lateral.</Text>
          )}
        </Box>
      </Group>
    </Box>
  );
}
