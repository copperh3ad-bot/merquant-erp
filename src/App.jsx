import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import { pagesConfig } from './pages.config';
import LoginPage from './pages/LoginPage';
import PageErrorBoundary from '@/components/shared/PageErrorBoundary';

const { Pages, Layout, mainPage } = pagesConfig;
const mainPageKey = mainPage ?? Object.keys(Pages)[0];
const MainPage = Pages[mainPageKey];

const LayoutWrapper = ({ children, currentPageName }) =>
  Layout ? <Layout currentPageName={currentPageName}>{children}</Layout> : <>{children}</>;

function LoadingScreen() {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" />
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    </div>
  );
}

function AuthGate() {
  const { session, isLoading, canSeePage } = useAuth();

  if (isLoading) return <LoadingScreen />;
  if (!session) return <LoginPage />;

  const RouteGuard = ({ pageName, children }) => {
    if (!canSeePage(pageName)) {
      return (
        <LayoutWrapper currentPageName={pageName}>
          <div className="flex flex-col items-center justify-center py-24">
            <p className="text-2xl font-bold text-foreground mb-2">Access Restricted</p>
            <p className="text-muted-foreground">Your role does not have permission to view this page.</p>
            <p className="text-xs text-muted-foreground mt-3">Contact your administrator if you believe this is an error.</p>
          </div>
        </LayoutWrapper>
      );
    }
    return children;
  };

  return (
    <Routes>
      <Route path="/" element={
        <RouteGuard pageName={mainPageKey}>
          <LayoutWrapper currentPageName={mainPageKey}><PageErrorBoundary><MainPage /></PageErrorBoundary></LayoutWrapper>
        </RouteGuard>
      } />
      {Object.entries(Pages).map(([path, Page]) => (
        <Route key={path} path={`/${path}`} element={
          <RouteGuard pageName={path}>
            <LayoutWrapper currentPageName={path}><PageErrorBoundary><Page /></PageErrorBoundary></LayoutWrapper>
          </RouteGuard>
        } />
      ))}
      <Route path="*" element={
        <LayoutWrapper currentPageName="">
          <div className="flex flex-col items-center justify-center py-24">
            <p className="text-2xl font-bold text-foreground mb-2">404</p>
            <p className="text-muted-foreground">Page not found</p>
          </div>
        </LayoutWrapper>
      } />
    </Routes>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Router>
        <AuthProvider>
          <AuthGate />
        </AuthProvider>
      </Router>
    </QueryClientProvider>
  );
}

