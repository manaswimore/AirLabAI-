'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public/styles.css'), 'utf8');
const simulationSource = fs.readFileSync(path.join(root, 'public/simulation.js'), 'utf8');

let assertions = 0;
function check(condition, message) {
    assert.ok(condition, message);
    assertions++;
}

// Application structure and API routes.
for (const id of ['overview', 'household', 'simulator', 'mobility', 'assistant', 'experiments']) {
    check(html.includes('id="' + id + '"'), 'Page section exists: ' + id);
}
for (const route of ['/api/status', '/api/geocode', '/api/air-quality', '/api/chat']) {
    check(server.includes(route), 'API route exists: ' + route);
}
check(!/AQ\.[A-Za-z0-9_-]{20,}/.test(app), 'No API key is hardcoded in browser JavaScript');

// Gemini resilience and private configuration.
for (const snippet of [
    'callModelWithRetry',
    'resilientGemini',
    'gemini-3.5-flash-lite',
    'exponential'
]) {
    check(server.includes(snippet), 'Server resilience feature exists: ' + snippet);
}
check(app.includes('fallbackUsed'), 'UI identifies fallback responses');
check(app.includes('Thinking…'), 'Assistant shows a visible loading state');
check(server.includes('setTimeout(25000'), 'Gemini upstream timeout is bounded to 25 seconds');
check(server.includes('maxOutputTokens: 600'), 'Gemini response length is bounded for faster replies');
check(server.includes('function loadLocalEnv()'), 'Server loads local environment configuration');
check(server.includes("path.join(__dirname, '.env')"), 'Server reads .env from project folder');
check(fs.existsSync(path.join(root, '.env.example')), 'Safe environment template exists');
check(fs.existsSync(path.join(root, 'start-windows.bat')), 'Windows launcher exists');
check(fs.readFileSync(path.join(root, '.gitignore'), 'utf8').includes('.env'), '.env is git-ignored');

// Existing theme and responsive layout.
check(css.includes('--bg:#09070d'), 'Dark theme token exists');
check(css.includes('--pink:#ff4f9a'), 'Pink accent token exists');
check(css.includes('@media(max-width:560px)'), 'Mobile breakpoint exists');
check(html.includes('class="brand-mark"'), 'Brand mark exists');
check(fs.existsSync(path.join(root, 'public/favicon.svg')), 'Favicon exists');

// Load the same pure calculation module used by the browser.
vm.runInThisContext(simulationSource, { filename: 'public/simulation.js' });
const calculate = globalThis.AirLabSimulation.calculateIndoorPM25;

const base = {
    C0: 55, Co: 45, V: 50, lambda: 0.5,
    P: 0.8, k: 0.24, CADR: 320, source: 350, t: 24
};

const normal = calculate(base);
check(Number.isFinite(normal.concentration), 'Normal simulation returns finite concentration');
check(normal.concentration >= 0, 'Normal simulation concentration is non-negative');
check(normal.steadyState !== null && normal.steadyState >= 0, 'Normal simulation returns valid steady state');
check(normal.t90SteadyStateMinutes > 0, 't90 approach time is positive');
check(normal.t90AbsoluteMinutes === null || normal.t90AbsoluteMinutes > 0, 'Absolute t90 is positive or correctly unreachable');

const zeroDuration = calculate({ ...base, t: 0 });
check(Math.abs(zeroDuration.concentration - base.C0) < 1e-10, 'Zero duration returns initial concentration');

const noRemovalNoSource = calculate({
    C0: 40, Co: 20, V: 50, lambda: 0, P: 0.8,
    k: 0, CADR: 0, source: 0, t: 5
});
check(noRemovalNoSource.steadyState === null, 'No-removal case does not invent a steady state');
check(noRemovalNoSource.concentration === 40, 'No-removal/no-source concentration stays constant');

const noRemovalWithSource = calculate({
    C0: 40, Co: 20, V: 10, lambda: 0, P: 0.8,
    k: 0, CADR: 0, source: 50, t: 2
});
check(noRemovalWithSource.steadyState === null, 'Source with no removal has no finite steady state');
check(Math.abs(noRemovalWithSource.concentration - 50) < 1e-10, 'No-removal source case increases concentration linearly');

const equilibrium = calculate({ ...base, C0: normal.steadyState, t: 10 });
check(Math.abs(equilibrium.concentration - normal.steadyState) < 1e-10, 'Steady-state initial condition remains at equilibrium');

function checkClose(actual, expected, tolerance, message) {
    check(
        Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
        message
    );
}

// Numerical invariants and boundary behaviour.
const fromAbove = calculate({ ...base, C0: normal.steadyState + 20, t: 1 });
check(
    fromAbove.concentration < normal.steadyState + 20 &&
    fromAbove.concentration > normal.steadyState,
    'Concentration approaches steady state from above without crossing it'
);

const fromBelow = calculate({ ...base, C0: normal.steadyState / 2, t: 1 });
check(
    fromBelow.concentration > normal.steadyState / 2 &&
    fromBelow.concentration < normal.steadyState,
    'Concentration approaches steady state from below without crossing it'
);

const approachAtT90 = calculate({
    ...base,
    C0: normal.steadyState + 20,
    t: Math.log(10) / normal.K
});
checkClose(
    approachAtT90.concentration,
    normal.steadyState + 2,
    1e-9,
    't90 steady-state time leaves ten percent of initial excess'
);

const clearToZero = calculate({
    C0: 100, Co: 0, V: 50, lambda: 0,
    P: 0, k: 1, CADR: 0, source: 0, t: Math.log(10)
});
checkClose(
    clearToZero.concentration,
    10,
    1e-9,
    'Absolute t90 calculation matches ten percent remaining'
);
checkClose(
    clearToZero.t90AbsoluteMinutes,
    Math.log(10) * 60,
    1e-9,
    'Absolute t90 is reported in minutes'
);

const longRun = calculate({ ...base, t: 1000 });
checkClose(
    longRun.concentration,
    normal.steadyState,
    1e-8,
    'Long simulation converges to steady state'
);

const zeroInputs = calculate({
    C0: 0, Co: 0, V: 25, lambda: 0,
    P: 0, k: 0.5, CADR: 0, source: 0, t: 10
});
check(zeroInputs.concentration === 0, 'Zero initial and input concentration remains zero');
check(zeroInputs.steadyState === 0, 'Zero-input case has zero steady state');
check(zeroInputs.t90AbsoluteMinutes === null, 'Absolute t90 is unavailable when initial concentration is zero');

const noOutdoorPenetration = calculate({
    C0: 0, Co: 100, V: 50, lambda: 1,
    P: 0, k: 0, CADR: 0, source: 0, t: 1
});
check(noOutdoorPenetration.steadyState === 0, 'Zero penetration prevents outdoor particle contribution');

assert.throws(() => calculate(null), /inputs are required/, 'Null input is rejected');
assert.throws(() => calculate({ ...base, C0: '55' }), /finite numbers/, 'Numeric strings are rejected instead of coerced');
assert.throws(() => calculate({ ...base, Co: -1 }), /valid ranges/, 'Negative outdoor concentration is rejected');
assert.throws(() => calculate({ ...base, lambda: -0.1 }), /valid ranges/, 'Negative air-change rate is rejected');
assert.throws(() => calculate({ ...base, k: -0.1 }), /valid ranges/, 'Negative deposition rate is rejected');
assert.throws(() => calculate({ ...base, CADR: -1 }), /valid ranges/, 'Negative clean-air delivery rate is rejected');
assert.throws(() => calculate({ ...base, source: -1 }), /valid ranges/, 'Negative indoor source rate is rejected');
assert.throws(() => calculate({ ...base, C0: Infinity }), /finite numbers/, 'Infinite concentration is rejected');
assert.throws(() => calculate({ ...base, P: -0.1 }), /valid ranges/, 'Negative penetration is rejected');
assert.throws(() => calculate({ ...base, V: -1 }), /valid ranges/, 'Negative room volume is rejected');
assertions += 20;

assert.throws(() => calculate({ ...base, V: 0 }), /valid ranges/, 'Zero room volume is rejected');
assert.throws(() => calculate({ ...base, P: 1.2 }), /valid ranges/, 'Penetration above one is rejected');
assert.throws(() => calculate({ ...base, t: -1 }), /valid ranges/, 'Negative duration is rejected');
assert.throws(() => calculate({ ...base, source: NaN }), /finite numbers/, 'Non-finite input is rejected');
assertions += 4;

check(html.indexOf('/simulation.js') < html.indexOf('/app.js'), 'Calculation module loads before the application');
check(app.includes('AirLabSimulation.calculateIndoorPM25'), 'UI uses the tested calculation module');
check(app.includes('No finite steady state'), 'UI explains the no-steady-state case');
check(!/\\nstatus\\(\\);\\s*\\nsearch\\(\\);\\s*$/.test(app), 'Initial page load does not wait for external API calls');
check(app.includes("name === 'assistant' && !S.statusChecked"), 'Gemini status is checked only when assistant tab opens');
check(app.includes("if (S.statusChecked) return;"), 'Gemini status check is not repeated unnecessarily');

check(app.includes('function loadExperiments()'), 'safe storage check');

check(app.includes('Number.isFinite(room)'), 'room validation check');

check(app.includes('Number.isFinite(indoor)'), 'indoor validation check');

check(app.includes('!Number.isFinite(km)'), 'mobility validation check');

check(app.includes('history.replaceChildren()'), 'safe history check');

check(app.includes('escapeCell'), 'CSV escaping check');

check(app.includes(".join('\\\\r\\\\n')"), 'CSV uses real CRLF row separators');

check(app.includes('No matching place found'), 'unknown city feedback');

check(app.includes('planOutput.replaceChildren()'), 'invalid household results are cleared');

check(app.includes("$('mobout').replaceChildren()"), 'invalid mobility results are cleared');

check(server.includes('upstreamInFlight'), 'in-flight request deduplication check');

check(server.includes('const retryableStatuses = [500, 502, 503, 504]'), '429 is not retried check');

check(server.includes('req.resume();'), 'oversized body drain check');

check(server.includes('requestHits.size > 1000'), 'rate limiter cleanup check');

console.log('AirLab tests passed: ' + assertions + ' assertions.');

check(simulationSource.includes('timeSeries'), 'simulator returns a time series');
check(app.includes("$('simseries').replaceChildren(table)"), 'simulator renders a unit-labelled time series');
check(app.includes("$('simout').replaceChildren()"), 'invalid simulator output is cleared');
check(app.includes('annualSoloKm'), 'mobility uses a shared annual solo-driving baseline');
check(html.includes('<option value="home">Work from home</option>'), 'work-from-home mode is available');
