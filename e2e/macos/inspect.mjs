import { checkCompatibility, inspectInstallation } from './runtime.mjs';
const { actual } = inspectInstallation();
console.log(JSON.stringify(actual, null, 2));
checkCompatibility(actual);
console.log('Supported runtime. Inspection only; no application launched.');
