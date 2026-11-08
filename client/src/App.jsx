import { Routes, Route, Navigate } from 'react-router-dom';
import { AppShell, Center, Loader } from '@mantine/core';
import AppHeader from './components/AppHeader';
import Home from './pages/Home';
import Accounts from './pages/Accounts';
import AccountDetail from './pages/AccountDetail';
import Campaigns from './pages/Campaigns';
import CampaignDetail from './pages/CampaignDetail';
import AntiSpam from './pages/AntiSpam';
import Tutorial from './pages/Tutorial';
import Login from './pages/Login';
import { useAuth } from './auth/AuthContext';

const appVersion = import.meta.env.VITE_APP_VERSION || '0.1.0';
const appCommit = import.meta.env.VITE_APP_COMMIT || '';
const buildLabel = appCommit ? `v.${appVersion} ${appCommit}` : `v.${appVersion}`;

function VersionFooter() {
  return (
    <footer
      aria-label={`Versão ${appVersion}${appCommit ? `, deploy ${appCommit}` : ''}`}
      style={{
        color: '#B8BDC4',
        fontSize: 9,
        lineHeight: 1,
        padding: '0 5px 5px 0',
        textAlign: 'right',
        width: '100%',
        flexShrink: 0,
      }}
    >
      {buildLabel}
    </footer>
  );
}

function AppFrame({ children }) {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          flex: 1,
          minHeight: 0,
        }}
      >
        {children}
      </div>
      <VersionFooter />
    </div>
  );
}

function AuthenticatedFrame() {
  return (
    <AppFrame>
      <AppShell
        header={{ height: 56 }}
        padding="md"
        styles={{
          root: {
            minHeight: '100%',
          },
          main: {
            minHeight: 'calc(100vh - 56px - 14px)',
          },
        }}
      >
        <AppShell.Header>
          <AppHeader />
        </AppShell.Header>
        <AppShell.Main>
          {/* O fundo ocupa 100% da largura; o conteúdo das páginas fica centralizado em 1400px. */}
          <div style={{ maxWidth: 1400, marginInline: 'auto', width: '100%' }}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/contas" element={<Accounts />} />
            <Route path="/contas/:id" element={<AccountDetail />} />
            <Route path="/campanhas" element={<Campaigns />} />
            <Route path="/campanhas/:id" element={<CampaignDetail />} />
            <Route path="/campanhas/:id/:aba" element={<CampaignDetail />} />
            <Route path="/anti-spam" element={<AntiSpam />} />
            <Route path="/tutorial" element={<Tutorial />} />
            <Route path="/tutorial/:slug" element={<Tutorial />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </div>
        </AppShell.Main>
      </AppShell>
    </AppFrame>
  );
}

function LoadingFrame() {
  return (
    <AppFrame>
      <Center
        style={{
          minHeight: 'calc(100vh - 14px)',
        }}
      >
        <Loader color="whatsapp.8" />
      </Center>
    </AppFrame>
  );
}

function LoginFrame() {
  return (
    <AppFrame>
      <div
        style={{
          minHeight: 'calc(100vh - 14px)',
        }}
      >
        <Login />
      </div>
    </AppFrame>
  );
}

export default function App() {
  const { authenticated, loading } = useAuth();

  if (loading) {
    return <LoadingFrame />;
  }

  if (!authenticated) {
    return <LoginFrame />;
  }

  return <AuthenticatedFrame />;
}
