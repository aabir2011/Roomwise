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
import { ActionButton, IconButton } from '../common/DesignSystem';
import { ROOMWISE_EASE, SPRING_GENTLE, SPRING_SNAPPY, backdropVariants } from '../../utils/motion';

const SIDEBAR_COLLAPSE_KEY = 'roomwise_sidebar_collapsed';

interface NavGroup {
  label: string;
  items: Array<{
    id: string;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }>;
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Campus',
    items: [
      { id: 'dashboard', label: 'Overview', icon: LayoutDashboard },
      { id: 'digital-twin', label: 'Digital Twin', icon: Layers },
      { id: 'campus-live', label: 'Campus Live', icon: Box },
      { id: 'classrooms', label: 'Classrooms (25)', icon: School },
    ],
  },
  {
    label: 'Intelligence',
    items: [
      { id: 'environmental-solar', label: 'Environmental & Solar', icon: CloudSun },
      { id: 'analytics', label: 'Energy Analytics', icon: LineChart },
      { id: 'history', label: 'Energy History', icon: History },
      { id: 'space-intelligence', label: 'Space Intelligence', icon: ArrowRightLeft },
    ],
  },
  {
    label: 'Governance',
    items: [
      { id: 'audit', label: 'Energy Audit', icon: ShieldCheck },
      { id: 'reports', label: 'Reports & BEE', icon: FileSpreadsheet },
      { id: 'settings', label: 'Settings', icon: SlidersHorizontal },
    ],
  },
];

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

  const ratedUtilizationPct = Math.min(100, Math.round(campusSummary.ratedUtilizationPercent));
  const ratedMaxKW = (campusSummary.totalRatedPowerWatts / 1000).toFixed(2);
  const availableHeadroomKW = (campusSummary.availableHeadroomWatts / 1000).toFixed(2);
  const unresolvedAuditCount = auditFindings.filter((f) => !f.isResolved).length;

  const handleNavClick = (tabId: string) => {
    setActiveTab(tabId);
    setIsMobileMenuOpen(false);
  };

  const renderSidebarInner = (compact: boolean) => (
    <div className="flex flex-col h-full min-h-0 justify-between select-none text-[#e5eee8]">
      {/* Brand & Grouped Architectural Navigation */}
      <div className="min-w-0 min-h-0 flex-1 flex flex-col overflow-hidden">
        <div
          className={`border-b border-white/[0.08] transition-all shrink-0 ${
            compact ? 'p-2.5' : 'px-3.5 py-2.5'
          }`}
        >
          <div className={`flex items-center ${compact ? 'justify-center' : 'justify-between gap-2'}`}>
            {compact ? (
              <IconButton
                variant="dark-ghost"
                size="md"
                label="Expand navigation sidebar"
                title="Expand navigation sidebar"
                onClick={toggleCollapse}
                className="!bg-white/[0.05] !border-white/10 hover:!bg-white/[0.1]"
              >
                <img
                  src="/assets/aistudio/logo__transparent__55b16555.png"
                  alt="ROOMWISE"
                  className="w-6 h-6 object-contain"
                />
              </IconButton>
            ) : (
              <RoomwiseLogo size="md" tone="dark" />
            )}

            {!compact && (
              <IconButton
                variant="dark-ghost"
                size="xs"
                label="Collapse navigation sidebar"
                title="Collapse sidebar"
                onClick={toggleCollapse}
                className="hidden lg:inline-flex !bg-transparent !border-transparent hover:!bg-white/[0.08] text-[#8ea69b]"
              >
                <PanelLeftClose className="w-4 h-4" />
              </IconButton>
            )}

            <IconButton
              variant="dark-ghost"
              size="xs"
              label="Close navigation"
              onClick={() => setIsMobileMenuOpen(false)}
              className="lg:hidden !bg-transparent !border-transparent hover:!bg-white/[0.08] text-[#8ea69b]"
            >
              <X className="w-5 h-5" />
            </IconButton>
          </div>

          {compact ? (
            <div className="mt-2 flex justify-center">
              <Tooltip content="Expand navigation" side="right">
                <IconButton
                  variant="dark-ghost"
                  size="xs"
                  label="Expand sidebar"
                  onClick={toggleCollapse}
                  className="!bg-transparent !border-transparent hover:!bg-white/[0.08] text-[#8ea69b]"
                >
                  <PanelLeftOpen className="w-4 h-4" />
                </IconButton>
              </Tooltip>
            </div>
          ) : (
            <div className="mt-2 pt-2 border-t border-white/[0.07] flex items-center justify-between gap-2">
              <div
                className="text-[11px] font-medium text-[#d5e3db] truncate"
                title={`${settings.institutionName} · 5 Blocks · 25 Monitored Nodes`}
              >
                {settings.institutionName}
              </div>
              <span className="text-[9.5px] font-mono text-[#7c9489] shrink-0 tabular-nums">
                25 Nodes
              </span>
            </div>
          )}
        </div>

        {/* Grouped Navigation Links — fits cleanly at 768px–1080px with zero clipping */}
        <nav
          className={`flex-1 min-h-0 overflow-y-auto rw-dark-scrollbar ${
            compact ? 'p-2 space-y-1' : 'px-2.5 py-2 space-y-2.5'
          }`}
          aria-label="Primary Campus Navigation"
        >
          {NAV_GROUPS.map((group, groupIndex) => (
            <div
              key={group.label}
              className={
                compact && groupIndex > 0
                  ? 'pt-1.5 border-t border-white/[0.07]'
                  : !compact && groupIndex > 0
                  ? 'pt-1.5 border-t border-white/[0.06]'
                  : ''
              }
            >
              {!compact && (
                <div className="px-2.5 pb-1 text-[9.5px] font-semibold uppercase tracking-[0.08em] text-[#6e867b]">
                  {group.label}
                </div>
              )}
              <div className="space-y-0.5">
                {group.items.map((item) => {
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
                        compact ? 'justify-center px-2 py-2' : 'gap-2.5 px-2.5 py-1.5'
                      } rounded-lg text-[12.5px] leading-snug transition-colors text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${
                        isActive
                          ? 'text-white font-semibold'
                          : 'text-[#a5bab0] font-medium hover:text-[#eef4f0] hover:bg-white/[0.05]'
                      }`}
                    >
                      {isActive && (
                        <motion.span
                          layoutId={`sidebar-active-pill-${layoutSuffix}`}
                          transition={SPRING_SNAPPY}
                          className="absolute inset-0 rounded-lg bg-[#122b21] border border-emerald-400/25"
                          aria-hidden="true"
                        />
                      )}

                      {isActive && !compact && (
                        <span
                          className="relative z-10 w-[2px] h-3.5 rounded-full bg-gradient-to-b from-emerald-300 to-[#0b6e4f] -ml-1 mr-0.5 shrink-0"
                          aria-hidden="true"
                        />
                      )}

                      <Icon
                        className={`relative z-10 w-4 h-4 shrink-0 transition-colors ${
                          isActive ? 'text-emerald-400' : 'text-[#7c9489]'
                        }`}
                      />

                      {!compact && (
                        <>
                          <span className="relative z-10 truncate">{item.label}</span>
                          {item.id === 'audit' && (
                            <span
                              className={`relative z-10 ml-auto text-[10px] font-mono font-semibold tabular-nums ${
                                unresolvedAuditCount > 0 ? 'text-amber-300' : 'text-emerald-400'
                              }`}
                            >
                              {unresolvedAuditCount > 0 ? unresolvedAuditCount : 'Clear'}
                            </span>
                          )}
                        </>
                      )}

                      {compact && item.id === 'audit' && unresolvedAuditCount > 0 && (
                        <span
                          className="absolute top-1.5 right-2 w-1.5 h-1.5 rounded-full bg-amber-400"
                          aria-label={`${unresolvedAuditCount} unresolved findings`}
                        />
                      )}
                    </motion.button>
                  );

                  if (compact) {
                    return (
                      <Tooltip key={item.id} content={item.label} side="right" className="w-full block">
                        {buttonEl}
                      </Tooltip>
                    );
                  }
                  return buttonEl;
                })}
              </div>
            </div>
          ))}
        </nav>
      </div>

      {/* Compact Live Load Strip & Session Footer */}
      <div className="space-y-2 p-2.5 border-t border-white/[0.08] shrink-0 bg-[#08130f]">
        {!compact ? (
          <div
            className="px-2.5 py-2 rounded-lg bg-[#0e1f18] border border-white/[0.08]"
            title={`Active draw ${(campusSummary.totalCurrentPowerWatts / 1000).toFixed(2)} kW of ${ratedMaxKW} kW rated (${availableHeadroomKW} kW headroom)`}
          >
            <div className="flex items-baseline justify-between gap-2 text-[11px] tabular-nums">
              <span className="font-mono font-semibold text-white">
                <AnimatedNumber
                  value={campusSummary.totalCurrentPowerWatts / 1000}
                  decimals={2}
                  suffix=" kW"
                />
              </span>
              <span className="font-mono text-[10px] text-emerald-300 font-medium">
                {campusSummary.availableHeadroomWatts === 0
                  ? '100% rated'
                  : `${ratedUtilizationPct}% · ${availableHeadroomKW} kW free`}
              </span>
            </div>

            <div className="w-full bg-white/[0.1] h-1 rounded-full mt-1.5 overflow-hidden">
              <motion.div
                className="bg-gradient-to-r from-[#0b6e4f] via-emerald-400 to-emerald-300 h-full rounded-full"
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
            side="right"
            className="w-full block"
            content={`Live: ${(campusSummary.totalCurrentPowerWatts / 1000).toFixed(2)} kW (${campusSummary.ratedUtilizationPercent}% of ${ratedMaxKW} kW Installed Rated Max)`}
          >
            <div className="w-full py-1.5 rounded-lg bg-[#12261f] border border-white/10 text-emerald-300 text-center font-mono text-[10px] font-semibold tabular-nums hover:border-emerald-400/35 transition-colors">
              {ratedUtilizationPct}%
            </div>
          </Tooltip>
        )}

        {!compact && isAdminUnlocked && device.isPhone && (
          <ActionButton
            variant="forest"
            size="md"
            fullWidth
            onClick={() => {
              setIsMobileMenuOpen(false);
              openPhoneQrModal();
            }}
            icon={<QrCode className="w-4 h-4 text-emerald-200" />}
          >
            Scan Computer QR
          </ActionButton>
        )}

        {/* User Session Row */}
        <div
          className={`pt-1.5 border-t border-white/[0.07] flex items-center ${
            compact ? 'justify-center pt-2' : 'justify-between gap-2'
          }`}
        >
          {isAuthLoading && getStoredClientSessionToken() ? (
            <div className="text-[11px] text-[#8ea69b] font-medium py-1 px-1 flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" />
              {!compact && <span>Verifying...</span>}
            </div>
          ) : compact ? (
            <Tooltip
              side="right"
              content={isAdminUnlocked ? `${currentStaff.name} · Logout` : 'Admin Login'}
            >
              <IconButton
                variant={isAdminUnlocked ? 'forest' : 'dark-ghost'}
                size="sm"
                label={isAdminUnlocked ? 'Logout administrator session' : 'Open administrator login'}
                onClick={() => (isAdminUnlocked ? requestLogout() : openAuthModal())}
                className="font-semibold text-xs"
              >
                {isAdminUnlocked ? currentStaff.avatarInitials : user.avatarInitials}
              </IconButton>
            </Tooltip>
          ) : (
            <>
              <div className="flex items-center gap-2 overflow-hidden min-w-0">
                <div
                  className={`w-7 h-7 rounded-md text-white font-semibold text-[11px] flex items-center justify-center shrink-0 ${
                    isAdminUnlocked
                      ? 'bg-[#0b6e4f] border border-emerald-400/30'
                      : 'bg-white/[0.1] border border-white/10'
                  }`}
                >
                  {isAdminUnlocked ? currentStaff.avatarInitials : user.avatarInitials}
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-[#eef4f0] truncate">
                    {isAdminUnlocked ? currentStaff.name : 'Student Mode'}
                  </div>
                  <div className="text-[10px] text-[#8ea69b] truncate">
                    {isAdminUnlocked ? currentStaff.role : 'Read-only access'}
                  </div>
                </div>
              </div>

              {isAdminUnlocked ? (
                <ActionButton
                  variant="dark-ghost"
                  size="xs"
                  onClick={() => {
                    setIsMobileMenuOpen(false);
                    requestLogout();
                  }}
                  icon={<LogOut className="w-3 h-3" />}
                  title="Logout from administrator session"
                  className="!bg-transparent !border-transparent hover:!bg-white/[0.08] text-[#9bb3a8]"
                >
                  Logout
                </ActionButton>
              ) : (
                <ActionButton
                  variant="forest"
                  size="xs"
                  onClick={() => openAuthModal()}
                  icon={<LogIn className="w-3 h-3" />}
                  title="Sign in with administrator passkey or credentials"
                >
                  Admin
                </ActionButton>
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
        animate={{ width: isCollapsed ? 68 : 254 }}
        transition={SPRING_GENTLE}
        className="hidden lg:flex glass-sidebar flex-col justify-between shrink-0 h-full z-30 overflow-hidden"
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
              className="fixed inset-0 bg-[#0b1713]/55 backdrop-blur-xs"
              onClick={() => setIsMobileMenuOpen(false)}
            />

            <motion.aside
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ duration: 0.22, ease: ROOMWISE_EASE }}
              className="relative w-72 max-w-[82vw] glass-sidebar shadow-2xl h-full flex flex-col z-50"
            >
              {renderSidebarInner(false)}
            </motion.aside>
          </div>
        )}
      </AnimatePresence>
    </>
  );
};
