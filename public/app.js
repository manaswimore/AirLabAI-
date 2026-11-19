
'use strict';

// ==========================================
// 1. GLOBAL STATE AND HELPERS
// ==========================================

const $ = (id) => document.getElementById(id);

const S = {
    place: null,
    air: null,
    experiments: JSON.parse(
        localStorage.getItem('alabRuns') || '[]'
    )
};

const tabs = [
    'overview',
    'household',
    'simulator',
    'mobility',
    'assistant',
    'experiments'
];

function toast(message) {
    $('toast').textContent = message;
    $('toast').style.display = 'block';

    setTimeout(() => {
        $('toast').style.display = 'none';
    }, 2600);
}

// ==========================================
// 2. NAVIGATION
// ==========================================

function nav(name) {
    tabs.forEach((tab) => {
        $(tab).classList.toggle('show', tab === name);
    });

    document.querySelectorAll('nav button').forEach((button) => {
        button.classList.toggle(
            'active',
            button.dataset.tab === name
        );
    });

    $('title').textContent = document.querySelector(
        `[data-tab="${name}"]`
    ).textContent;

    $('side').classList.remove('open');

    if (name === 'experiments') {
        renderHistory();
    }
}

document.querySelectorAll('nav button').forEach((button) => {
    button.onclick = () => nav(button.dataset.tab);
});

$('menu').onclick = () => {
    $('side').classList.toggle('open');
};

// ==========================================
// 3. API HELPER
// ==========================================

async function api(url, options) {
    const response = await fetch(url, options);
    const data = await response.json();

    if (!response.ok) {
        throw Error(data.error || `HTTP ${response.status}`);
    }

    return data;
}

// ==========================================
// 4. AIR QUALITY: CITY SEARCH
// ==========================================

async function search() {
    try {
        const data = await api(
            '/api/geocode?q=' +
            encodeURIComponent($('city').value)
        );

        $('places').innerHTML = '';

        data.results.forEach((place) => {
            const button = document.createElement('button');

            button.textContent = [
                place.name,
                place.admin1,
                place.country
            ].filter(Boolean).join(', ');

            button.onclick = () => load(place);

            $('places').append(button);
        });
    } catch (error) {
        toast(error.message);
    }
}

// ==========================================
// 5. LOAD AIR QUALITY DATA
// ==========================================

async function load(place) {
    try {
        const data = await api(
            `/api/air-quality?lat=${place.latitude}&lon=${place.longitude}`
        );

        S.place = place;
        S.air = data;

        $('status').textContent = 'CAMS model data loaded';

        const current = data.current || {};

        const pairs = [
            ['PM2.5', current.pm2_5, 'µg/m³'],
            ['PM10', current.pm10, 'µg/m³'],
            ['US AQI', current.us_aqi, 'model index'],
            ['NO₂', current.nitrogen_dioxide, 'µg/m³']
        ];

        $('metrics').innerHTML = pairs.map((item) => `
            <div>
                ${item[0]}
                <b>
                    ${Number.isFinite(item[1])
                        ? item[1].toFixed(1)
                        : '—'}
                </b>
                ${item[2]}
            </div>
        `).join('');

        const pm = current.pm2_5;

        $('insight').textContent = pm == null
            ? 'PM2.5 unavailable.'
            : pm <= 15
                ? 'Relatively lower modelled particle level; continue checking local readings.'
                : pm <= 35
                    ? 'Elevated modelled particles; reduce exposure near traffic and compare indoor/outdoor readings.'
                    : pm <= 55
                        ? 'High modelled particles; reduce strenuous outdoor activity and protect indoor air.'
                        : 'Very high modelled particles; reduce prolonged outdoor exertion and check official advisories.';

        $('insight').textContent +=
            ` Grid point ${data.latitude.toFixed(3)}, ` +
            `${data.longitude.toFixed(3)}. ` +
            'Model estimate, not station measurement.';

        chart(data.hourly?.pm2_5 || []);

        toast('Model data loaded');
    } catch (error) {
        toast(error.message);
    }
}

// ==========================================
// 6. PM2.5 CHART
// ==========================================

function chart(values) {
    const canvas = $('chart');
    const context = canvas.getContext('2d');

    const width = canvas.clientWidth || 550;
    const height = 190;
    const ratio = window.devicePixelRatio || 1;

    canvas.width = width * ratio;
    canvas.height = height * ratio;

    context.scale(ratio, ratio);
    context.clearRect(0, 0, width, height);

    values = values.slice(0, 24).filter(Number.isFinite);

    if (!values.length) return;

    const max = Math.max(10, ...values) * 1.15;

    const left = 28;
    const right = 12;
    const top = 12;
    const bottom = 25;

    const plotHeight = height - top - bottom;
    const plotWidth = width - left - right;

    context.font = '10px DM Sans, sans-serif';
    context.fillStyle = '#8c788d';
    context.strokeStyle = 'rgba(181,143,175,.13)';
    context.lineWidth = 1;

    for (let i = 0; i <= 4; i++) {
        const y = top + i * plotHeight / 4;

        context.beginPath();
        context.moveTo(left, y);
        context.lineTo(width - right, y);
        context.stroke();

        context.fillText(
            String(Math.round(max * (4 - i) / 4)),
            2,
            y + 3
        );
    }

    context.fillText('Now', left, height - 5);
    context.fillText('24h', width - right - 18, height - 5);

    const points = values.map((value, index) => ({
        x: left + index * plotWidth / Math.max(1, values.length - 1),
        y: top + plotHeight - value / max * plotHeight
    }));

    if (!points.length) return;

    // Gradient fill
    const fill = context.createLinearGradient(
        0,
        top,
        0,
        height - bottom
    );

    fill.addColorStop(0, 'rgba(255,79,154,.25)');
    fill.addColorStop(1, 'rgba(255,79,154,0)');

    context.beginPath();

    points.forEach((point, index) => {
        if (index) {
            context.lineTo(point.x, point.y);
        } else {
            context.moveTo(point.x, point.y);
        }
    });

    context.lineTo(
        points[points.length - 1].x,
        height - bottom
    );

    context.lineTo(points[0].x, height - bottom);
    context.closePath();

    context.fillStyle = fill;
    context.fill();

    // Chart line
    context.beginPath();

    points.forEach((point, index) => {
        if (index) {
            context.lineTo(point.x, point.y);
        } else {
            context.moveTo(point.x, point.y);
        }
    });

    context.strokeStyle = '#ff5ca8';
    context.lineWidth = 2.7;
    context.lineJoin = 'round';
    context.lineCap = 'round';
    context.shadowColor = 'rgba(255,79,154,.4)';
    context.shadowBlur = 9;

    context.stroke();
    context.shadowBlur = 0;

    // Last point
    const last = points[points.length - 1];

    context.beginPath();
    context.arc(last.x, last.y, 3.5, 0, Math.PI * 2);
    context.fillStyle = '#ffc0dc';
    context.fill();
}

// ==========================================
// 7. HOUSEHOLD ACTION PLAN
// ==========================================

function plan() {
    if (!S.air || !S.place) {
        return toast('Load a location first');
    }

    const pm = S.air.current?.pm2_5;

    const indoor = $('indoor').value === ''
        ? null
        : Number($('indoor').value);

    const household = Number($('hh').value);
    const room = Number($('volume').value);

    if (
        !Number.isInteger(household) ||
        household < 1 ||
        household > 20 ||
        room < 5 ||
        room > 1000 ||
        (indoor !== null && indoor < 0)
    ) {
        return toast('Check household inputs');
    }

    const actions = [];

    actions.push(
        pm > 35
            ? [
                'Reduce strenuous outdoor activity',
                'Reschedule intense exercise and non-essential outdoor tasks when verified readings are lower.'
            ]
            : [
                'Plan outdoor time thoughtfully',
                'Prefer routes away from busy roads and re-check local conditions.'
            ]
    );

    if ($('priority').value !== 'general') {
        actions.push([
            'Cautious household plan',
            'For children, older adults or respiratory-sensitive members, follow clinician advice and reduce prolonged exposure on polluted days.'
        ]);
    }

    actions.push(
        [
            'Ventilate strategically',
            'Ventilate when outdoor air is cleaner than indoor air. Close windows when outdoor particles are higher and use filtered ventilation if available.'
        ],
        [
            'Create a cleaner indoor room',
            'Use a correctly sized HEPA purifier or appropriately designed DIY filter. Avoid indoor smoking, incense and unnecessary combustion.'
        ]
    );

    if (indoor !== null) {
        actions.push([
            'Indoor/outdoor comparison',
            `User-entered indoor PM2.5 ${indoor} µg/m³ versus CAMS model outdoor estimate ${Number(pm).toFixed(1)}. Compare only similar-time calibrated readings.`
        ]);
    }

    const commute = {
        private:
            'Try public transport or carpooling for suitable journeys; combine errands and avoid idling.',
        public:
            'Plan reliable public transport and avoid waiting near idling traffic.',
        carpool:
            'Coordinate pickups to avoid duplicate trips.',
        walk:
            'Choose quieter routes away from congested junctions.',
        home:
            'Combine essential trips and use remote options when practical.'
    };

    actions.push([
        'Lower-emission routine',
        commute[$('commute').value]
    ]);

    if ($('outdoor').value === 'high' && pm > 35) {
        actions.push([
            'Reschedule long outdoor tasks',
            'Move non-essential tasks to a time when verified local readings are lower.'
        ]);
    }

    $('planout').innerHTML = actions.map((item, index) => `
        <article>
            <small>ACTION ${index + 1}</small>
            <h3>${item[0]}</h3>
            <p>${item[1]}</p>
        </article>
    `).join('') + `
        <article>
            Location ${S.place.name};
            household ${household};
            room ${room} m³.
            Outdoor PM2.5 ${Number(pm).toFixed(1)} µg/m³
            (CAMS model estimate).
            <small>Educational guidance, not medical advice.</small>
        </article>
    `;

    S.context = {
        location: S.place.name,
        pm,
        indoor,
        household,
        priority: $('priority').value,
        commute: $('commute').value
    };
}

// ==========================================
// 8. INDOOR PM2.5 SIMULATOR
// ==========================================

function sim() {
    const getValue = (id) => {
        const raw = $(id).value.trim();
        return raw === '' ? NaN : Number(raw);
    };

    const inputs = {
        C0: getValue('c0'),
        Co: getValue('co'),
        V: getValue('vol'),
        lambda: getValue('ach'),
        P: getValue('pen'),
        k: getValue('dep'),
        CADR: getValue('cadr'),
        source: getValue('source'),
        t: getValue('hours')
    };

    let result;

    try {
        result = AirLabSimulation.calculateIndoorPM25(inputs);
    } catch (error) {
        return toast(error.message || 'Invalid simulator input');
    }

    const {
        steadyState,
        concentration,
        t90SteadyStateMinutes,
        t90AbsoluteMinutes
    } = result;

    const experiment = {
        date: new Date().toISOString(),
        C0: inputs.C0,
        Co: inputs.Co,
        V: inputs.V,
        l: inputs.lambda,
        P: inputs.P,
        k: inputs.k,
        cad: inputs.CADR,
        src: inputs.source,
        t: inputs.t,
        ss: steadyState,
        ct: concentration,
        tss: t90SteadyStateMinutes,
        ta: t90AbsoluteMinutes
    };

    const formatMinutes = (value, unavailable) =>
        value === null ? unavailable : value.toFixed(1) + ' min';

    $('simout').innerHTML = [
        ['Steady state', steadyState === null ? 'No finite steady state' : steadyState.toFixed(2)],
        ['Final concentration', concentration.toFixed(2)],
        ['t90 approach to steady state', formatMinutes(t90SteadyStateMinutes, 'Not defined')],
        ['Absolute 90% clearance', formatMinutes(t90AbsoluteMinutes, 'Not reachable')]
    ].map((item) => `
        <div>
            ${item[0]}
            <b>${item[1]}</b>
        </div>
    `).join('');

    S.experiments.unshift(experiment);
    save();
    toast('Experiment saved');
}

// ==========================================
// 9. EXPERIMENT STORAGE
// ==========================================

function save() {
    localStorage.setItem(
        'alabRuns',
        JSON.stringify(S.experiments)
    );
}

function renderHistory() {
    $('history').innerHTML = S.experiments.length
        ? S.experiments.map((experiment, index) => `
            <article>
                Simulation ·
                ${new Date(experiment.date).toLocaleString()}
                <br>
                Final PM2.5:
                ${experiment.ct.toFixed(2)} µg/m³

                <button data-del="${index}">
                    Delete
                </button>
            </article>
        `).join('')
        : '<p>No experiments saved.</p>';

    document.querySelectorAll('[data-del]').forEach((button) => {
        button.onclick = () => {
            S.experiments.splice(Number(button.dataset.del), 1);

            save();
            renderHistory();
        };
    });
}

// ==========================================
// 10. CSV EXPORT
// ==========================================

function csv() {
    const rows = [
        [
            'date',
            'C0',
            'Co',
            'V',
            'ach',
            'P',
            'k',
            'CADR',
            'source',
            'hours',
            'steady_state',
            'final',
            't90ss',
            't90absolute'
        ],
        ...S.experiments.map((experiment) => [
            experiment.date,
            experiment.C0,
            experiment.Co,
            experiment.V,
            experiment.l,
            experiment.P,
            experiment.k,
            experiment.cad,
            experiment.src,
            experiment.t,
            experiment.ss,
            experiment.ct,
            experiment.tss,
            experiment.ta
        ])
    ];

    const blob = new Blob(
        [rows.map((row) => row.join(',')).join('\n')],
        { type: 'text/csv' }
    );

    const link = document.createElement('a');

    link.href = URL.createObjectURL(blob);
    link.download = 'airlab-experiments.csv';

    link.click();
}

// ==========================================
// 11. GEMINI ASSISTANT
// ==========================================

async function ask() {
    const question = $('question').value.trim();

    if (!question) return;

    const userMessage = document.createElement('p');

    userMessage.className = 'bubble message user-message';
    userMessage.textContent = 'You: ' + question;

    $('chat').append(userMessage);
    $('chat').scrollTop = $('chat').scrollHeight;

    $('question').value = '';
    $('ask').disabled = true;

    try {
        const data = await api('/api/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message: question,
                context: {
                    location: S.place?.name || 'not selected',
                    outdoorPM25: S.air?.current?.pm2_5 ?? null,
                    household: S.context || null
                }
            })
        });

        const assistantMessage = document.createElement('p');

        assistantMessage.className =
            'bubble message assistant-message';

        assistantMessage.textContent =
            'AirLab AI · Live Gemini (' +
            data.model +
            (data.fallbackUsed ? ' · automatic fallback' : '') +
            '): ' +
            data.reply;

        $('chat').append(assistantMessage);
        $('chat').scrollTop = $('chat').scrollHeight;

    } catch (error) {
        const errorMessage = document.createElement('p');

        errorMessage.className =
            'bubble message error-message';

        errorMessage.textContent =
            'Live request failed: ' +
            error.message +
            ' (No mock answer is shown as live.)';

        $('chat').append(errorMessage);
        $('chat').scrollTop = $('chat').scrollHeight;

    } finally {
        $('ask').disabled = false;
    }
}

// ==========================================
// 12. GEMINI SERVER STATUS
// ==========================================

async function status() {
    try {
        const data = await api('/api/status');

        $('gemstatus').textContent = data.geminiConfigured
            ? (
                'Key present; authentication is confirmed only after a successful response. ' +
                'Primary: ' + data.geminiModel +
                ' · Fallback: ' + data.geminiFallbackModel +
                ' · Automatic retry enabled.'
            )
            : 'No Gemini key configured on the server.';

    } catch (error) {
        $('gemstatus').textContent = 'Backend unavailable';
    }
}

// ==========================================
// 13. LOW-EMISSION ROUTINES
// ==========================================

$('compare').onclick = () => {
    const km = +$('km').value;
    const days = +$('days').value;
    const factor = +$('ef').value;
    const mode = $('mode').value;

    if (
        km < 0 ||
        km > 200 ||
        days < 0 ||
        days > 7 ||
        factor < 0
    ) {
        return toast('Check commute values');
    }

    const avoided =
        km * 2 * days * 52 *
        (mode === 'private'
            ? 1
            : mode === 'carpool'
                ? 0.5
                : 0
        );

    $('mobout').innerHTML = `
        <article>
            Illustrative solo vehicle distance avoided:
            <b>${Math.round(avoided)} km/year</b>
            <br>

            Illustrative tailpipe CO₂ scenario:
            <b>${(avoided * factor).toFixed(1)} kg/year</b>

            <small>
                Assumes 52 weeks, one-way distance and editable
                vehicle factor. Transit emissions and occupancy
                are not modelled.
            </small>
        </article>
    `;
};

// ==========================================
// 14. EVENT LISTENERS
// ==========================================

// City search
$('search').onclick = search;

$('city').onkeydown = (event) => {
    if (event.key === 'Enter') {
        search();
    }
};

// Household plan
$('plan').onclick = plan;

// Indoor simulator
$('simulate').onclick = sim;

// Gemini Assistant
$('ask').onclick = ask;

$('question').onkeydown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        ask();
    }
};

// CSV export
$('csv').onclick = csv;

// Clear experiment history
$('clear').onclick = () => {
    if (confirm('Clear experiment history?')) {
        S.experiments = [];

        save();
        renderHistory();
    }
};

// ==========================================
// 15. INITIALIZE APPLICATION
// ==========================================

status();
search();
