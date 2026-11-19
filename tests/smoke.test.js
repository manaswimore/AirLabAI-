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
check(app.includes('Automatic retry enabled'), 'UI describes retry behavior');
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

assert.throws(() => calculate({ ...base, V: 0 }), /valid ranges/, 'Zero room volume is rejected');
assert.throws(() => calculate({ ...base, P: 1.2 }), /valid ranges/, 'Penetration above one is rejected');
assert.throws(() => calculate({ ...base, t: -1 }), /valid ranges/, 'Negative duration is rejected');
assert.throws(() => calculate({ ...base, source: NaN }), /finite numbers/, 'Non-finite input is rejected');
assertions += 4;

check(html.indexOf('/simulation.js') < html.indexOf('/app.js'), 'Calculation module loads before the application');
check(app.includes('AirLabSimulation.calculateIndoorPM25'), 'UI uses the tested calculation module');
check(app.includes('No finite steady state'), 'UI explains the no-steady-state case');

console.log('AirLab tests passed: ' + assertions + ' assertions.');
