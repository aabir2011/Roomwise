/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  OPERATING_HOURS_PER_DAY,
  ROOM_APPLIANCE_SPECS,
  SCHOOL_DAYS_PER_MONTH,
  SCHOOL_DAYS_PER_YEAR,
  TOTAL_CAMPUS_RATED_POWER_WATTS,
} from '../src/data/roomApplianceSpecs.ts';
import {
  AUTHORITATIVE_CAMPUS_FEATURES,
  OB_NB_COMBINED_MEASUREMENT,
  TOTAL_ACADEMIC_BUILDING_FOOTPRINT_M2,
  TOTAL_OUTDOOR_SPORTS_AREA_M2,
} from '../src/data/campusBuildingMeasurements.ts';
import { CANONICAL_CAMPUS_FULL_NAME, CANONICAL_INSTITUTION_NAME } from '../src/utils/voiceTerminology.ts';

export type RoomwiseModelTopic =
  | 'rcem'
  | 'bayesian_calibration'
  | 'school_wide_70_classroom_scenario'
  | 'intervention_counterfactual'
  | 'adaptive_control'
  | 'pvgis_solar_sizing'
  | 'space_intelligence_scoring'
  | 'campus_live'
  | 'digital_twin'
  | 'pir_sensor'
  | 'kw_vs_kwh'
  | 'roomwise_overview'
  | 'all';

export type ExplanationDepth =
  | 'conceptual'
  | 'mechanism'
  | 'mathematical'
  | 'validation';

export interface RoomwiseMathematicalModelSpec {
  id: Exclude<RoomwiseModelTopic, 'all'>;
  name: string;
  section: string;
  status: string;
  summary: string;
  /** Accessible plain-English explanation (Layer 1: default progressive disclosure, NO raw equations). */
  conceptualExplanation: string;
  /** How it operates step-by-step in ROOMWISE (Layer 2: mechanism). */
  mechanismExplanation: string;
  /** Honest validation, provenance, and limitation statement (Layer 4: proof/limits). */
  validationSummary: string;
  equations: Array<{ label: string; formula: string; units: string }>;
  variables: Record<string, string>;
  keyFacts: string[];
  limitations: string[];
}

export const ROOMWISE_MATHEMATICAL_MODELS: Record<
  Exclude<RoomwiseModelTopic, 'all'>,
  RoomwiseMathematicalModelSpec
> = {
  rcem: {
    id: 'rcem',
    name: 'ROOMWISE Counterfactual Energy Model (RCEM)',
    section: 'Energy History -> RCEM Mathematical Model',
    status: 'Model formulated for ROOMWISE; empirical meter-measured inputs are currently pending.',
    summary:
      'RCEM quantifies the counterfactual electrical energy difference (in kWh) between a Reference Operating Scenario (ROS) and ROOMWISE Adaptive Operation across matching non-overlapping time intervals.',
    conceptualExplanation:
      'RCEM (the ROOMWISE Counterfactual Energy Model) is the accounting framework ROOMWISE uses to evaluate how much electrical energy is avoided compared with a Reference Operating Scenario (ROS) without adaptive control. It compares what a classroom or campus would have consumed under conventional ROS operation against what it consumes with ROOMWISE Adaptive Operation across matching time intervals. A positive result means energy was avoided, zero means no difference, and a negative result means ROOMWISE used more energy than ROS—negative values are kept honestly and never forced to zero. Right now, RCEM is formulated mathematically, and physical meter readings for empirical validation are still pending. Ask if you would like to see its exact mathematical equations.',
    mechanismExplanation:
      'In practice, RCEM pairs each non-overlapping operating interval under ROOMWISE Adaptive Operation with its corresponding Reference Operating Scenario power draw P_ROS, takes the difference in watts, multiplies by the interval duration in hours, and converts watt-hours into kilowatt-hours (kWh). It can be evaluated either over discrete meter intervals or as a continuous integral over time-varying power traces, while keeping simulated ROS estimates and the separate 70-classroom survey-based potential savings estimate completely distinct from empirical meter validation.',
    validationSummary:
      'No—RCEM has not yet empirically proven ROOMWISE’s real-world savings. RCEM is currently a formulated mathematical model for ROOMWISE with empirical inputs pending; interval-level physical meter readings for Reference Operating Scenario (ROS) and ROOMWISE Adaptive Operation have not yet been collected, so empirical RCEM savings are not yet available. Overview’s Modelled Energy Avoided figures are simulation-based ROS estimates kept strictly separate from empirical meter verification.',
    equations: [
      {
        label: 'Discrete-Time Formulation (interval records)',
        formula: 'E_RCEM = (1 / 1000) × Σ_{i=1..N} (P_{ROS,i} − P_{RW,i}) × Δt_i',
        units: 'Power in W, Δt_i in h, E_RCEM in kWh (use 1 / 3,600,000 if Δt_i is in seconds)',
      },
      {
        label: 'Continuous-Time Formulation (time-varying traces)',
        formula: 'E_RCEM = (1 / 1000) × ∫_{t_0}^{t_1} [P_ROS(t) − P_RW(t)] dt',
        units: 'Power in W, time in h, E_RCEM in kWh',
      },
    ],
    variables: {
      E_RCEM: 'Counterfactual energy difference calculated by RCEM (kWh)',
      'P_{ROS,i} / P_ROS(t)':
        'Aggregate room power under the Reference Operating Scenario (ROS) during the matching interval (W)',
      'P_{RW,i} / P_RW(t)':
        'Aggregate room power under ROOMWISE Adaptive Operation during the matching interval (W)',
      'Δt_i': 'Duration of non-overlapping discrete comparison interval i (h)',
      N: 'Total number of non-overlapping discrete comparison intervals',
      't_0, t_1': 'Start and end of the continuous comparison period (h)',
      '1 / 1000': 'Exact conversion factor from watt-hours (Wh) to kilowatt-hours (kWh)',
    },
    keyFacts: [
      'Sign convention is intentionally unclamped: E_RCEM > 0 indicates energy avoided relative to ROS; E_RCEM = 0 indicates no difference; E_RCEM < 0 indicates ROOMWISE Adaptive Operation consumed more energy than ROS and is NEVER clamped to zero.',
      'Both discrete and continuous formulations express the exact same physical energy-difference integral, selected based on whether meter data is sampled over intervals or continuous traces.',
      'Overview simulation-modelled ROS estimates and the separate 70-classroom survey-based potential savings estimate are explicitly kept separate from empirical RCEM validation.',
    ],
    limitations: [
      'Interval-level physical meter readings for Reference Operating Scenario (ROS) and ROOMWISE Adaptive Operation have not yet been collected, so empirical RCEM results are currently pending.',
    ],
  },
  bayesian_calibration: {
    id: 'bayesian_calibration',
    name: 'Multi-Sensor Bayesian α / β Room Calibration Model',
    section: 'Classrooms & Digital Twin -> Room Telemetry & Calibration',
    status: 'Active in the 25-node simulated ROOMWISE control loop.',
    summary:
      'Each classroom node maintains learned physical coefficients — daylight penetration factor α (alpha) and thermal dissipation factor β (beta) — updated via Bayesian recalibration so closed-loop dimming and ventilation adapt to each room’s orientation and shading.',
    conceptualExplanation:
      'Bayesian α/β calibration lets each classroom learn its own daylight and heat characteristics instead of using one-size-fits-all rules. A bright upper-floor room learns a higher daylight factor (α) so ROOMWISE dims its LEDs more aggressively, while the thermal factor (β) tracks how quickly each room warms up or cools down so BLDC fans respond smoothly.',
    mechanismExplanation:
      'During recalibration, ROOMWISE compares outdoor daylight and thermal conditions against indoor LDR lux and DHT11 temperature readings to update each room’s α and β parameters. It then computes only the artificial lighting deficit needed to meet the room’s target lux.',
    validationSummary:
      'Active across all 25 calibrated simulated classroom nodes; physical ESP32/LDR/DHT11 field calibration is documented future architecture.',
    equations: [
      {
        label: 'Delivered Natural Daylight',
        formula: 'Lux_natural_delivered = Lux_outdoor_or_window × α',
        units: 'Lux (lx), with dimensionless α ∈ (0, 1)',
      },
      {
        label: 'Required Artificial LED Contribution',
        formula: 'Lux_deficit = max(0, Lux_target − Lux_natural_delivered)',
        units: 'Lux (lx)',
      },
    ],
    variables: {
      α: 'Learned daylight penetration factor specific to window orientation, floor, and exterior shading',
      β: 'Learned thermal dissipation / cooling response factor for room ventilation',
      Lux_target: 'Configured illumination target (standard classrooms vs. laboratories in Settings)',
    },
    keyFacts: [
      'Higher α rooms (e.g. bright south/upper-floor rooms) harvest more natural daylight and dim outer LED rows deeper.',
      'Administrators can trigger recalibration per classroom, per building block, or campus-wide.',
    ],
    limitations: [
      'Current sensor inputs (LDR lux, DHT11 temperature/humidity, PIR motion) come from ROOMWISE’s 25 calibrated simulated IoT nodes rather than live physical ESP32 hardware.',
    ],
  },
  school_wide_70_classroom_scenario: {
    id: 'school_wide_70_classroom_scenario',
    name: '70-Classroom School-Wide Reference Wastage Scenario',
    section: 'Energy Analytics & Audit Reference Scenario',
    status: 'Independent analytical reference scenario (separate from 25-node live telemetry and empirical RCEM).',
    summary:
      'An engineering scaling reference estimating annual avoided electricity and cost if automated vacancy shutoff prevents 80 minutes/day of empty-room appliance wastage across 70 conventional classrooms.',
    conceptualExplanation:
      'The 70-classroom school-wide reference scenario is an engineering projection estimating what a full-school deployment could save if automated vacancy shutoff eliminates 80 minutes per day of empty-room light and fan wastage. At 540 W per conventional classroom across 200 school days, that comes to 10,080 kWh and ₹70,560 per year (with an estimated reference payback of about 1.29 years). It is an analytical reference scenario—not meter-verified savings.',
    mechanismExplanation:
      'It multiplies a 540 W (0.54 kW) conventional classroom load by 80/60 hours/day to get 0.72 kWh/room/day, scales across 200 school days/year (144 kWh/room/year) and 70 classrooms (10,080 kWh/year), and values it at a ₹7/kWh reference tariff (₹70,560/year).',
    validationSummary:
      'This is a scenario-based engineering projection kept strictly separate from the 25-node live workspace and from empirical RCEM validation.',
    equations: [
      {
        label: 'Per-Classroom Daily Avoided Energy',
        formula: 'E_room_day = 0.54 kW × (80 / 60) h = 0.72 kWh/day',
        units: '540 W baseline (e.g. 4×40 W lights + 4×95 W conventional fans) over 1.333 h/day',
      },
      {
        label: 'Per-Classroom Annual Avoided Energy',
        formula: 'E_room_year = 0.72 kWh/day × 200 school days = 144 kWh/year',
        units: 'kWh/year per classroom',
      },
      {
        label: '70-Classroom Annual Campus Total & Tariff Value',
        formula: 'E_campus = 144 × 70 = 10,080 kWh/year; Cost = 10,080 × ₹7/kWh = ₹70,560/year',
        units: 'kWh/year and ₹/year (estimated reference payback ~1.29 years at ₹91,000 deployment reference)',
      },
    ],
    variables: {
      P_baseline_room: '540 W (0.54 kW) conventional classroom light + fan load',
      t_avoided: '80 minutes/day (1.333 h/day) of avoided unoccupied runtime',
      N_days: '200 school days/year reference calendar in the 70-room survey estimate',
      N_rooms: '70 classrooms across a full-school deployment',
      Tariff_ref: '₹7/kWh reference electricity tariff',
    },
    keyFacts: [
      'Produces exact reference figures: 540 W per classroom, 0.72 kWh/room/day, 144 kWh/room/year, 10,080 kWh/year across 70 classrooms, ₹70,560/year cost savings, and ~1.29 years estimated reference payback.',
      `Distinct from the 25-node live ROOMWISE workspace (which uses ${SCHOOL_DAYS_PER_MONTH} school days/month, ${SCHOOL_DAYS_PER_YEAR} school days/year, ${OPERATING_HOURS_PER_DAY} h/day, and installed rated capacity ${(TOTAL_CAMPUS_RATED_POWER_WATTS / 1000).toFixed(2)} kW across 25 rooms).`,
    ],
    limitations: [
      'This is a scenario-based engineering calculation, NOT meter-verified empirical savings.',
    ],
  },
  intervention_counterfactual: {
    id: 'intervention_counterfactual',
    name: 'Energy Intervention Ledger Counterfactual & Overlap-Prevention Model',
    section: 'Energy History -> Energy Intervention Ledger',
    status: 'Active in persistent SQLite ledger with strict provenance separation.',
    summary:
      'Calculates avoided energy for discrete logged interventions using dimensional watt-hour integration while preventing double-counting whenever multiple interventions overlap on the same room and circuit.',
    conceptualExplanation:
      'The Energy Intervention Ledger records each automated or manual energy-saving action—like turning off lights in a vacant room—and estimates the kWh avoided while preventing double-counting if two actions overlap on the same circuit. It also keeps simulated estimates strictly separate from meter-verified savings.',
    mechanismExplanation:
      'For each completed intervention, ROOMWISE subtracts post-action power from the baseline power over the non-overlapping effective duration on that room and circuit, trimming any intervals already counted by an earlier action.',
    validationSummary:
      'Active in SQLite; simulated interventions are labeled "estimated" and can never be promoted to "meter_verified" without real meter data.',
    equations: [
      {
        label: 'Dimensional Avoided Energy',
        formula: 'E_avoided = ((P_baseline − P_post) × Duration_hours) / 1000',
        units: 'Power in W, Duration in h, E_avoided in kWh',
      },
      {
        label: 'Overlap Interval Subtraction',
        formula: 'Effective_Interval = Intervention_Interval \\ ⋃ Prior_Counted_Intervals(same room + circuit)',
        units: 'Non-overlapping attributed seconds/hours',
      },
    ],
    variables: {
      P_baseline: 'Counterfactual baseline power before intervention (W)',
      P_post: 'Post-action power after curtailment/dimming (W)',
      verificationStatus: 'Strictly partitioned into "meter_verified" vs "estimated" (simulated)',
    },
    keyFacts: [
      'Grouped independent circuits (e.g. lighting + fans in the same room) are counted independently without falsely cancelling each other.',
      'Overlapping actions on the same room + circuit are trimmed or excluded so avoided kWh is never inflated.',
      'Incomplete actions (missing end timestamp, missing baseline, or cancelled) never fabricate savings.',
    ],
    limitations: [
      'Simulated intervention events can never be upgraded to meter_verified without physical meter backing.',
    ],
  },
  adaptive_control: {
    id: 'adaptive_control',
    name: 'Closed-Loop Adaptive Lighting, BLDC Fan & PIR Vacancy Control',
    section: 'Overview, Classrooms & Digital Twin',
    status: 'Active across all 25 calibrated classroom nodes.',
    summary:
      'Combines PIR motion sensing (presence/vacancy only — never student headcount), daylight harvesting via learned α, and thermal comfort curves to modulate LED dimming and BLDC ceiling fans automatically.',
    conceptualExplanation:
      'ROOMWISE adaptive control automatically dims classroom LEDs when natural daylight is strong, adjusts BLDC ceiling fans to match indoor temperature, and switches appliances off after a short inactivity grace period when PIR sensors detect no movement. Standard classrooms use only LED lights and BLDC fans, while AC is limited to specific labs, the Staff Room, and the Multipurpose Hall.',
    mechanismExplanation:
      'Every control tick evaluates PIR motion activity, natural daylight lux scaled by learned α, and thermal comfort curves to command per-fixture dimming and fan speed while allowing administrators to override or restore AUTO mode.',
    validationSummary:
      'Runs across 25 calibrated classroom nodes totaling 13.39 kW (13,390 W) installed rated maximum capacity across 268 appliances. Available Rated Headroom equals Installed Rated Max minus current live power draw; physical ESP32/MQTT hardware ingestion is documented future architecture.',
    equations: [
      {
        label: 'Installed Rated Capacity & Available Headroom',
        formula: 'Available Rated Headroom (W) = Installed Rated Max (13,390 W) − Current Live Power (W)',
        units: 'W and kW across 25 monitored rooms (268 installed appliances)',
      },
    ],
    variables: {
      PIR: 'Passive Infrared motion sensor — detects physical movement only, never counts students',
      Grace_Window: 'Configured inactivity grace period (minutes) before automatic vacancy shutoff',
      Selective_AC: 'Only ICT Lab, Senior Computer Lab, Physics Lab, Staff Room, and Multipurpose Hall have AC; standard classrooms use LED lights and BLDC fans only',
    },
    keyFacts: [
      'Installed Rated Maximum across the 25 monitored spaces is 13.39 kW (13,390 W); unused capacity below rated max is Available Rated Headroom rather than measured electricity savings.',
      `Daily energy models use Indian day-school hours (${OPERATING_HOURS_PER_DAY} h/day, ${SCHOOL_DAYS_PER_MONTH} school days/month, ${SCHOOL_DAYS_PER_YEAR} school days/year).`,
    ],
    limitations: [
      'Sensor Telemetry Ingestion Architecture (ESP32/MQTT/TLS) is documented future architecture; physical hardware is not yet connected.',
    ],
  },
  pvgis_solar_sizing: {
    id: 'pvgis_solar_sizing',
    name: 'PVGIS 5.3 Rooftop Solar Potential & Usable-Area Sizing Model',
    section: 'Environmental & Solar Intelligence -> Solar Potential',
    status: 'Live PVGIS 5.3 multi-year climatological planning model over verified building footprints.',
    summary:
      'Derives rooftop solar capacity (kWp) and monthly/annual generation (kWh) from verified horizontal academic building footprints, applying explicit usability/setback factors for Conservative, Moderate, and High-Theoretical planning scenarios.',
    conceptualExplanation:
      'PVGIS (Photovoltaic Geographical Information System, version 5.3) is a scientific solar-radiation and PV performance tool published by the European Commission Joint Research Centre. In ROOMWISE, PVGIS estimates how much monthly and annual rooftop solar electricity the five academic buildings at D A V Model School, IIT Kharagpur (2,366.80 m² combined verified footprint, excluding the Football Ground and Basketball Court) could generate under Conservative, Moderate, and High-Theoretical planning scenarios. These figures are planning estimates rather than a certified engineering design.',
    mechanismExplanation:
      'ROOMWISE applies roof usability and setback factors to each building’s verified footprint area to estimate installable solar capacity (kWp), then queries PVGIS 5.3 for IIT Kharagpur’s multi-year climatological specific yield (kWh per kWp per year) to project monthly and annual solar output against campus demand.',
    validationSummary:
      'PVGIS 5.3 returns real climatological solar estimates for IIT Kharagpur, but structural roof load, shading, and WBERC net-metering feasibility still require an on-site engineering survey.',
    equations: [
      {
        label: 'Usable Roof Area & Peak Capacity',
        formula: 'A_usable = A_footprint × f_usable;  kWp = A_usable / m²_per_kWp',
        units: 'Area in m², installed peak capacity in kWp',
      },
      {
        label: 'Annual Solar Generation (PVGIS 5.3)',
        formula: 'E_solar_year = kWp × Specific_Yield_PVGIS',
        units: 'kWh/year (planning estimate)',
      },
    ],
    variables: {
      A_footprint: `Authoritative horizontal footprint total = ${TOTAL_ACADEMIC_BUILDING_FOOTPRINT_M2.toFixed(2)} m² across 5 academic blocks`,
      f_usable: 'Scenario usability factor accounting for parapet setbacks, stairheads, water tanks, and shading',
      Specific_Yield_PVGIS: 'Location-specific kWh/kWp/year returned by European Commission PVGIS 5.3 for IIT Kharagpur coordinates',
    },
    keyFacts: [
      `Academic building footprints total ${TOTAL_ACADEMIC_BUILDING_FOOTPRINT_M2.toFixed(2)} m²: OB+NB connected complex ${OB_NB_COMBINED_MEASUREMENT.suppliedCombinedAreaM2.toFixed(2)} m², G+3 Block 601.55 m², Pre-Primary Block 387.53 m², Multipurpose Hall 168.51 m².`,
      `Outdoor sports grounds (${TOTAL_OUTDOOR_SPORTS_AREA_M2.toFixed(2)} m²: Football Ground 5,300.83 m² and Basketball Court 737.14 m²) are strictly excluded from building and rooftop solar totals.`,
    ],
    limitations: [
      'Planning estimate only — actual structural load, roof slope, shading, and WBERC net-metering approval require an on-site civil and electrical engineering survey.',
    ],
  },
  space_intelligence_scoring: {
    id: 'space_intelligence_scoring',
    name: 'Space Intelligence Attendance-Aware Allocation Model',
    section: 'Space Intelligence',
    status: 'Active over persistent SQLite attendance register & 25-room capacity database.',
    summary:
      'Compares register-recorded section attendance against room seating capacity and physics-derived operating wattage (using learned daylight α and heat-index curves) to propose energy-saving classroom reallocations.',
    conceptualExplanation:
      'Space Intelligence matches each class section’s register-recorded daily attendance against room seating capacity and energy efficiency, suggesting smarter classroom allocations when a small group is occupying an oversized or higher-load room. Attendance always comes from the imported school attendance register—never from PIR motion sensors.',
    mechanismExplanation:
      'It computes seating utilization from register attendance divided by room capacity, filters out incompatible rooms or rooms too small for the group, and ranks candidate moves by physics-derived wattage savings using each room’s daylight α and thermal profile.',
    validationSummary:
      'Active over persistent SQLite attendance and approval history; projected wattage savings are physics-derived estimates.',
    equations: [
      {
        label: 'Seating Utilization Ratio',
        formula: 'Utilization_% = (Attendance_recorded / Room_Max_Capacity) × 100',
        units: 'Percentage (%), strictly from imported attendance register — never from PIR sensors',
      },
    ],
    variables: {
      Enrolled_Strength: 'Static administrative roster count for a section',
      Attendance_Recorded: 'Daily headcount imported from the school attendance register',
      PIR_Activity: 'Live movement status only — explicitly separated from attendance headcount',
    },
    keyFacts: [
      'Never moves a section into a room smaller than its recorded attendance or incompatible with lab/special-room requirements.',
      'Tracks approval and rejection history transparently in SQLite.',
    ],
    limitations: [
      'Reallocation energy savings are physics-derived estimates until verified with interval metering.',
    ],
  },
  campus_live: {
    id: 'campus_live',
    name: 'CAMPUS LIVE 3D Interactive Campus Replica',
    section: 'Campus Live',
    status: 'Active 3D interactive model built from verified campus building footprints and live Open-Meteo sky sync.',
    summary:
      'An interactive 3D campus replica of D A V Model School, IIT Kharagpur showing all five academic blocks, outdoor landmarks, live energy overlays, weather-responsive sky lighting, and historical playback modes.',
    conceptualExplanation:
      'CAMPUS LIVE is an interactive 3D model of the D A V Model School, IIT Kharagpur campus built from the verified footprints of all five academic blocks—G+3 Block, New Building, Old Building (with its connecting path), Pre-Primary Block, and Multipurpose Hall—alongside Gates 1 and 2, the Football Ground, and the Basketball Court. It overlays live simulated energy intensity by block, syncs sky and sunlight to real Open-Meteo weather data, and lets you inspect Live, Today, Yesterday, or Last 7 Days activity.',
    mechanismExplanation:
      'CAMPUS LIVE renders the 3D WebGL scene using authoritative campus footprint geometry (2,366.80 m² across academic buildings), fetches Open-Meteo cloud cover and solar irradiance for dynamic lighting, and maps either live simulated node wattage or SQLite historical totals onto each building.',
    validationSummary:
      'Building footprints come from verified Google Maps measurements and weather/sky comes from live Open-Meteo data, while room energy overlays reflect ROOMWISE’s 25 calibrated simulated IoT nodes.',
    equations: [],
    variables: {},
    keyFacts: [
      'Includes all 5 academic blocks plus connecting OB–NB corridor, Gates 1 & 2, Football Ground, and Basketball Court.',
      'Supports Live, Today, Yesterday, and Last 7 Days playback modes.',
    ],
    limitations: [
      'Energy overlays reflect ROOMWISE’s simulated 25-node campus model rather than live physical sub-meters.',
    ],
  },
  digital_twin: {
    id: 'digital_twin',
    name: 'ROOMWISE Interactive Campus Digital Twin',
    section: 'Digital Twin',
    status: 'Active floor-by-floor architectural view across 25 monitored rooms.',
    summary:
      'An interactive floor-by-floor digital representation of all 5 academic blocks and 25 monitored rooms at D A V Model School, IIT Kharagpur, displaying real-time simulated power, PIR motion state, daylight, and calibration status.',
    conceptualExplanation:
      'The Digital Twin is an interactive floor-by-floor map of all five academic buildings and 25 monitored classrooms at D A V Model School, IIT Kharagpur. It represents each room’s live simulated power draw, PIR motion activity, indoor temperature, daylight lux, and appliance operating state in one spatial view so you can spot active loads, vacant waste, or manual overrides at a glance and click any room to inspect or control it.',
    mechanismExplanation:
      'Each room tile on the Digital Twin binds directly to ROOMWISE’s 25-node simulation engine, reflecting live appliance dimming/speed, learned α/β calibration parameters, and server-side RBAC controls when an administrator is signed in.',
    validationSummary:
      'Room layouts and footprints reflect the school’s verified campus structure, while live sensor and wattage values are driven by ROOMWISE’s calibrated simulation model until physical IoT hardware is installed.',
    equations: [],
    variables: {},
    keyFacts: [
      'Covers all 5 academic blocks (2,366.80 m² total academic footprint) and 25 rooms totaling 13.39 kW installed rated capacity.',
    ],
    limitations: [
      'Displays simulated IoT node telemetry rather than live physical ESP32 sensor feeds.',
    ],
  },
  pir_sensor: {
    id: 'pir_sensor',
    name: 'PIR (Passive Infrared) Motion Sensing in ROOMWISE',
    section: 'Classrooms & Adaptive Control',
    status: 'Simulated per-room motion detection in the 25-node campus model; hardware ESP32/PIR ingestion is planned.',
    summary:
      'PIR sensors detect changes in infrared heat patterns caused by physical movement to distinguish active rooms from vacant rooms—they never count individual students.',
    conceptualExplanation:
      'A PIR (Passive Infrared) sensor detects physical movement by sensing changes in infrared heat across its field of view—not by taking images or counting people. In ROOMWISE, PIR signals indicate whether motion is detected or whether a room has been quiet past its configured inactivity grace period so lights and fans can automatically shut off. Crucially, PIR sensors never measure student headcount; actual attendance numbers come separately from the school attendance register in Space Intelligence.',
    mechanismExplanation:
      'When movement triggers the PIR node, ROOMWISE marks the room as active and allows daylight- and temperature-based adaptive control. If no motion is detected for the configured grace window (for example, 5–10 minutes), ROOMWISE transitions the room to vacant and curtails non-essential lighting and fans.',
    validationSummary:
      'In the current ROOMWISE deployment, PIR activity is modeled across the 25 simulated classroom nodes; physical ESP32 + PIR hardware nodes are part of the documented future telemetry ingestion architecture.',
    equations: [],
    variables: {
      PIR: 'Passive Infrared sensor — detects movement/presence state only, never student headcount',
    },
    keyFacts: [
      'PIR detects motion presence vs. no recent motion—it NEVER counts how many students are inside a room.',
      'Inactivity grace periods prevent lights or fans from turning off while seated students are quietly writing or reading.',
    ],
    limitations: [
      'Stationary occupants or unlogged maintenance staff outside PIR coverage can produce false-vacant readings, which is why ROOMWISE uses a grace period and flags caveats in post-hours anomaly analysis.',
    ],
  },
  kw_vs_kwh: {
    id: 'kw_vs_kwh',
    name: 'Power (kW) vs. Electrical Energy (kWh)',
    section: 'Energy Fundamentals',
    status: 'Standard electrical physics definition applied consistently across ROOMWISE.',
    summary:
      'kW (kilowatts) measures instantaneous power—how fast electricity is being drawn right now—whereas kWh (kilowatt-hours) measures cumulative electrical energy used over time.',
    conceptualExplanation:
      'kW (kilowatts) measures instantaneous power—how fast electricity is being used at a single moment—just like speed on a car’s speedometer. kWh (kilowatt-hours) measures total electrical energy consumed over time—like the total distance shown on an odometer. For example, if a classroom draws 0.54 kW (540 W) continuously for 2 hours, it consumes 1.08 kWh of electrical energy (0.54 kW × 2 h). In ROOMWISE, live room loads are shown in W or kW, while daily, monthly, and billed consumption are measured in kWh.',
    mechanismExplanation:
      'ROOMWISE integrates instantaneous power draw (in W or kW) over each operating interval (in hours) to accumulate energy in kWh: Energy (kWh) = Power (kW) × Time (hours) = (Power in W × Time in hours) / 1000.',
    validationSummary:
      'Universal SI electrical physics relationship enforced across all ROOMWISE calculations, ledgers, and reports.',
    equations: [
      {
        label: 'Energy from Power and Duration',
        formula: 'Energy (kWh) = Power (kW) × Time (h) = (Power (W) × Time (h)) / 1000',
        units: 'Power in kW or W, Time in hours (h), Energy in kWh',
      },
    ],
    variables: {
      'W / kW': 'Instantaneous electrical power (1 kW = 1,000 W)',
      'Wh / kWh': 'Cumulative electrical energy consumed over time (1 kWh = 1,000 Wh)',
    },
    keyFacts: [
      'Utility bills and carbon emissions are calculated on energy (kWh), while circuit and breaker limits depend on power (W / kW).',
    ],
    limitations: [],
  },
  roomwise_overview: {
    id: 'roomwise_overview',
    name: 'ROOMWISE — Adaptive Campus Energy Management System',
    section: 'Overview',
    status: 'Active interactive web application for D A V Model School, IIT Kharagpur.',
    summary:
      'ROOMWISE is an adaptive campus energy management platform designed for D A V Model School, IIT Kharagpur to monitor classrooms, model daylight and occupancy-driven energy savings, analyze historical consumption, evaluate rooftop solar potential, and guide space allocation.',
    conceptualExplanation:
      'ROOMWISE is an adaptive campus energy management system built for D A V Model School, IIT Kharagpur. It models 25 classrooms across five academic blocks—combining adaptive LED daylight dimming, BLDC fan control, PIR vacancy detection, an interactive Digital Twin, a 3D CAMPUS LIVE view, historical energy analytics, an Intervention Ledger, Space Intelligence, and PVGIS rooftop solar feasibility—so school administrators can understand energy use and reduce waste transparently.',
    mechanismExplanation:
      'It pairs a 25-node calibrated classroom simulation and SQLite historical database with live Open-Meteo weather/air-quality feeds, European Commission PVGIS 5.3 solar modeling over verified building footprints, and role-based administrator controls.',
    validationSummary:
      'Weather and PVGIS solar data are live external scientific sources and building footprints are verified measurements, while classroom power and sensor telemetry currently run on ROOMWISE’s calibrated simulation model rather than live physical meters.',
    equations: [],
    variables: {},
    keyFacts: [
      'Monitors 25 rooms across G+3 Block, New Building, Old Building, Pre-Primary Block, and Multipurpose Hall (13.39 kW installed rated max).',
    ],
    limitations: [
      'Physical ESP32 hardware sensors and physical sub-meters are documented future architecture; current classroom readings are simulated.',
    ],
  },
};

/**
 * Progressive-disclosure formatter: matches explanation depth to what the user actually asked!
 * - 'conceptual' (default for "Explain RCEM", "What is PVGIS?", "How does PIR work?") -> accessible plain English, NO raw equations.
 * - 'mechanism' ("How does RCEM calculate savings?") -> conceptual + step-by-step operating mechanism.
 * - 'mathematical' ("Show me the mathematical formulation / equations / derivation of RCEM") -> exact formulas, variable definitions, units, sign convention, and honest status.
 * - 'validation' ("Has RCEM proven ROOMWISE's savings?", "Are the sensors real?") -> direct, honest validation/evidence status and limitations.
 */
export function formatProgressiveKnowledgeReply(
  spec: RoomwiseMathematicalModelSpec,
  depth: ExplanationDepth
): string {
  if (depth === 'validation') {
    const parts = [spec.validationSummary];
    if (spec.limitations.length > 0 && !spec.validationSummary.includes(spec.limitations[0].slice(0, 28))) {
      parts.push(`Limitation: ${spec.limitations[0]}`);
    }
    return parts.join(' ');
  }

  if (depth === 'mathematical') {
    const parts: string[] = [`${spec.name}: ${spec.summary}`];
    if (spec.equations.length > 0) {
      const eqLines = spec.equations
        .map((eq) => `${eq.label}: ${eq.formula} (${eq.units})`)
        .join('; ');
      parts.push(`Equations — ${eqLines}.`);
    }
    const varEntries = Object.entries(spec.variables);
    if (varEntries.length > 0) {
      const varLines = varEntries
        .slice(0, 7)
        .map(([k, v]) => `${k}: ${v}`)
        .join('; ');
      parts.push(`Variables — ${varLines}.`);
    }
    if (spec.keyFacts[0]) {
      parts.push(spec.keyFacts[0]);
    }
    if (spec.status) {
      parts.push(`Status: ${spec.status}`);
    }
    return parts.join(' ');
  }

  if (depth === 'mechanism') {
    return `${spec.conceptualExplanation} ${spec.mechanismExplanation}`;
  }

  // Default: accessible, clear conceptual explanation first (progressive disclosure!)
  return spec.conceptualExplanation;
}

export function getCampusArchitectureAndFootprintsSummary() {
  const academicBuildings = AUTHORITATIVE_CAMPUS_FEATURES.filter((f) => f.isBuildingFootprint).map(
    (b) => ({
      id: b.id,
      name: b.name,
      shortCode: b.shortLabel,
      footprintAreaM2: b.authoritativeFootprintAreaM2,
      footprintAreaFt2: b.authoritativeFootprintAreaFt2,
      perimeterM: b.suppliedPerimeterM ?? b.combinedComplexRef?.suppliedCombinedPerimeterM ?? null,
      measurementSource: b.measurementSource,
      roofEligibility: b.solarEligible,
    })
  );

  const excludedOutdoorAreas = AUTHORITATIVE_CAMPUS_FEATURES.filter((f) => !f.isBuildingFootprint).map(
    (s) => ({
      id: s.id,
      name: s.name,
      areaM2: s.authoritativeFootprintAreaM2,
      areaFt2: s.authoritativeFootprintAreaFt2,
      perimeterM: s.suppliedPerimeterM,
      excludedFromBuildingAndSolarTotals: true,
    })
  );

  return {
    institution: CANONICAL_INSTITUTION_NAME,
    campus: CANONICAL_CAMPUS_FULL_NAME,
    monitoredRoomsCount: ROOM_APPLIANCE_SPECS.length,
    installedRatedCapacityWatts: TOTAL_CAMPUS_RATED_POWER_WATTS,
    installedRatedCapacityKW: Number((TOTAL_CAMPUS_RATED_POWER_WATTS / 1000).toFixed(2)),
    totalAcademicBuildingFootprintM2: TOTAL_ACADEMIC_BUILDING_FOOTPRINT_M2,
    totalExcludedOutdoorSportsAreaM2: TOTAL_OUTDOOR_SPORTS_AREA_M2,
    academicBuildings,
    excludedOutdoorAreas,
    digitalTwinSummary:
      'The Digital Twin provides an interactive floor-by-floor architectural layout across all 5 academic blocks of D A V Model School, IIT Kharagpur (G+3 Block, New Building, Old Building, Pre-Primary Block, Multipurpose Hall), showing live room power draw, PIR motion state, daylight lux, learned α/β calibration, and direct room inspection.',
    campusLiveSummary:
      'CAMPUS LIVE renders the 1:1 3D campus replica using the authoritative building footprints, with live energy overlays, connecting OB–NB corridor, Gates 1 & 2, Football Ground, Basketball Court, Open-Meteo sky/radiation sync, and Live / Today / Yesterday / Last 7 Days playback modes.',
  };
}
