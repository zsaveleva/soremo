import { lazy, Suspense } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { ToastProvider } from '../design/components';
import { SessionProvider } from '../features/auth/session';
import { NotFoundPage } from './NotFoundPage';
import { ErrorBoundary } from './ErrorBoundary';

// Каждый экран — отдельный чанк: отчёт не тянет MapLibre, карта не тянет формы.
const MapPage = lazy(() => import('../features/map/MapPage').then((m) => ({ default: m.MapPage })));
const DesignPage = lazy(() => import('../design/DesignPage').then((m) => ({ default: m.DesignPage })));
const DemoReportPage = lazy(() => import('../features/reports/DemoReportPage').then((m) => ({ default: m.DemoReportPage })));
const ReportPage = lazy(() => import('../features/reports/ReportPage').then((m) => ({ default: m.ReportPage })));
const PrintPage = lazy(() => import('../features/reports/PrintPage').then((m) => ({ default: m.PrintPage })));
const SignupPage = lazy(() => import('../features/auth/SignupPage').then((m) => ({ default: m.SignupPage })));
const LoginPage = lazy(() => import('../features/auth/LoginPage').then((m) => ({ default: m.LoginPage })));
const CheckEmailPage = lazy(() => import('../features/auth/CheckEmailPage').then((m) => ({ default: m.CheckEmailPage })));
const VerifyPage = lazy(() => import('../features/auth/VerifyPage').then((m) => ({ default: m.VerifyPage })));
const AccountPage = lazy(() => import('../features/account/AccountPage').then((m) => ({ default: m.AccountPage })));
const PricingPage = lazy(() => import('../features/pricing/PricingPage').then((m) => ({ default: m.PricingPage })));
const CheckoutPage = lazy(() => import('../features/pricing/CheckoutPage').then((m) => ({ default: m.CheckoutPage })));
const CheckoutDonePage = lazy(() => import('../features/pricing/CheckoutPage').then((m) => ({ default: m.CheckoutDonePage })));
const DocumentsPage = lazy(() => import('../features/documents/DocumentsPage').then((m) => ({ default: m.DocumentsPage })));
const AddObjectPage = lazy(() => import('../features/objects/AddObjectPage').then((m) => ({ default: m.AddObjectPage })));
const AdminPage = lazy(() => import('../features/admin/AdminPage').then((m) => ({ default: m.AdminPage })));

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000, retry: 1, refetchOnWindowFocus: false } },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <ToastProvider>
          <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <ErrorBoundary>
            <Suspense fallback={null}>
              <Routes>
                <Route path="/" element={<MapPage />} />
                <Route path="/map" element={<MapPage />} />
                <Route path="/design" element={<DesignPage />} />
                <Route path="/demo/:buildingId" element={<DemoReportPage />} />
                <Route path="/reports/:id" element={<ReportPage />} />
                <Route path="/print/reports/:id" element={<PrintPage kind="user" />} />
                <Route path="/print/demo/:id" element={<PrintPage kind="demo" />} />
                <Route path="/signup" element={<SignupPage />} />
                <Route path="/login" element={<LoginPage />} />
                <Route path="/check-email" element={<CheckEmailPage />} />
                <Route path="/verify" element={<VerifyPage />} />
                <Route path="/account" element={<AccountPage />} />
                <Route path="/pricing" element={<PricingPage />} />
                <Route path="/checkout/done" element={<CheckoutDonePage />} />
                <Route path="/checkout/:paymentId" element={<CheckoutPage />} />
                <Route path="/objects/new" element={<AddObjectPage />} />
                <Route path="/objects/:id/documents" element={<DocumentsPage />} />
                <Route path="/admin" element={<AdminPage />} />
                <Route path="*" element={<NotFoundPage />} />
              </Routes>
            </Suspense>
            </ErrorBoundary>
          </BrowserRouter>
        </ToastProvider>
      </SessionProvider>
    </QueryClientProvider>
  );
}
