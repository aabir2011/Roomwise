/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Sigma } from 'lucide-react';
import { MathText } from '../common/MathText';

const DISCRETE_EQUATION_TEX =
  '\\boxed{E_{\\mathrm{RCEM}}=\\frac{1}{1000}\\sum_{i=1}^{N}(P_{\\mathrm{B},i}-P_{\\mathrm{RW},i})\\Delta t_i}';

const CONTINUOUS_EQUATION_TEX =
  '\\boxed{E_{\\mathrm{RCEM}}=\\frac{1}{1000}\\int_{t_0}^{t_1}\\left[P_{\\mathrm{B}}(t)-P_{\\mathrm{RW}}(t)\\right]dt}';

interface VariableDefinition {
  tex: string;
  ariaLabel: string;
  description: string;
  unit: string;
}

const VARIABLE_DEFINITIONS: VariableDefinition[] = [
  {
    tex: 'E_{\\mathrm{RCEM}}',
    ariaLabel: 'E sub RCEM',
    description: 'Energy difference calculated by RCEM',
    unit: 'kWh',
  },
  {
    tex: 'P_{\\mathrm{B},i}',
    ariaLabel: 'P sub B comma i',
    description: 'Aggregate room power under the defined baseline condition during discrete interval i',
    unit: 'W',
  },
  {
    tex: 'P_{\\mathrm{RW},i}',
    ariaLabel: 'P sub RW comma i',
    description: 'Aggregate room power under ROOMWISE operation during the corresponding interval',
    unit: 'W',
  },
  {
    tex: '\\Delta t_i',
    ariaLabel: 'Delta t sub i',
    description: 'Duration of discrete interval i',
    unit: 'h',
  },
  {
    tex: 'N',
    ariaLabel: 'N',
    description: 'Number of non-overlapping discrete comparison intervals',
    unit: 'count',
  },
  {
    tex: 'P_{\\mathrm{B}}(t)',
    ariaLabel: 'P sub B of t',
    description: 'Time-varying aggregate baseline power',
    unit: 'W',
  },
  {
    tex: 'P_{\\mathrm{RW}}(t)',
    ariaLabel: 'P sub RW of t',
    description: 'Time-varying aggregate ROOMWISE power',
    unit: 'W',
  },
  {
    tex: 't_0,\\,t_1',
    ariaLabel: 't sub 0 and t sub 1',
    description: 'Beginning and end of the continuous comparison period',
    unit: 'h',
  },
  {
    tex: '\\tfrac{1}{1000}',
    ariaLabel: '1 divided by 1000',
    description: 'Conversion factor from watt-hours to kilowatt-hours',
    unit: 'kWh/Wh',
  },
];

const SIGN_INTERPRETATIONS = [
  {
    tex: 'E_{\\mathrm{RCEM}} > 0',
    ariaLabel: 'E sub RCEM greater than zero',
    label: 'Positive result',
    meaning: 'Energy avoided relative to the defined baseline.',
    tone: 'text-emerald-800',
  },
  {
    tex: 'E_{\\mathrm{RCEM}} = 0',
    ariaLabel: 'E sub RCEM equals zero',
    label: 'Zero result',
    meaning: 'No energy difference between baseline and ROOMWISE operation.',
    tone: 'text-[#4a5851]',
  },
  {
    tex: 'E_{\\mathrm{RCEM}} < 0',
    ariaLabel: 'E sub RCEM less than zero',
    label: 'Negative result',
    meaning: 'ROOMWISE consumed more energy than the baseline (retained without clamping to zero).',
    tone: 'text-rose-800',
  },
];

const FUTURE_PROVENANCE_REQUIREMENTS: React.ReactNode[] = [
  'Meter-measured baseline power vs. meter-measured ROOMWISE power.',
  'Explicit separation from model-estimated power and scenario-assumed power (including the separate 70-classroom survey estimate).',
  'Discrete measurement intervals or continuous time-series records with non-overlapping bounds.',
  <>
    Measurement duration, explicit units (watts and hours, or seconds with{' '}
    <MathText tex="1/3{,}600{,}000" ariaLabel="1 divided by 3,600,000" /> scaling), data
    provenance, and calculation assumptions.
  </>,
];

export const RcemModelPanel: React.FC = () => {
  return (
    <section
      id="rcem-model-panel"
      aria-labelledby="rcem-panel-heading"
      className="rw-surface rounded-2xl p-5 sm:p-7 space-y-6 scroll-mt-6"
    >
      {/* Panel Header */}
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-3 pb-4 border-b border-neutral-200/80">
        <div className="space-y-1.5 min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] font-semibold text-emerald-800">
            <Sigma className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>Mathematical Specification</span>
            <span aria-hidden="true" className="text-neutral-300">·</span>
            <span className="text-[#4a5851] font-medium">
              Model formulated for ROOMWISE · Empirical inputs pending
            </span>
          </div>
          <h2
            id="rcem-panel-heading"
            className="text-base sm:text-lg font-bold text-[#111815] tracking-tight leading-snug"
          >
            ROOMWISE Counterfactual Energy Model (RCEM)
          </h2>
          <p className="text-xs sm:text-[13px] text-[#4a5851] leading-relaxed max-w-3xl">
            RCEM calculates the difference between reference and ROOMWISE power across
            corresponding time intervals, accumulating that difference over time to estimate energy
            avoided.
          </p>
        </div>

        <div className="text-[11px] font-mono text-[#64726b] tabular-nums shrink-0 md:text-right">
          <div>Specification Only</div>
          <div>Empirical outputs unavailable</div>
        </div>
      </div>

      {/* Visible Current-Stage Disclosure */}
      <div
        role="note"
        aria-label="RCEM current empirical status"
        className="px-4 sm:px-5 py-3.5 rounded-xl bg-[#f3f5f4] border border-neutral-200/90 space-y-1"
      >
        <div className="text-xs font-semibold text-[#111815]">
          Model formulated for ROOMWISE · Empirical inputs pending
        </div>
        <p className="text-xs text-[#4a5851] leading-relaxed">
          The RCEM mathematical formulation has been developed specifically for ROOMWISE in
          discrete-time and continuous-time forms. Actual interval-level baseline and ROOMWISE
          power readings have not yet been collected. Numerical RCEM results and empirical
          validation are therefore not currently available.
        </p>
      </div>

      {/* Two Exact Typeset Formulations */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5">
        {/* A. Discrete-time formulation */}
        <div className="rounded-xl bg-[#fafbfb] rw-card-alive border border-neutral-200/85 p-4 sm:p-5 flex flex-col justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-xs sm:text-[13px] font-bold text-[#111815]">
                A. Discrete-Time Formulation
              </h3>
              <span className="text-[11px] font-mono text-[#64726b]">
                Interval records
              </span>
            </div>
            <p className="text-xs text-[#4a5851] leading-relaxed">
              Used when power information is available as individual measurements or records over
              defined, non-overlapping time intervals. It accumulates the power difference
              multiplied by each interval&apos;s duration.
            </p>
          </div>

          <div className="py-2 border-y border-neutral-200/75 bg-white/85 rounded-lg">
            <MathText
              tex={DISCRETE_EQUATION_TEX}
              display
              className="text-[#111815] text-[15px] sm:text-[17px]"
              ariaLabel="Discrete-time RCEM equation: E sub RCEM equals 1 divided by 1000 times the sum from i equals 1 to N of P sub B comma i minus P sub RW comma i, all times Delta t sub i, enclosed in a box."
            />
          </div>

          <p className="text-[11px] text-[#64726b]">
            Assumes power in watts (W) and interval duration{' '}
            <MathText tex="\Delta t_i" ariaLabel="Delta t sub i" className="text-[#111815]" /> in hours (h).
          </p>
        </div>

        {/* B. Continuous-time formulation */}
        <div className="rounded-xl bg-[#fafbfb] rw-card-alive-alt border border-neutral-200/85 p-4 sm:p-5 flex flex-col justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-xs sm:text-[13px] font-bold text-[#111815]">
                B. Continuous-Time Formulation
              </h3>
              <span className="text-[11px] font-mono text-[#64726b]">
                General time-varying form
              </span>
            </div>
            <p className="text-xs text-[#4a5851] leading-relaxed">
              The general representation for continuously varying power. It integrates the
              difference between baseline and ROOMWISE power over the comparison period.
            </p>
          </div>

          <div className="py-2 border-y border-neutral-200/75 bg-white/85 rounded-lg">
            <MathText
              tex={CONTINUOUS_EQUATION_TEX}
              display
              className="text-[#111815] text-[15px] sm:text-[17px]"
              ariaLabel="Continuous-time RCEM equation: E sub RCEM equals 1 divided by 1000 times the integral from t sub 0 to t sub 1 of P sub B of t minus P sub RW of t with respect to t, enclosed in a box."
            />
          </div>

          <p className="text-[11px] text-[#64726b]">
            Assumes power in watts (W) and time in hours (h). If time is expressed in seconds, the
            conversion factor becomes{' '}
            <MathText tex="1/3{,}600{,}000" ariaLabel="1 divided by 3,600,000" className="text-[#111815]" /> rather than{' '}
            <MathText tex="1/1000" ariaLabel="1 divided by 1000" className="text-[#111815]" />.
          </p>
        </div>
      </div>

      {/* Equivalence & Counterfactual Explanation */}
      <p className="text-xs text-[#4a5851] leading-relaxed">
        <span className="font-semibold text-[#111815]">Relationship between representations:</span>{' '}
        Both equations express the same counterfactual energy-difference principle. They are
        alternative mathematical forms selected according to whether empirical power inputs are
        recorded across discrete non-overlapping intervals or as continuous time-series traces.
      </p>

      {/* Variable Definitions */}
      <div className="space-y-3 pt-1">
        <div className="flex flex-wrap items-baseline justify-between gap-2 pb-2 border-b border-neutral-200/75">
          <h3 className="text-xs sm:text-[13px] font-bold text-[#111815]">
            Variable Definitions &amp; Units
          </h3>
          <span className="text-[11px] font-mono text-[#64726b]">
            Power in watts (W) · Time in hours (h)
          </span>
        </div>

        <dl className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-3 text-xs">
          {VARIABLE_DEFINITIONS.map((v) => (
            <div
              key={v.ariaLabel}
              className="flex items-start gap-3 py-1.5 border-b border-neutral-200/55"
            >
              <dt className="w-16 shrink-0 font-medium text-[#111815] pt-0.5">
                <MathText tex={v.tex} ariaLabel={v.ariaLabel} className="text-[#111815]" />
              </dt>
              <dd className="min-w-0 flex-1 text-[#4a5851] leading-relaxed">
                <span>{v.description}</span>
                <span className="ml-1.5 font-mono text-[11px] text-[#64726b]">({v.unit})</span>
              </dd>
            </div>
          ))}
        </dl>
      </div>

      {/* Sign Convention + Future Empirical Integration Readiness */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 pt-2 border-t border-neutral-200/75">
        {/* Sign Interpretation */}
        <div className="space-y-2.5">
          <h3 className="text-xs sm:text-[13px] font-bold text-[#111815]">
            Sign Interpretation (Unclamped)
          </h3>
          <div className="divide-y divide-neutral-200/70 border-y border-neutral-200/70">
            {SIGN_INTERPRETATIONS.map((item) => (
              <div
                key={item.label}
                className="py-2.5 flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-3 text-xs"
              >
                <div className="w-36 shrink-0 flex items-center gap-2">
                  <MathText tex={item.tex} ariaLabel={item.ariaLabel} className="text-[#111815]" />
                </div>
                <div className="min-w-0 flex-1">
                  <span className={`font-semibold ${item.tone}`}>{item.label}:</span>{' '}
                  <span className="text-[#4a5851]">{item.meaning}</span>
                </div>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-[#64726b] leading-relaxed">
            Negative values are never clamped to zero so periods where ROOMWISE draws more power
            than the baseline remain transparently visible.
          </p>
        </div>

        {/* Future Empirical Data & Provenance Boundaries */}
        <div className="space-y-2.5">
          <h3 className="text-xs sm:text-[13px] font-bold text-[#111815]">
            Data Provenance Boundaries for Future Empirical Integration
          </h3>
          <p className="text-xs text-[#4a5851] leading-relaxed">
            Existing operational telemetry and simulated intervention records shown elsewhere in
            Energy History are not treated as measured RCEM evidence, and the separate 70-classroom
            survey wastage calculation remains independent. When empirical meter data is collected,
            future RCEM calculations will distinguish:
          </p>
          <ul className="space-y-1.5 text-xs text-[#4a5851]">
            {FUTURE_PROVENANCE_REQUIREMENTS.map((req, idx) => (
              <li key={idx} className="flex items-start gap-2 leading-relaxed">
                <span className="text-emerald-700 font-bold shrink-0" aria-hidden="true">
                  ·
                </span>
                <span>{req}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
};
