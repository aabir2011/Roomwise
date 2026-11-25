/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  LayoutDashboard,
  Layers,
  School,
  LineChart,
  History,
  ShieldCheck,
  FileSpreadsheet,
  SlidersHorizontal,
  X,
  LogIn,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  QrCode,
  Loader2,
  ArrowRightLeft,
  Box,
  CloudSun,
} from 'lucide-react';
import { useEnergy } from '../../context/EnergyContext';
import { useAuth, getStoredClientSessionToken } from '../../context/AuthContext';
import { useDeviceClassification } from '../../utils/deviceDetection';
import { RoomwiseLogo } from '../common/RoomwiseLogo';
import { AnimatedNumber, Tooltip } from '../common/MotionPrimitives';
import { ROOMWISE_EASE, SPRING_GENTLE, SPRING_SNAPPY, backdropVariants } from '../../utils/motion';

const SIDEBAR_COLLAPSE_KEY = 'roomwise_sidebar_collapsed';

export const Sidebar: React.FC = () => {
  const {
    activeTab,
    setActiveTab,
    campusSummary,
    settings,
    isMobileMenuOpen,
    setIsMobileMenuOpen,
    auditFindings,
    currentStaff,
  } = useEnergy();
  const {
    user,
    isAdminUnlocked,
    isAuthLoading,
    openAuthModal,
    openPhoneQrModal,
    requestLogout,
  } = useAuth();
  const device = useDeviceClassification();

  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem(SIDEBAR_COLLAPSE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const toggleCollapse = () => {
    setIsCollapsed((prev) => {
      const next = !prev;
      try {
        sessionStorage.setItem(SIDEBAR_COLLAPSE_KEY, String(next));
      } catch {
        // ignore storage errors
      }
      return next;
    });
  };

  useEffect(() => {
    if (!isMobileMenuOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsMobileMenuOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isMobileMenuOpen, setIsMobileMenuOpen]);

  const navItems = [
    { id: 'dashboard', label: 'Overview', icon: LayoutDashboard },
    { id: 'digital-twin', label: 'Digital Twin', icon: Layers },
    { id: 'campus-live', label: 'Campus Live', icon: Box },
    { id: 'classrooms', label: 'Classrooms (25)', icon: School },
    { id: 'environmental-solar', label: 'Environmental & Solar', icon: CloudSun },
    { id: 'analytics', label: 'Energy Analytics', icon: LineChart },
    { id: 'history', label: 'Energy History', icon: History },
    { id: 'space-intelligence', label: 'Space Intelligence', icon: ArrowRightLeft },
    { id: 'audit', label: 'Energy Audit', icon: ShieldCheck },
    { id: 'reports', label: 'Reports & BEE', icon: FileSpreadsheet },
    { id: 'settings', label: 'Settings', icon: SlidersHorizontal },
  ];

  const ratedUtilizationPct = Math.min(100, Math.round(campusSummary.ratedUtilizationPercent));
  const ratedMaxKW = (campusSummary.totalRatedPowerWatts / 1000).toFixed(2);
  const availableHeadroomKW = (campusSummary.availableHeadroomWatts / 1000).toFixed(2);

  const unresolvedAuditCount = auditFindings.filter((f) => !f.isResolved).length;

  const handleNavClick = (tabId: string) => {
    setActiveTab(tabId);
    setIsMobileMenuOpen(false);
  };

  const renderSidebarInner = (compact: boolean) => (
    <div className="flex flex-col h-full justify-between select-none">
      {/* Brand & Navigation */}
      <div className="min-w-0">
        <div className={`border-b border-neutral-200/70 transition-all ${compact ? 'p-3' : 'px-5 py-4'}`}>
          <div className={`flex items-center ${compact ? 'justify-center' : 'justify-between gap-2'}`}>
            {compact ? (
              <button
                type="button"
                onClick={toggleCollapse}
                title="Expand navigation sidebar"
                aria-label="Expand navigation sidebar"
                className="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-neutral-100/80 transition-colors"
              >
                <img
                  src="/assets/aistudio/logo__transparent__55b16555.png"
                  alt="ROOMWISE"
                  className="w-7 h-7 object-contain"
                />
              </button>
            ) : (
              <RoomwiseLogo size="md" />
            )}

            {!compact && (
              <button
                type="button"
                onClick={toggleCollapse}
                className="hidden lg:inline-flex p-1.5 text-[#64726b] hover:text-[#111815] rounded-lg hover:bg-neutral-100/80 transition-colors shrink-0"
                title="Collapse sidebar"
                aria-label="Collapse navigation sidebar"
              >
                <PanelLeftClose className="w-4 h-4" />
              </button>
            )}

            <button
              type="button"
              onClick={() => setIsMobileMenuOpen(false)}
              className="lg:hidden p-1.5 text-[#64726b] hover:text-[#111815] rounded-lg hover:bg-neutral-100 transition-colors"
              aria-label="Close navigation"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {compact ? (
            <div className="mt-2.5 flex justify-center">
              <button
                type="button"
                onClick={toggleCollapse}
                className="p-1.5 text-[#64726b] hover:text-[#111815] rounded-lg hover:bg-neutral-100 transition-colors"
                title="Expand sidebar"
                aria-label="Expand sidebar"
              >
                <PanelLeftOpen className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="mt-3.5 pt-3 border-t border-neutral-200/60">
              <div
                className="text-xs font-semibold text-[#111815] truncate"
                title={settings.institutionName}
              >
                {settings.institutionName}
              </div>
              <div className="text-[11px] text-[#64726b] truncate mt-0.5 tabular-nums">
                5 Blocks · 25 Nodes
              </div>
            </div>
          )}
        </div>

        {/* Navigation Links */}
        <nav className="p-3 space-y-0.5" aria-label="Primary Campus Navigation">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive =
              activeTab === item.id ||
              (item.id === 'environmental-solar' &&
                (activeTab === 'environmental' || activeTab === 'solar'));
            const layoutSuffix = compact ? 'compact' : 'full';

            const buttonEl = (
              <motion.button
                key={item.id}
                type="button"
                aria-current={isActive ? 'page' : undefined}
                whileTap={{ scale: 0.985 }}
                onClick={() => handleNavClick(item.id)}
                className={`relative w-full flex items-center ${
                  compact ? 'justify-center px-2 py-2.5' : 'gap-2.5 px-3 py-2'
                } rounded-xl text-[13px] transition-colors text-left ${
                  isActive
                    ? 'text-[#071e17] font-semibold'
                    : 'text-[#4a5851] font-medium hover:text-[#111815] hover:bg-[#f3f5f4]/80'
                }`}
              >
                {isActive && (
                  <motion.span
                    layoutId={`sidebar-active-pill-${layoutSuffix}`}
                    transition={SPRING_SNAPPY}
                    className="absolute inset-0 rounded-xl bg-[#eef3f0] border border-emerald-700/15"
                    aria-hidden="true"
                  />
                )}

                <Icon
                  className={`relative z-10 w-4 h-4 shrink-0 transition-colors ${
                    isActive ? 'text-emerald-700' : 'text-[#64726b]'
                  }`}
                />

                {!compact && (
                  <>
                    <span className="relative z-10 truncate">{item.label}</span>
                    {item.id === 'audit' && (
                      <span
                        className={`relative z-10 ml-auto text-[10px] font-mono font-semibold tabular-nums ${
                          unresolvedAuditCount > 0 ? 'text-amber-700' : 'text-emerald-700'
                        }`}
                      >
                        {unresolvedAuditCount > 0 ? unresolvedAuditCount : 'Clear'}
                      </span>
                    )}
                  </>
                )}

                {compact && item.id === 'audit' && unresolvedAuditCount > 0 && (
                  <span
                    className="absolute top-1.5 right-2 w-1.5 h-1.5 rounded-full bg-amber-600"
                    aria-label={`${unresolvedAuditCount} unresolved findings`}
                  />
                )}
              </motion.button>
            );

            if (compact) {
              return (
                <Tooltip key={item.id} content={item.label} side="bottom" className="w-full block">
                  {buttonEl}
                </Tooltip>
              );
            }
            return buttonEl;
          })}
        </nav>
      </div>

      {/* Bottom Summary & Session Footer */}
      <div className="space-y-2.5 p-3">
        {!compact ? (
          <div className="p-3.5 rounded-2xl rw-forest-hero text-white">
            <div className="flex items-center justify-between text-[11px] mb-2">
              <span className="font-medium text-emerald-100/80">Campus Load</span>
              <span className="font-mono font-semibold text-emerald-300 tabular-nums">
                {campusSummary.availableHeadroomWatts === 0
                  ? '100% Rated'
                  : `${campusSummary.ratedUtilizationPercent}% Rated`}
              </span>
            </div>

            <div className="flex items-baseline justify-between">
              <span className="text-lg font-semibold font-mono text-white tabular-nums">
                <AnimatedNumber
                  value={campusSummary.totalCurrentPowerWatts / 1000}
                  decimals={2}
                  suffix=" kW"
                />
              </span>
              <span className="font-mono text-[11px] text-emerald-200/85 tabular-nums">
                {campusSummary.availableHeadroomWatts === 0
                  ? `of ${ratedMaxKW} kW max`
                  : `${availableHeadroomKW} kW headroom`}
              </span>
            </div>

            <div className="w-full bg-white/15 h-1 rounded-full mt-2.5 overflow-hidden">
              <motion.div
                className="bg-emerald-400 h-full rounded-full"
                initial={false}
                animate={{
                  width: `${Math.min(100, Math.max(4, ratedUtilizationPct))}%`,
                }}
                transition={{ duration: 0.35, ease: ROOMWISE_EASE }}
              />
            </div>
          </div>
        ) : (
          <Tooltip
            content={`Live: ${(campusSummary.totalCurrentPowerWatts / 1000).toFixed(2)} kW (${campusSummary.ratedUtilizationPercent}% of ${ratedMaxKW} kW Installed Rated Max)`}
          >
            <div className="w-full py-2 rounded-xl bg-[#0b2e22] text-emerald-200 text-center font-mono text-[10px] font-semibold tabular-nums">
              {ratedUtilizationPct}%
            </div>
          </Tooltip>
        )}

        {!compact && isAdminUnlocked && device.isPhone && (
          <button
            type="button"
            onClick={() => {
              setIsMobileMenuOpen(false);
              openPhoneQrModal();
            }}
            className="w-full min-h-[42px] px-3 py-2 rounded-xl bg-[#0b2e22] hover:bg-[#114231] text-white text-xs font-semibold transition-colors flex items-center justify-center gap-2 cursor-pointer"
          >
            <QrCode className="w-4 h-4 shrink-0 text-emerald-300" />
            <span>Scan Computer QR</span>
          </button>
        )}

        {/* User Session Row */}
        <div
          className={`pt-2 border-t border-neutral-200/75 flex items-center ${
            compact ? 'justify-center pt-2.5' : 'justify-between gap-2'
          }`}
        >
          {isAuthLoading && getStoredClientSessionToken() ? (
            <div className="text-[11px] text-[#64726b] font-medium py-1 px-1 flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-700" />
              {!compact && <span>Verifying...</span>}
            </div>
          ) : compact ? (
            <Tooltip content={isAdminUnlocked ? `${currentStaff.name} · Logout` : 'Admin Login'}>
              <button
                type="button"
                onClick={() => (isAdminUnlocked ? requestLogout() : openAuthModal())}
                className={`w-8 h-8 rounded-xl font-semibold text-xs flex items-center justify-center text-white transition-transform active:scale-95 ${
                  isAdminUnlocked ? 'bg-[#0b2e22] hover:bg-[#114231]' : 'bg-[#111815] hover:bg-neutral-800'
                }`}
                aria-label={isAdminUnlocked ? 'Logout administrator session' : 'Open administrator login'}
              >
                {isAdminUnlocked ? currentStaff.avatarInitials : user.avatarInitials}
              </button>
            </Tooltip>
          ) : (
            <>
              <div className="flex items-center gap-2.5 overflow-hidden min-w-0">
                <div
                  className={`w-7 h-7 rounded-lg text-white font-semibold text-[11px] flex items-center justify-center shrink-0 ${
                    isAdminUnlocked ? 'bg-[#0b2e22]' : 'bg-[#111815]'
                  }`}
                >
                  {isAdminUnlocked ? currentStaff.avatarInitials : user.avatarInitials}
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-[#111815] truncate">
                    {isAdminUnlocked ? currentStaff.name : 'Student Mode'}
                  </div>
                  <div className="text-[11px] text-[#526059] truncate">
                    {isAdminUnlocked ? currentStaff.role : 'Read-only access'}
                  </div>
                </div>
              </div>

              {isAdminUnlocked ? (
                <button
                  type="button"
                  onClick={() => {
                    setIsMobileMenuOpen(false);
                    requestLogout();
                  }}
                  className="inline-flex items-center gap-1 px-2 py-1 text-[#4a5851] hover:text-[#111815] rounded-lg hover:bg-neutral-100 transition-colors shrink-0 text-[11px] font-medium"
                  title="Logout from administrator session"
                >
                  <LogOut className="w-3 h-3" />
                  <span>Logout</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => openAuthModal()}
                  className="inline-flex items-center gap-1 px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-950 border border-amber-300/80 rounded-lg transition-colors shrink-0 text-[11px] font-semibold active:scale-[0.98]"
                  title="Sign in with administrator passkey or credentials"
                >
                  <LogIn className="w-3 h-3 shrink-0" />
                  <span>Admin Login</span>
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <>
      <motion.aside
        initial={false}
        animate={{ width: isCollapsed ? 74 : 252 }}
        transition={SPRING_GENTLE}
        className="hidden lg:flex glass-sidebar flex-col justify-between shrink-0 h-screen sticky top-0 z-30 overflow-hidden"
      >
        {renderSidebarInner(isCollapsed)}
      </motion.aside>

      <AnimatePresence>
        {isMobileMenuOpen && (
          <div className="lg:hidden fixed inset-0 z-50 flex">
            <motion.div
              variants={backdropVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="fixed inset-0 bg-[#071e17]/40 backdrop-blur-xs"
              onClick={() => setIsMobileMenuOpen(false)}
            />

            <motion.aside
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ duration: 0.24, ease: ROOMWISE_EASE }}
              className="relative w-72 max-w-[82vw] rw-glass-float border-r border-neutral-200 shadow-2xl h-full flex flex-col z-50"
            >
              {renderSidebarInner(false)}
            </motion.aside>
          </div>
        )}
      </AnimatePresence>
    </>
  );
};
