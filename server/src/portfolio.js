// Esta distribuição demonstra o código sem conectar contas ou executar envios.
export const EXTERNAL_INTEGRATIONS_ENABLED = false;
export function requireExternalIntegration() {
  if (!EXTERNAL_INTEGRATIONS_ENABLED) {
    const error = new Error('Integracoes externas desativadas na demonstracao.');
    error.code = 'portfolio_mode';
    throw error;
  }
}
