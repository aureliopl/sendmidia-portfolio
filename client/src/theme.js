import { createTheme } from '@mantine/core';

// Paleta do WhatsApp Web (verde-teal). primaryShade 8 = #0f6e56 (header/primário).
export const theme = createTheme({
  primaryColor: 'whatsapp',
  primaryShade: 8,
  colors: {
    whatsapp: [
      '#e6f5ef',
      '#c8eadd',
      '#a6dcc8',
      '#82ceb2',
      '#64c2a0',
      '#50bb95',
      '#46b78e',
      '#1d9e75',
      '#0f6e56',
      '#0a5743',
    ],
  },
  fontFamily:
    'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  defaultRadius: 'md',
  // Texto de elementos "filled" (ex.: badges) escolhe automaticamente claro/escuro conforme
  // o fundo — garante contraste legível em badges amarelos/claros sem fixar a cor do texto.
  autoContrast: true,
});
