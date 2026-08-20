#!/usr/bin/env node

import assert from "node:assert/strict";

const assumptions = {
  asOf: "2026-08-20",
  usdPerEur: 1.1567,
  vatRate: 0.21,
  recommendedPriceTaxTreatment: "plus_applicable_vat",
  paymentRate: 0.015,
  billingRate: 0.007,
  stripeTaxRate: 0.005,
  paymentFixedEur: 0.25,
  openRouterFundingRate: 0.055,
  managedSpendLimitUsd: 0.5,
  infrastructureEurPerActiveTenant: 1,
  infrastructureSensitivityEur: [0.25, 1, 1.5],
  supportReserveEurPerActiveTenant: 2,
  supportHourlyRateEur: 30,
  // The €1 base infrastructure allocation is split only to make both cost classes
  // explicit. The total, not the split, is the decision input.
  computeEurPerActiveTenant: 0.65,
  storageBackupEurPerActiveTenant: 0.35,
};

const ratesUsdPerMillion = {
  deepseek: { input: 0.2574, output: 1.0287, cachedInput: 0.02574 },
  geminiVision: { input: 0.25, output: 1.5, cachedInput: 0.025 },
};

// Anonymized 30-day production averages. Token counts are reliable; the stored
// dollar estimates are deliberately not used to price the recommended model mix.
const observed = {
  stores: 86,
  asks: 44,
  images: 15,
  backlogExtractions: 6,
  composeCalls: 127,
  operations: {
    classify: { input: 11007.7, output: 373.2, cachedInput: 712.9 },
    compose: { input: 4109.6, output: 2477.3, cachedInput: 193 },
    answer: { input: 8167.9, output: 679.2, cachedInput: 2792.7 },
    extractBacklog: { input: 14530, output: 3752.5, cachedInput: 21.3 },
    describeImage: { input: 1131.4, output: 164.1, cachedInput: 0 },
  },
};

const plans = {
  managedMonthly: { mode: "managed", cadence: "monthly", customerChargeEur: 5, months: 1 },
  managedAnnual: { mode: "managed", cadence: "annual", customerChargeEur: 50, months: 12 },
  byokMonthly: { mode: "byok", cadence: "monthly", customerChargeEur: 4, months: 1 },
  byokAnnualCandidate: { mode: "byok", cadence: "annual", customerChargeEur: 40, months: 12 },
};

const scenarios = {
  light: { stores: 10, asks: 10, images: 0 },
  typical: { stores: 30, asks: 20, images: 5 },
  allowanceEdge: { stores: 40, asks: 25, images: 5 },
  founderEquivalent: { stores: 86, asks: 44, images: 15 },
  heavy: { stores: 100, asks: 100, images: 20 },
  abuse: { stores: 500, asks: 500, images: 100 },
};

const round = (value, places = 4) => Number(value.toFixed(places));

function tokenCostUsd(tokens, rate) {
  return (
    tokens.input * rate.input +
    tokens.output * rate.output +
    tokens.cachedInput * rate.cachedInput
  ) / 1_000_000;
}

const composeCallsPerStore = observed.composeCalls / observed.stores;
const backlogCallsPerStore = observed.backlogExtractions / observed.stores;
const operationCostUsd = {
  classify: tokenCostUsd(observed.operations.classify, ratesUsdPerMillion.deepseek),
  compose: tokenCostUsd(observed.operations.compose, ratesUsdPerMillion.deepseek),
  answer: tokenCostUsd(observed.operations.answer, ratesUsdPerMillion.deepseek),
  extractBacklog: tokenCostUsd(observed.operations.extractBacklog, ratesUsdPerMillion.deepseek),
  describeImage: tokenCostUsd(observed.operations.describeImage, ratesUsdPerMillion.geminiVision),
};
const providerSpendPerActionUsd = {
  store:
    operationCostUsd.classify +
    composeCallsPerStore * operationCostUsd.compose +
    backlogCallsPerStore * operationCostUsd.extractBacklog,
  ask: operationCostUsd.answer,
  image: operationCostUsd.describeImage,
};

function scenarioEconomics(input) {
  const providerSpendUsd =
    input.stores * providerSpendPerActionUsd.store +
    input.asks * providerSpendPerActionUsd.ask +
    input.images * providerSpendPerActionUsd.image;
  const managedProviderSpendUsd = Math.min(providerSpendUsd, assumptions.managedSpendLimitUsd);
  return {
    ...input,
    providerSpendUsd: round(providerSpendUsd, 6),
    operatorCashCostUncappedEur: round(
      providerSpendUsd * (1 + assumptions.openRouterFundingRate) / assumptions.usdPerEur,
      4,
    ),
    operatorCashCostManagedEur: round(
      managedProviderSpendUsd * (1 + assumptions.openRouterFundingRate) / assumptions.usdPerEur,
      4,
    ),
    capReached: providerSpendUsd > assumptions.managedSpendLimitUsd,
  };
}

const scenarioOutput = Object.fromEntries(
  Object.entries(scenarios).map(([name, input]) => [name, scenarioEconomics(input)]),
);

function planRevenue(plan, vatTreatment = "plus") {
  const collectedEur =
    vatTreatment === "plus"
      ? plan.customerChargeEur * (1 + assumptions.vatRate)
      : plan.customerChargeEur;
  const monthlyGrossEur = collectedEur / plan.months;
  const monthlyNetRevenueEur =
    (vatTreatment === "inclusive"
      ? plan.customerChargeEur / (1 + assumptions.vatRate)
      : plan.customerChargeEur) / plan.months;
  const paymentFeesEur =
    (collectedEur *
      (assumptions.paymentRate + assumptions.billingRate + assumptions.stripeTaxRate) +
      assumptions.paymentFixedEur) /
    plan.months;
  return { monthlyGrossEur, monthlyNetRevenueEur, paymentFeesEur };
}

function margin(plan, scenario, overrides = {}) {
  const revenue = planRevenue(plan, overrides.vatTreatment ?? "plus");
  const infrastructureEur =
    overrides.infrastructureEur ?? assumptions.infrastructureEurPerActiveTenant;
  const supportEur = overrides.supportEur ?? assumptions.supportReserveEurPerActiveTenant;
  const modelEur = plan.mode === "managed" ? scenario.operatorCashCostManagedEur : 0;
  const contributionEur =
    revenue.monthlyNetRevenueEur -
    revenue.paymentFeesEur -
    infrastructureEur -
    supportEur -
    modelEur;
  const contributionBeforeSupportEur = contributionEur + supportEur;
  return {
    monthlyGrossEur: round(revenue.monthlyGrossEur, 4),
    monthlyNetRevenueEur: round(revenue.monthlyNetRevenueEur, 4),
    paymentFeesEur: round(revenue.paymentFeesEur, 4),
    infrastructureEur: round(infrastructureEur, 4),
    supportReserveEur: round(supportEur, 4),
    modelEur: round(modelEur, 4),
    contributionEur: round(contributionEur, 4),
    contributionAsPercentOfNetRevenue: round(
      100 * contributionEur / revenue.monthlyNetRevenueEur,
      1,
    ),
    breakEvenSupportMinutesAtThirtyEurPerHour: round(
      contributionBeforeSupportEur / assumptions.supportHourlyRateEur * 60,
      2,
    ),
  };
}

const margins = {};
for (const [planName, plan] of Object.entries(plans)) {
  margins[planName] = {};
  for (const [scenarioName, scenario] of Object.entries(scenarioOutput)) {
    margins[planName][scenarioName] = margin(plan, scenario);
  }
}

const sensitivity = {};
for (const infrastructureEur of assumptions.infrastructureSensitivityEur) {
  const key = `infra_${infrastructureEur.toFixed(2)}`;
  sensitivity[key] = {
      managedMonthlyAllowance: margin(plans.managedMonthly, scenarioOutput.allowanceEdge, {
      infrastructureEur,
    }),
      managedAnnualAllowance: margin(plans.managedAnnual, scenarioOutput.allowanceEdge, {
      infrastructureEur,
    }),
    byokMonthly: margin(plans.byokMonthly, scenarioOutput.typical, { infrastructureEur }),
  };
}

for (const supportMinutes of [0, 2, 5, 10]) {
  const supportEur = supportMinutes / 60 * assumptions.supportHourlyRateEur;
  sensitivity[`support_${supportMinutes}_minutes`] = {
    managedMonthlyTypical: margin(plans.managedMonthly, scenarioOutput.typical, { supportEur }),
    managedAnnualTypical: margin(plans.managedAnnual, scenarioOutput.typical, { supportEur }),
    byokMonthly: margin(plans.byokMonthly, scenarioOutput.typical, { supportEur }),
  };
}

sensitivity.vat_treatment = {
  managedMonthlyTypicalPlusVat: margin(plans.managedMonthly, scenarioOutput.typical),
  managedMonthlyTypicalVatInclusive: margin(plans.managedMonthly, scenarioOutput.typical, { vatTreatment: "inclusive" }),
  managedMonthlyTypicalReverseCharge: margin(plans.managedMonthly, scenarioOutput.typical, { vatTreatment: "none" }),
  managedAnnualTypicalPlusVat: margin(plans.managedAnnual, scenarioOutput.typical),
  managedAnnualTypicalVatInclusive: margin(plans.managedAnnual, scenarioOutput.typical, { vatTreatment: "inclusive" }),
  byokMonthlyPlusVat: margin(plans.byokMonthly, scenarioOutput.typical),
  byokMonthlyVatInclusive: margin(plans.byokMonthly, scenarioOutput.typical, { vatTreatment: "inclusive" }),
};

const scenarioNames = Object.keys(scenarioOutput);
const compactMargins = Object.fromEntries(
  Object.entries(margins).map(([planName, rows]) => [
    planName,
    Object.fromEntries(
      scenarioNames.map((scenarioName) => {
        const row = rows[scenarioName];
        return [
          scenarioName,
          {
            modelEur: row.modelEur,
            contributionEur: row.contributionEur,
            contributionAsPercentOfNetRevenue: row.contributionAsPercentOfNetRevenue,
            breakEvenSupportMinutesAtThirtyEurPerHour: row.breakEvenSupportMinutesAtThirtyEurPerHour,
          },
        ];
      }),
    ),
  ]),
);

const compactSensitivity = Object.fromEntries(
  Object.entries(sensitivity).map(([name, rows]) => [
    name,
    Object.fromEntries(
      Object.entries(rows).map(([rowName, row]) => [rowName, row.contributionEur]),
    ),
  ]),
);

const output = {
  assumptions,
  ratesUsdPerMillion,
  observedMix: {
    composeCallsPerStore: round(composeCallsPerStore, 4),
    backlogCallsPerStore: round(backlogCallsPerStore, 4),
  },
  providerSpendPerActionUsd: Object.fromEntries(
    Object.entries(providerSpendPerActionUsd).map(([key, value]) => [key, round(value, 6)]),
  ),
  scenarios: scenarioOutput,
  planRevenue: Object.fromEntries(
    Object.entries(plans).map(([name, plan]) => [
      name,
      Object.fromEntries(
        Object.entries(planRevenue(plan)).map(([key, value]) => [key, round(value, 4)]),
      ),
    ]),
  ),
  margins: compactMargins,
  contributionSensitivityEur: compactSensitivity,
};

const rendered = `${JSON.stringify(output, null, 2)}\n`;
if (process.argv.includes("--check")) {
  const closeTo = (actual, expected, epsilon = 0.0001) =>
    assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);
  closeTo(scenarioOutput.typical.providerSpendUsd, 0.333066, 0.000001);
  closeTo(scenarioOutput.abuse.operatorCashCostManagedEur, 0.456);
  closeTo(margins.managedMonthly.allowanceEdge.contributionEur, 1.1867);
  closeTo(margins.managedAnnual.allowanceEdge.contributionEur, 0.6098);
  closeTo(margins.byokMonthly.typical.contributionEur, 0.6193);
  assert.equal(margins.managedMonthly.abuse.modelEur, margins.managedMonthly.founderEquivalent.modelEur);
  assert.ok(margins.managedMonthly.typical.contributionEur > 0);
  assert.ok(margins.managedMonthly.typical.breakEvenSupportMinutesAtThirtyEurPerHour < 7);
  assert.ok(sensitivity.support_10_minutes.managedMonthlyTypical.contributionEur < 0);
  console.log("unit-economics invariants pass");
} else {
  process.stdout.write(rendered);
}
