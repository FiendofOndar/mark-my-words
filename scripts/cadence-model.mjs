// How many grounded checks one prediction causes over its life.
//
// Mirrors checkIntervalDays in src/domain/cadence.ts for an open, searchable
// prediction, then simulates a user who pulls once a day and once a week.
// Late watch (src/domain/prediction.ts) is monthly for three years after a
// miss when canHappenLate is set, so up to 36 more.
//
// VIABILITY.md section 3.2 carries the output. Re-run this and update that
// table whenever the cadence gate changes.
//
//   node scripts/cadence-model.mjs
function intervalDays(daysLeft) {
  if (daysLeft > 180) return 30;
  if (daysLeft > 30) return 14;
  if (daysLeft > 7) return 7;
  return 0; // every pull, at least 12 hours apart
}

function lifetimeChecks(horizonDays, pullEveryDays) {
  let checks = 0;
  let last = -Infinity;
  for (let t = 0; t <= horizonDays; t += pullEveryDays) {
    const interval = intervalDays(horizonDays - t);
    const since = t - last;
    const due = interval === 0 ? since >= 0.5 : since >= interval;
    if (due) {
      checks += 1;
      last = t;
    }
  }
  return checks;
}

console.log('days to deadline, checks pulling daily, checks pulling weekly');
for (const horizon of [7, 30, 90, 180, 365, 730]) {
  console.log(`${horizon}, ${lifetimeChecks(horizon, 1)}, ${lifetimeChecks(horizon, 7)}`);
}
console.log('late watch, when it applies: up to 36 more (monthly for three years)');
