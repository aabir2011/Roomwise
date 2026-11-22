/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, Suspense, lazy } from 'react';
import { motion, AnimatePresence, MotionConfig } from 'motion/react';
import { Loader2 } from 'lucide-react';
import { EnergyProvider, useEnergy } from './context/EnergyContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { VoiceAssistantProvider } from './context/VoiceAssistantContext';
import { Sidebar } from './components/layout/Sidebar';
import { Header } from './components/layout/Header';
import { VoiceAssistantOverlay } from './components/voice/VoiceAssistantOverlay';
import { DashboardView } from './components/dashboard/DashboardView';
import { RoomwiseLogo } from './components/common/RoomwiseLogo';
import { ROOMWISE_EASE } from './utils/motion';

const DigitalTwinView = lazy(() =>
  import('./components/digitaltwin/DigitalTwinView').then((m) => ({ default: m.DigitalTwinView }))
);
const CampusLiveView = lazy(() =>
  import('./components/campuslive/CampusLiveView').then((m) => ({ default: m.CampusLiveView }))
);
const ClassroomsView = lazy(() =>
  import('./components/classrooms/ClassroomsView').then((m) => ({ default: m.ClassroomsView }))
);
const EnvironmentalSolarView = lazy(() =>
  import('./components/environment/EnvironmentalSolarView').then((m) => ({
    default: m.EnvironmentalSolarView,
  }))
);
const EnergyAnalyticsView = lazy(() =>
  import('./components/analytics/EnergyAnalyticsView').then((m) => ({ default: m.EnergyAnalyticsView }))
);
const EnergyHistoryView = lazy(() =>
  import('./components/history/EnergyHistoryView').then((m) => ({ default: m.EnergyHistoryView }))
);
const SpaceIntelligenceView = lazy(() =>
  import('./components/space/SpaceIntelligenceView').then((m) => ({
    default: m.SpaceIntelligenceView,
  }))
);
const EnergyAuditView = lazy(() =>
  import('./components/audit/EnergyAuditView').then((m) => ({ default: m.EnergyAuditView }))
);
const ReportsView = lazy(() =>
  import('./components/reports/ReportsView').then((m) => ({ default: m.ReportsView }))
);
const SettingsView = lazy(() =>
  import('./components/settings/SettingsView').then((m) => ({ default: m.SettingsView }))
);
const RoomDetailModal = lazy(() =>
  import('./components/classrooms/RoomDetailModal').then((m) => ({ default: m.RoomDetailModal }))
);
const ClassroomQRModal = lazy(() =>
  import('./components/classrooms/ClassroomQRModal').then((m) => ({ default: m.ClassroomQRModal }))
);
const ClassroomTelemetryView = lazy(() =>
  import('./components/classroom/ClassroomTelemetryView').then((m) => ({
    default: m.ClassroomTelemetryView,
  }))
);
const AdminAuthModal = lazy(() =>
  import('./components/auth/AdminAuthModal').then((m) => ({ default: m.AdminAuthModal }))
);
const PhoneComputerAuthorizerModal = lazy(() =>
  import('./components/auth/PhoneComputerAuthorizerModal').then((m) => ({
    default: m.PhoneComputerAuthorizerModal,
  }))
);
const MobileAccessCardView = lazy(() =>
  import('./components/auth/MobileAccessCardView').then((m) => ({
    default: m.MobileAccessCardView,
  }))
);
const TeacherLoginPanel = lazy(() =>
  import('./components/auth/TeacherLoginPanel').then((m) => ({ default: m.TeacherLoginPanel }))
);
const LogoutConfirmModal = lazy(() =>
  import('./components/auth/LogoutConfirmModal').then((m) => ({ default: m.LogoutConfirmModal }))
);

const ViewFallback: React.FC = () => (
  <div className="w-full py-20 flex items-center justify-center text-xs text-neutral-500 gap-2">
    <Loader2 className="w-4 h-4 animate-spin text-emerald-700" />
    <span>Loading workspace view...</span>
  </div>
);

type AppRoute =
  | { type: 'classroom'; roomCode: string }
  | { type: 'access-card' }
  | { type: 'admin-login' }
  | { type: 'dashboard' };

function parseRouteFromUrl(): AppRoute {
  if (typeof window === 'undefined') return { type: 'dashboard' };

  const path = window.location.pathname;
  const hash = window.location.hash;
  const search = new URLSearchParams(window.location.search);

  if (
    /^\/(?:access-card|mobile-access)\/?$/i.test(path) ||
    /^#\/(?:access-card|mobile-access)/i.test(hash) ||
    search.has('c') ||
    search.has('challenge')
  ) {
    return { type: 'access-card' };
  }

  if (/^\/(?:admin-login|admin)\/?$/i.test(path) || /^#\/(?:admin-login|admin)/i.test(hash)) {
    return { type: 'admin-login' };
  }

  const queryRoom = search.get('room') || search.get('classroom');
  if (queryRoom) {
    return { type: 'classroom', roomCode: queryRoom.trim() };
  }

  const pathMatch = path.match(/^\/classroom\/([^/?#]+)/i);
  if (pathMatch) {
    return { type: 'classroom', roomCode: decodeURIComponent(pathMatch[1]).trim() };
  }

  const hashMatch = hash.match(/^#\/classroom\/([^/?#]+)/i);
  if (hashMatch) {
    return { type: 'classroom', roomCode: decodeURIComponent(hashMatch[1]).trim() };
  }

  return { type: 'dashboard' };
}

const AppContent: React.FC = () => {
  const {
    activeTab,
    selectedRoom,
    setSelectedRoomId,
    qrModalRoom,
    setQrModalRoom,
  } = useEnergy();

  const {
    isAdminUnlocked,
    isAuthLoading,
    sessionEndedNotice,
    clearSessionEndedNotice,
  } = useAuth();

  const [currentRoute, setCurrentRoute] = useState<AppRoute>(parseRouteFromUrl);

  useEffect(() => {
    const handlePopState = () => {
      setCurrentRoute(parseRouteFromUrl());
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigateToClassroom = (roomCode: string) => {
    setCurrentRoute({ type: 'classroom', roomCode });
    window.history.pushState({}, '', `/classroom/${roomCode}`);
  };

  const navigateToDashboard = () => {
    setCurrentRoute({ type: 'dashboard' });
    window.history.pushState({}, '', '/');
  };

  useEffect(() => {
    if (currentRoute.type === 'admin-login' && !isAuthLoading && isAdminUnlocked) {
      setCurrentRoute({ type: 'dashboard' });
      window.history.replaceState({}, '', '/');
    }
  }, [currentRoute.type, isAuthLoading, isAdminUnlocked]);

  if (currentRoute.type === 'access-card') {
    return (
      <Suspense fallback={<ViewFallback />}>
        <MobileAccessCardView onNavigateHome={navigateToDashboard} />
      </Suspense>
    );
  }

  if (currentRoute.type === 'admin-login') {
    if (isAuthLoading || isAdminUnlocked) {
      return (
        <div className="min-h-screen w-full bg-white flex flex-col items-center justify-center p-6 select-none gap-4">
          <RoomwiseLogo size="md" showSubtitle={false} />
          <div className="flex items-center gap-2 text-xs font-medium text-neutral-600">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-700" />
            <span>{isAuthLoading ? 'Checking administrator session...' : 'Opening Administrator Dashboard...'}</span>
          </div>
        </div>
      );
    }

    return (
      <div className="min-h-screen w-full bg-app-ambient flex items-center justify-center p-4 sm:p-8 select-none">
        <motion.div
          initial={{ opacity: 0, y: 8, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.24, ease: ROOMWISE_EASE }}
          className="w-full max-w-md rounded-3xl rw-glass-float overflow-hidden"
        >
          <Suspense fallback={<ViewFallback />}>
            <TeacherLoginPanel
              sessionEndedNotice={sessionEndedNotice}
              onDismissSessionEnded={clearSessionEndedNotice}
              onSuccess={navigateToDashboard}
              onCancel={navigateToDashboard}
            />
          </Suspense>
        </motion.div>
      </div>
    );
  }

  if (currentRoute.type === 'classroom') {
    return (
      <>
        <Suspense fallback={<ViewFallback />}>
          <ClassroomTelemetryView
            roomCode={currentRoute.roomCode}
            onNavigateHome={navigateToDashboard}
            onSelectRoomCode={navigateToClassroom}
          />
        </Suspense>

        <Suspense fallback={null}>
          <AnimatePresence>
            {selectedRoom && (
              <RoomDetailModal
                key={selectedRoom.id}
                room={selectedRoom}
                onClose={() => setSelectedRoomId(null)}
              />
            )}
          </AnimatePresence>

          <AnimatePresence>
            {qrModalRoom && (
              <ClassroomQRModal
                key={qrModalRoom.id}
                room={qrModalRoom}
                onClose={() => setQrModalRoom(null)}
                onOpenClassroomPage={navigateToClassroom}
              />
            )}
          </AnimatePresence>

          <AdminAuthModal />
          <PhoneComputerAuthorizerModal />
          <LogoutConfirmModal />
        </Suspense>
        <VoiceAssistantOverlay />
      </>
    );
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-app-ambient text-neutral-900 font-sans antialiased relative selection:bg-emerald-500 selection:text-white">
      <Sidebar />

      <div className="flex-1 flex flex-col h-full overflow-hidden relative z-10 min-w-0">
        <Header />

        <main className="flex-1 overflow-y-auto overflow-x-hidden">
          <Suspense fallback={<ViewFallback />}>
            <AnimatePresence mode="wait">
              <motion.div
                key={
                  activeTab === 'environmental' || activeTab === 'solar'
                    ? 'environmental-solar'
                    : activeTab
                }
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.18, ease: ROOMWISE_EASE }}
                className="min-h-full"
              >
                {activeTab === 'dashboard' && <DashboardView />}
                {activeTab === 'digital-twin' && <DigitalTwinView />}
                {activeTab === 'campus-live' && <CampusLiveView />}
                {activeTab === 'classrooms' && <ClassroomsView />}
                {(activeTab === 'environmental-solar' ||
                  activeTab === 'environmental' ||
                  activeTab === 'solar') && (
                  <EnvironmentalSolarView
                    initialModule={activeTab === 'solar' ? 'solar' : 'environmental'}
                  />
                )}
                {activeTab === 'analytics' && <EnergyAnalyticsView />}
                {activeTab === 'history' && <EnergyHistoryView />}
                {activeTab === 'space-intelligence' && <SpaceIntelligenceView />}
                {activeTab === 'audit' && <EnergyAuditView />}
                {activeTab === 'reports' && <ReportsView />}
                {activeTab === 'settings' && <SettingsView />}
              </motion.div>
            </AnimatePresence>
          </Suspense>
        </main>
      </div>

      <Suspense fallback={null}>
        <AnimatePresence>
          {selectedRoom && (
            <RoomDetailModal
              key={selectedRoom.id}
              room={selectedRoom}
              onClose={() => setSelectedRoomId(null)}
            />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {qrModalRoom && (
            <ClassroomQRModal
              key={qrModalRoom.id}
              room={qrModalRoom}
              onClose={() => setQrModalRoom(null)}
              onOpenClassroomPage={navigateToClassroom}
            />
          )}
        </AnimatePresence>

        <AdminAuthModal />
        <PhoneComputerAuthorizerModal />
        <LogoutConfirmModal />
      </Suspense>
      <VoiceAssistantOverlay />
    </div>
  );
};

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <ToastProvider>
        <AuthProvider>
          <EnergyProvider>
            <VoiceAssistantProvider>
              <AppContent />
            </VoiceAssistantProvider>
          </EnergyProvider>
        </AuthProvider>
      </ToastProvider>
    </MotionConfig>
  );
}
