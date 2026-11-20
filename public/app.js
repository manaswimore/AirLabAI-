
'use strict';

// ==========================================
// 1. GLOBAL STATE AND HELPERS
// ==========================================

const $ = (id) => document.getElementById(id);

function loadExperiments() {
    try {
        const saved = JSON.parse(localStorage.getItem('alabRuns') || '[]');
        return Array.isArray(saved) ? saved.filter((item) => item && typeof item === 'object') : [];
    } catch {
        return [];
    }
}

const S = {
    place: null, air: null, experiments: loadExperiments(),
    searchRequest: 0, airRequest: 0
};
function clearAirDisplay(message) {
    S.place = null; S.air = null;
    $('status').textContent = message || 'Choose a location';
    $('metrics').querySelectorAll('b').forEach(node => { node.textContent = '—'; });
    $('insight').textContent = message || 'Choose a location to load the current model estimate.';
    chart([], []);
}
function refreshExperiments() {
    S.experiments = loadExperiments();
    if ($('experiments').classList.contains('show')) renderHistory();
}
window.addEventListener('storage', event => {
    if (event.key === 'alabRuns') refreshExperiments();
});

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

    // Check Gemini only when the user opens its tab, not during initial page load.
    if (name === 'assistant' && !S.statusChecked) {
        status();
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
    let data;
    try {
        data = await response.json();
    } catch {
        throw Error('The server returned an invalid response. Please try again.');
    }
    if (!response.ok) throw Error(data.error || `HTTP ${response.status}`);
    return data;
}

// ==========================================
// 4. AIR QUALITY: CITY SEARCH
// ==========================================

async function search() {
    const query = $('city').value.trim();
    const requestId = ++S.searchRequest;
    if (query.length < 2) {
        $('places').replaceChildren();
        const message = document.createElement('p');
        message.textContent = 'Enter at least two characters to search.';
        $('places').append(message);
        return;
    }
    try {
        const data = await api('/api/geocode?q=' + encodeURIComponent(query));
        if (requestId !== S.searchRequest || $('city').value.trim() !== query) return;
        $('places').replaceChildren();

        if (!Array.isArray(data.results) || data.results.length === 0) {
            const message = document.createElement('p');
            message.textContent = 'No matching place found. Check the spelling or try a nearby city.';
            $('places').append(message);
            return;
        }

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
        if (requestId === S.searchRequest) toast(error.message);
    }
}

// ==========================================
// 5. LOAD AIR QUALITY DATA
// ==========================================

async function load(place) {
    const requestId = ++S.airRequest;
    clearAirDisplay('Loading model data…');
    try {
        const data = await api(`/api/air-quality?lat=${place.latitude}&lon=${place.longitude}`);
        if (requestId !== S.airRequest) return;
        const current=data?.current, latitude=Number(data?.latitude), longitude=Number(data?.longitude);
        if(!current||!Number.isFinite(latitude)||!Number.isFinite(longitude)||!Number.isFinite(current.pm2_5)||!Number.isFinite(Date.parse(current.time))||
            !Array.isArray(data.hourly?.time)||!Array.isArray(data.hourly?.pm2_5)||data.hourly.time.length!==data.hourly.pm2_5.length)
            throw Error('Air-quality data is incomplete or unavailable for this location. Please try again.');
        S.place=place; S.air=data; $('status').textContent='CAMS model data loaded';
        const pairs=[['PM2.5',current.pm2_5,'µg/m³'],['PM10',current.pm10,'µg/m³'],['US AQI',current.us_aqi,'model index'],['NO₂',current.nitrogen_dioxide,'µg/m³']];
        $('metrics').innerHTML=pairs.map(item=>`<div>${item[0]}<b>${Number.isFinite(item[1])?item[1].toFixed(1):'—'}</b>${item[2]}</div>`).join('');
        $('insight').textContent=current.pm2_5<=15?'Relatively lower modelled particle level; continue checking local readings.':current.pm2_5<=35?'Elevated modelled particles; reduce exposure near traffic and compare indoor/outdoor readings.':current.pm2_5<=55?'High modelled particles; reduce strenuous outdoor activity and protect indoor air.':'Very high modelled particles; reduce prolonged outdoor exertion and check official advisories.';
        $('insight').textContent+=` Grid point ${latitude.toFixed(3)}, ${longitude.toFixed(3)}. `+'Model estimate, not station measurement. US AQI is a model index derived separately from pollutant concentration fields and may use a different averaging period than the current PM2.5 value.';
        chart(data.hourly.time,data.hourly.pm2_5,data.current.time,current.pm2_5);
        toast('Model data loaded');
    } catch(error) {
        if(requestId!==S.airRequest)return;
        clearAirDisplay('Air-quality data unavailable. Select the location again or try another city.');
        toast(error.message);
    }
}

// ==========================================
// 6. PM2.5 CHART
// ==========================================

function chart(times, values, currentTime, currentValue) {
    const canvas=$('chart'),ctx=canvas.getContext('2d'),w=canvas.clientWidth||550,h=190,dpr=window.devicePixelRatio||1;
    canvas.width=w*dpr;canvas.height=h*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
    const now=Date.parse(currentTime),series=[];
    if(Number.isFinite(now)&&Number.isFinite(currentValue))series.push({time:now,value:currentValue});
    if(Array.isArray(times)&&Array.isArray(values))for(let i=0;i<Math.min(times.length,values.length);i++){
        const time=Date.parse(times[i]),value=values[i];
        if(Number.isFinite(time)&&Number.isFinite(value)&&(!Number.isFinite(now)||time>now)&&(!Number.isFinite(now)||time<=now+86400000))series.push({time,value});
    }
    if(!series.length)return;series.sort((x,y)=>x.time-y.time);
    const start=series[0].time,end=start+86400000,max=Math.max(10,...series.map(x=>x.value))*1.15,left=38,right=14,top=12,bottom=27,ph=h-top-bottom,pw=w-left-right;
    ctx.font='12px DM Sans, sans-serif';ctx.fillStyle='#b5a4b4';ctx.strokeStyle='rgba(181,143,175,.18)';
    for(let i=0;i<=4;i++){const y=top+i*ph/4;ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(w-right,y);ctx.stroke();ctx.fillText(String(Math.round(max*(4-i)/4)),2,y+4);}
    ctx.fillText('Now',left,h-6);ctx.fillText('24h',w-right-22,h-6);
    const pts=series.map(x=>({x:left+Math.max(0,Math.min(1,(x.time-start)/(end-start)))*pw,y:top+ph-x.value/max*ph}));
    const grad=ctx.createLinearGradient(0,top,0,h-bottom);grad.addColorStop(0,'rgba(255,79,154,.25)');grad.addColorStop(1,'rgba(255,79,154,0)');
    ctx.beginPath();pts.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.lineTo(pts[pts.length-1].x,h-bottom);ctx.lineTo(pts[0].x,h-bottom);ctx.closePath();ctx.fillStyle=grad;ctx.fill();
    ctx.beginPath();pts.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.strokeStyle='#ff5ca8';ctx.lineWidth=2.7;ctx.lineJoin='round';ctx.lineCap='round';ctx.stroke();
    ctx.beginPath();ctx.arc(pts[0].x,pts[0].y,4,0,Math.PI*2);ctx.fillStyle='#ffc0dc';ctx.fill();
}

function plan() {
    if (!S.air || !S.place) {
        return toast('Load a location first');
    }

    const pm = S.air.current?.pm2_5;

    const indoorRaw = $('indoor').value;
    const indoor = indoorRaw === '' && !$('indoor').validity.badInput
        ? null
        : Number(indoorRaw);

    const household = Number($('hh').value);
    const room = Number($('volume').value);

    const planOutput = $('planout');
    planOutput.replaceChildren();

    if (!Number.isInteger(household) || household < 1 || household > 20) {
        return toast('Household size must be a whole number from 1 to 20.');
    }
    if (!Number.isFinite(room) || room < 5 || room > 1000) {
        return toast('Room volume must be between 5 and 1,000 m³.');
    }
    if ($('indoor').validity.badInput || (indoor !== null && (!Number.isFinite(indoor) || indoor < 0))) {
        return toast('Indoor PM2.5 must be zero or a positive number.');
    }
    if (!Number.isFinite(pm)) {
        return toast('PM2.5 data is unavailable for this location. Choose another location.');
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

    actions.forEach((item, index) => {
        const article = document.createElement('article');
        const label = document.createElement('small');
        const heading = document.createElement('h3');
        const description = document.createElement('p');
        label.textContent = `ACTION ${index + 1}`;
        heading.textContent = item[0];
        description.textContent = item[1];
        article.append(label, heading, description);
        planOutput.append(article);
    });
    const summary = document.createElement('article');
    const summaryText = document.createElement('p');
    const disclaimer = document.createElement('small');
    summaryText.textContent =
        `Location ${S.place.name}; household ${household}; room ${room} m³. ` +
        `Outdoor PM2.5 ${pm.toFixed(1)} µg/m³ (CAMS model estimate).`;
    disclaimer.textContent = 'Educational guidance, not medical advice.';
    summary.append(summaryText, disclaimer);
    planOutput.append(summary);

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
        $('simout').replaceChildren();
        $('simseries').replaceChildren();
        return toast(error.message || 'Invalid simulator input');
    }

    const {
        steadyState,
        concentration,
        t90SteadyStateMinutes,
        t90AbsoluteMinutes
    } = result;

    const experiment = {
        id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + '-' + Math.random().toString(16).slice(2),
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
        value === null ? unavailable : value > 0 && value < 0.05 ? '<0.1 min' : value.toFixed(1) + ' min';
    const steadyStateLabel = steadyState === null
        ? (result.equilibrium === 'non-unique' ? 'Any concentration (no net change)' : 'No finite steady state')
        : steadyState.toFixed(2) + ' µg/m³';

    $('simout').innerHTML = [
        ['Steady state', steadyStateLabel],
        ['Final concentration', concentration.toFixed(2) + ' µg/m³'],
        ['t90 approach to steady state', formatMinutes(t90SteadyStateMinutes, 'Not defined')],
        ['Absolute 90% clearance', formatMinutes(t90AbsoluteMinutes, 'Not reachable')]
    ].map((item) => `
        <div>
            ${item[0]}
            <b>${item[1]}</b>
        </div>
    `).join('');

    const series = result.timeSeries || [];
    const table = document.createElement('table');
    table.innerHTML = '<thead><tr><th>Time (h)</th><th>PM2.5 (µg/m³)</th></tr></thead>';
    const body = document.createElement('tbody');
    series.forEach((point) => {
        const row = document.createElement('tr');
        const time = document.createElement('td');
        const value = document.createElement('td');
        time.textContent = Number(point.time).toFixed(inputs.t < 1 ? 3 : 1);
        value.textContent = Number(point.concentration).toFixed(2);
        row.append(time, value);
        body.append(row);
    });
    table.append(body);
    $('simseries').replaceChildren(table);

    S.experiments = loadExperiments();
    S.experiments.unshift(experiment);
    if (S.experiments.length > 100) S.experiments.length = 100;
    if (save()) toast('Experiment saved');
}

// ==========================================
// 9. EXPERIMENT STORAGE
// ==========================================

function save() {
    try {
        localStorage.setItem('alabRuns', JSON.stringify(S.experiments));
        return true;
    } catch {
        toast('Could not save experiments. Browser storage may be full or disabled.');
        return false;
    }
}

function renderHistory() {
    const history = $('history');
    history.replaceChildren();
    if (!S.experiments.length) {
        const empty = document.createElement('p');
        empty.textContent = 'No experiments saved.';
        history.append(empty);
        return;
    }
    S.experiments.forEach((experiment, index) => {
        const article = document.createElement('article');
        const details = document.createElement('p');
        const remove = document.createElement('button');
        const timestamp = Date.parse(experiment.date);
        const concentration = Number(experiment.ct);
        const dateText = Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString() : 'Date unavailable';
        const concentrationText = Number.isFinite(concentration) ? concentration.toFixed(2) : 'Unavailable';
        details.textContent = `Simulation · ${dateText} · Final PM2.5: ${concentrationText} µg/m³`;
        remove.type = 'button';
        remove.textContent = 'Delete';
        remove.addEventListener('click', () => {
            S.experiments = loadExperiments().filter(item => item.id ? item.id !== experiment.id : item !== experiment);
            save();
            renderHistory();
        });
        article.append(details, remove);
        history.append(article);
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

    const escapeCell = (value) => {
        if (value === null || value === undefined) return '';
        let text = String(value);
        if (/^[\\s]*[=+@\\-]/.test(text)) text = "'" + text;
        return '"' + text.replace(/"/g, '""') + '"';
    };
    const blob = new Blob(
        [rows.map((row) => row.map(escapeCell).join(',')).join('\r\n')],
        { type: 'text/csv;charset=utf-8' }
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
    const originalButtonText = $('ask').textContent;
    $('ask').textContent = 'Thinking…';

    const thinkingMessage = document.createElement('p');
    thinkingMessage.className = 'bubble message assistant-message';
    thinkingMessage.textContent = 'AirLab AI is checking your question…';
    $('chat').append(thinkingMessage);
    $('chat').scrollTop = $('chat').scrollHeight;

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

        thinkingMessage.remove();
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
        thinkingMessage.remove();
        const errorMessage = document.createElement('p');

        errorMessage.className =
            'bubble message error-message';

        const isQuotaError =
            /429|quota exceeded|rate limit|too many requests/i.test(
                error.message || ''
            );

        errorMessage.textContent = isQuotaError
            ? 'Daily AI limit reached. Gemini is temporarily unavailable ' +
              'because today\'s API quota has been exhausted. Please try again ' +
              'after the quota resets. Other AirLab features remain available.'
            : 'Live request failed: ' +
              error.message +
              ' (No mock answer is shown as live.)';

        $('chat').append(errorMessage);
        $('chat').scrollTop = $('chat').scrollHeight;

    } finally {
        $('ask').disabled = false;
        $('ask').textContent = originalButtonText;
    }
}

// ==========================================
// 12. GEMINI SERVER STATUS
// ==========================================

async function status() {
    if (S.statusChecked) return;
    S.statusChecked = true;

    try {
        const data = await api('/api/status');

        $('gemstatus').textContent = data.geminiConfigured
            ? (
                'Key present; authentication is confirmed only after a successful response. ' +
                'Primary: ' + data.geminiModel +
                ' · Fallback: ' + data.geminiFallbackModel +
                ' · Fast response mode with fallback enabled.'
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
    const km = $('km').value.trim() === '' ? NaN : Number($('km').value);
    const days = $('days').value.trim() === '' ? NaN : Number($('days').value);
    const factor = $('ef').value.trim() === '' ? NaN : Number($('ef').value);
    const mode = $('mode').value;
    $('mobout').replaceChildren();

    if (!Number.isFinite(km) || km <= 0 || km > 200) {
        return toast('One-way commute distance must be greater than 0 and at most 200 km.');
    }
    if (!Number.isInteger(days) || days < 0 || days > 7) {
        return toast('Commute days must be a whole number from 0 to 7 per week.');
    }
    if (!Number.isFinite(factor) || factor < 0 || factor > 5) {
        return toast('Emission factor must be between 0 and 5 kg CO₂ per km.');
    }
    if (!['private', 'carpool', 'public', 'walk', 'home'].includes(mode)) {
        return toast('Choose a valid commute mode.');
    }

    const annualSoloKm = km * 2 * days * 52;
    const avoidedShare = {
        private: 0,
        carpool: 0.5,
        public: 1,
        walk: 1,
        home: 1
    }[mode];
    const avoided = annualSoloKm * avoidedShare;

    $('mobout').innerHTML = `
        <article>
            Illustrative solo-vehicle distance avoided versus solo driving:
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
        try { localStorage.setItem('alabRuns', '[]'); }
        catch { toast('Could not clear experiment history. Browser storage may be unavailable.'); }
        renderHistory();
    }
};

// ==========================================
// 15. INITIALIZE APPLICATION
// ==========================================

// Keep first paint independent of external APIs. City search and Gemini
// status checks run only after the user explicitly requests them.
