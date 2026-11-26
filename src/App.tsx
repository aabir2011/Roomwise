/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, Suspense, lazy } from 'react';
import { motion, AnimatePresence, MotionConfig } from 'motion/react';
import { Loader2, Compass, ArrowLeft, Box, School, FileSpreadsheet } from 'lucide-react';
import { EnergyProvider, useEnergy } from './context/EnergyContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { VoiceAssistantProvider } from './context/VoiceAssistantContext';
import { Sidebar } from './components/layout/Sidebar';
import { Header } from './components/layout/Header';
import { VoiceAssistantOverlay } from './components/voice/VoiceAssistantOverlay';
import { DashboardView } from './components/dashboard/DashboardView';
import { RoomwiseLogo } from './components/common/RoomwiseLogo';
import { AmbientBackdrop } from './components/common/AmbientBackdrop';
import { ActionButton } from './components/common/DesignSystem';
import { ROOMWISE_EASE } from './utils/motion';
import { useDeviceClassification } from './utils/deviceDetection';
import { AppRoute, getPathForTab, parseRouteFromUrl, WorkspaceTabId } from './utils/routing';

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
  <motion.div
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    transition={{ duration: 0.18, ease: ROOMWISE_EASE }}
    className="w-full py-24 flex items-center justify-center"
  >
    <div className="px-4 py-2.5 rounded-xl rw-surface flex items-center gap-2.5 text-xs font-medium text-[#46544e]">
      <Loader2 className="w-4 h-4 animate-spin text-[#0b6e4f]" />
      <span>Loading workspace telemetry...</span>
    </div>
  </motion.div>
);

const AppContent: React.FC = () => {
  const {
    activeTab,
    setActiveTab,
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
  const mainScrollRef = useRef<HTMLElement | null>(null);
  const device = useDeviceClassification();
  const isPhoneViewport =
    device.isPhone || (device.viewportWidth > 0 && device.viewportWidth < 768);

  useEffect(() => {
    const handlePopState = () => {
      setCurrentRoute(parseRouteFromUrl());
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    if (mainScrollRef.current) {
      mainScrollRef.current.scrollTo({ top: 0, behavior: 'auto' });
    }
  }, [activeTab]);

  const navigateToClassroom = (roomCode: string) => {
    setCurrentRoute({ type: 'classroom', roomCode });
    window.history.pushState({}, '', `/classroom/${encodeURIComponent(roomCode)}`);
  };

  const navigateToSection = (tab: WorkspaceTabId = 'dashboard') => {
    const targetPath = getPathForTab(tab);
    window.history.pushState({ tab }, '', targetPath);
    setCurrentRoute({ type: 'dashboard', tab });
    setActiveTab(tab);
  };

  const navigateToDashboard = () => {
    navigateToSection('dashboard');
  };

  useEffect(() => {
    if (currentRoute.type === 'admin-login' && !isAuthLoading && isAdminUnlocked) {
      setCurrentRoute({ type: 'dashboard', tab: 'dashboard' });
      setActiveTab('dashboard');
      window.history.replaceState({}, '', '/');
    }
  }, [currentRoute.type, isAuthLoading, isAdminUnlocked, setActiveTab]);

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
      <div className="min-h-screen w-full bg-app-ambient relative flex items-center justify-center p-4 sm:p-8 select-none">
        <AmbientBackdrop />
        <motion.div
          initial={{ opacity: 0, y: 8, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.24, ease: ROOMWISE_EASE }}
          className="relative z-10 w-full max-w-md rounded-3xl rw-glass-float overflow-hidden"
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

  if (currentRoute.type === 'not-found') {
    return (
      <div className="min-h-screen w-full bg-app-ambient relative text-[#111916] flex flex-col items-center justify-center p-4 sm:p-8 select-none">
        <AmbientBackdrop />
        <div className="relative z-10 w-full max-w-lg rounded-xl rw-surface p-6 sm:p-8 overflow-hidden space-y-5 text-center">
          <div className="flex justify-center">
            <RoomwiseLogo size="md" showSubtitle={false} />
          </div>

          <div className="w-11 h-11 rounded-lg bg-[#eef6f2] border border-[#0b6e4f]/20 text-[#0b6e4f] flex items-center justify-center mx-auto">
            <Compass className="w-5 h-5" />
          </div>

          <div className="space-y-1.5">
            <div className="text-[11px] font-mono font-semibold text-[#0b6e4f]">
              404 · Route Not Found
            </div>
            <h1 className="font-display text-xl sm:text-2xl font-bold text-[#111916]">
              This ROOMWISE page does not exist
            </h1>
            <p className="text-xs text-[#46544e] leading-relaxed">
              The path{' '}
              <span className="font-mono font-semibold text-[#111916] bg-[#ecefe9] px-1.5 py-0.5 rounded">
                {currentRoute.pathname}
              </span>{' '}
              is not a configured workspace view or classroom node.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
            <ActionButton
              variant="forest"
              size="md"
              onClick={() => navigateToSection('dashboard')}
              icon={<ArrowLeft className="w-3.5 h-3.5 text-emerald-200" />}
            >
              Campus Overview
            </ActionButton>
            <ActionButton
              variant="secondary"
              size="md"
              onClick={() => navigateToSection('campus-live')}
              icon={<Box className="w-3.5 h-3.5 text-[#0b6e4f]" />}
            >
              Campus Live
            </ActionButton>
            <ActionButton
              variant="secondary"
              size="md"
              onClick={() => navigateToSection('classrooms')}
              icon={<School className="w-3.5 h-3.5 text-[#0b6e4f]" />}
            >
              Classrooms (25)
            </ActionButton>
            <ActionButton
              variant="secondary"
              size="md"
              onClick={() => navigateToSection('reports')}
              icon={<FileSpreadsheet className="w-3.5 h-3.5 text-[#0b6e4f]" />}
            >
              Reports &amp; BEE
            </ActionButton>
          </div>
        </div>
      </div>
    );
  }

  const isCampusLive = activeTab === 'campus-live';
  const activeViewKey =
    activeTab === 'environmental' || activeTab === 'solar'
      ? 'environmental-solar'
      : activeTab;

  const useLightweightTransition = isCampusLive || isPhoneViewport;

  return (
    <div
      data-device={isPhoneViewport ? 'phone' : 'desktop'}
      className="flex h-dvh w-screen overflow-hidden bg-app-ambient text-[#111916] font-sans antialiased relative selection:bg-[#0b6e4f] selection:text-white"
    >
      <AmbientBackdrop />
      <Sidebar />

      <div className="flex-1 flex flex-col h-full overflow-hidden relative z-10 min-w-0">
        <Header />

        <main ref={mainScrollRef} className="flex-1 overflow-y-auto overflow-x-hidden">
          <Suspense fallback={<ViewFallback />}>
            <AnimatePresence mode="wait">
              <motion.div
                key={activeViewKey}
                initial={useLightweightTransition ? { opacity: 0 } : { opacity: 0, y: 4 }}
                animate={useLightweightTransition ? { opacity: 1 } : { opacity: 1, y: 0 }}
                exit={useLightweightTransition ? { opacity: 0 } : { opacity: 0, y: -2 }}
                transition={{
                  duration: isPhoneViewport ? 0.12 : 0.15,
                  ease: ROOMWISE_EASE,
                }}
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
