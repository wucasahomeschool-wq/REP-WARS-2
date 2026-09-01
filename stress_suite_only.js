const { runFullStressSuite, formatStressCsvReport } = require('./dist/simulation/battleStressTests');

console.log('\n=== FULL STRESS SUITE ===\n');
const suite = runFullStressSuite(1000);
console.log(suite.summary);

console.log('\n=== CSV REPORT ===\n');
console.log(formatStressCsvReport(suite));
