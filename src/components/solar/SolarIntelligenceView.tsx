/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { EnvironmentalSolarView } from '../environment/EnvironmentalSolarView';

interface SolarIntelligenceViewProps {
  embedded?: boolean;
  onNavigateEnvironmental?: () => void;
}

/**
 * Compatibility wrapper directing any legacy SolarIntelligenceView imports
 * into the consolidated Environmental & Solar rooftop assessment workspace.
 */
export const SolarIntelligenceView: React.FC<SolarIntelligenceViewProps> = () => {
  return <EnvironmentalSolarView initialTab="solar-potential" />;
};
