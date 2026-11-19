
'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

// ==========================================
// 1. LOAD ENVIRONMENT CONFIGURATION
// ==========================================

// Load private settings from .env without an npm dependency.
// Non-empty operating-system environment variables take precedence.
function loadLocalEnv() {
    const envFile = path.join(__dirname, '.env');

    if (!fs.existsSync(envFile)) {
        return 'process environment';
    }

    const content = fs.readFileSync(envFile, 'utf8').replace(/^\uFEFF/, '');

    for (const rawLine of content.split(/\r?\n/)) {
        let line = rawLine.trim();

        if (!line || line.startsWith('#')) {
            continue;
        }

        if (line.startsWith('export ')) {
            line = line.slice(7).trim();
        }

        const equalsIndex = line.indexOf('=');

        if (equalsIndex < 1) {
            continue;
        }

        const name = line.slice(0, equalsIndex).trim();

        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
            continue;
        }

        // Keep a non-empty variable already supplied by the OS.
        if (
            process.env[name] !== undefined &&
            String(process.env[name]).trim() !== ''
        ) {
            continue;
        }

        let value = line.slice(equalsIndex + 1).trim();

        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }

        process.env[name] = value;
    }

    return 'local .env / process environment';
}

const keySource = loadLocalEnv();

// ==========================================
// 2. SERVER CONFIGURATION
// ==========================================

const PORT = Number(process.env.PORT || 3000);

const KEY = (process.env.GEMINI_API_KEY || '').trim();

const MODEL = (
    process.env.GEMINI_MODEL || 'gemini-3.8-flash'
).trim();

const FALLBACK_MODEL = (
    process.env.GEMINI_FALLBACK_MODEL || 'gemini-3.5-flash-lite'
).trim();

const publicDirectory = path.join(__dirname, 'public');

const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.svg': 'image/svg+xml'
};

// ==========================================
// 3. HTTP RESPONSE HELPER
// ==========================================

function send(res, statusCode, data) {
    res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY'
    });

    res.end(JSON.stringify(data));
}

// ==========================================
// 4. EXTERNAL JSON REQUEST HELPER
// ==========================================

function getJson(url) {
    return new Promise((resolve, reject) => {
        const request = https.get(
            url,
            {
                headers: {
                    'User-Agent': 'AirLabAI/2.0'
                }
            },
            (response) => {
                let raw = '';

                response.setEncoding('utf8');

                response.on('data', (chunk) => {
                    raw += chunk;
                });

                response.on('end', () => {
                    let data;

                    try {
                        data = JSON.parse(raw);
                    } catch {
                        reject(
                            Error(
                                'The upstream service returned invalid JSON.'
                            )
                        );

                        return;
                    }

                    if (
                        response.statusCode >= 200 &&
                        response.statusCode < 300
                    ) {
                        resolve(data);
                    } else {
                        reject(
                            Error(
                                data.reason ||
                                data.error?.message ||
                                `Upstream HTTP ${response.statusCode}`
                            )
                        );
                    }
                });
            }
        );

        request.setTimeout(12000, () => {
            request.destroy(
                Error('Upstream request timed out.')
            );
        });

        request.on('error', reject);
    });
}


// Retry transient network resets and upstream 5xx responses.
async function getJsonWithRetry(url, attempts = 3) {
    let lastError;

    for (let attempt = 0; attempt < attempts; attempt++) {
        try {
            return await getJson(url);
        } catch (error) {
            lastError = error;
            const retryable = /ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|Upstream HTTP 5\d\d/i.test(
                error.code || error.message || ''
            );

            if (!retryable || attempt === attempts - 1) {
                throw error;
            }

            await new Promise((resolve) =>
                setTimeout(resolve, 300 * (2 ** attempt))
            );
        }
    }

    throw lastError;
}

 
// Cache successful upstream responses to avoid repeating slow external calls.
const upstreamCache = new Map();
const upstreamInFlight = new Map();

async function getJsonCached(url, ttlMs) {
    const cached = upstreamCache.get(url);
    if (cached && cached.expiresAt > Date.now()) return cached.data;
    if (upstreamInFlight.has(url)) return upstreamInFlight.get(url);

    const pending = getJsonWithRetry(url)
        .then((data) => {
            upstreamCache.set(url, { data, expiresAt: Date.now() + ttlMs });
            while (upstreamCache.size > 100) {
                upstreamCache.delete(upstreamCache.keys().next().value);
            }
            return data;
        })
        .finally(() => upstreamInFlight.delete(url));

    upstreamInFlight.set(url, pending);
    return pending;
}

// ==========================================
// 5. GEMINI API HELPERS
// ==========================================

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// Send one request to a specified Gemini model.
function requestGemini(model, payload) {
    return new Promise((resolve, reject) => {
        const endpoint =
            `https://generativelanguage.googleapis.com/v1beta/models/` +
            `${encodeURIComponent(model)}:generateContent`;

        const request = https.request(
            endpoint,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload),
                    'x-goog-api-key': KEY
                }
            },
            (response) => {
                let raw = '';

                response.setEncoding('utf8');

                response.on('data', (chunk) => {
                    raw += chunk;
                });

                response.on('end', () => {
                    let data;

                    try {
                        data = JSON.parse(raw);
                    } catch {
                        data = {
                            error: {
                                message: 'Gemini returned a non-JSON response.'
                            }
                        };
                    }

                    resolve({
                        status: response.statusCode || 502,
                        data,
                        model
                    });
                });
            }
        );

        // Fail fast so a stalled upstream request cannot block the assistant for a minute.
        request.setTimeout(25000, () => {
            request.destroy(
                Object.assign(
                    Error('Gemini did not respond within 25 seconds. Please try again.'),
                    { code: 'ETIMEDOUT' }
                )
            );
        });

        request.on('error', reject);

        request.end(payload);
    });
}

// Retry temporary API errors with exponential backoff.
async function callModelWithRetry(model, payload, attempts = 1) {
    let lastResult;

    for (let attempt = 0; attempt < attempts; attempt++) {
        try {
            const result = await requestGemini(model, payload);

            if (result.status >= 200 && result.status < 300) {
                return result;
            }

            lastResult = result;

            // Do not retry client errors such as invalid requests or invalid keys.
            const retryableStatuses = [500, 502, 503, 504];

            const isRetryable = retryableStatuses.includes(
                result.status
            );

            if (!isRetryable || attempt === attempts - 1) {
                return result;
            }

        } catch (error) {
            lastResult = {
                networkError: true,
                message: error.message,
                model
            };

            if (attempt === attempts - 1) {
                return lastResult;
            }
        }

        // 1 second, then 2 seconds, then longer if more attempts are configured.
        await wait(1000 * (2 ** attempt));
    }

    return lastResult;
}

// Try the primary model once, then use fallback only for network/5xx failures.
// HTTP 429 is neither retried nor sent to fallback: it may be a project-wide
// quota/rate-limit condition, and another model request would add load.
async function resilientGemini(payload) {
    const primary = await callModelWithRetry(
        MODEL,
        payload,
        1
    );

    const shouldUseFallback =
        primary.networkError ||
        [500, 502, 503, 504].includes(primary.status);

    if (
        shouldUseFallback &&
        FALLBACK_MODEL &&
        FALLBACK_MODEL !== MODEL
    ) {
        const fallback = await callModelWithRetry(
            FALLBACK_MODEL,
            payload,
            1
        );

        if (
            !fallback.networkError &&
            fallback.status >= 200 &&
            fallback.status < 300
        ) {
            return {
                ...fallback,
                fallbackUsed: true,
                requestedModel: MODEL
            };
        }

        return {
            ...fallback,
            primaryUnavailable: true,
            primaryModel: MODEL,
            primaryStatus: primary.status || null,
            primaryError: primary.data?.error?.message || primary.message || null,
            fallbackStatus: fallback.status || null,
            fallbackError: fallback.data?.error?.message || fallback.message || null
        };
    }

    return primary;
}

// ==========================================
// 6. REQUEST BODY PARSER
// ==========================================

function readJsonBody(req, maxBytes = 12000) {
    return new Promise((resolve, reject) => {
        let raw = '';
        let settled = false;

        req.on('data', (chunk) => {
            if (settled) {
                return;
            }

            raw += chunk;

            if (Buffer.byteLength(raw) > maxBytes) {
                settled = true;
                reject(Error('Payload too large'));
                req.resume();
            }
        });

        req.on('end', () => {
            if (settled) {
                return;
            }

            try {
                resolve(JSON.parse(raw || '{}'));
            } catch {
                reject(Error('Invalid JSON'));
            }
        });

        req.on('error', (error) => {
            if (!settled) {
                reject(error);
            }
        });
    });
}

// ==========================================
// 7. SIMPLE IN-MEMORY RATE LIMITER
// ==========================================

const requestHits = new Map();

// ==========================================
// 8. API ROUTES AND PAGE ROUTING
// ==========================================

async function route(req, res) {
    const url = new URL(req.url, 'http://localhost');

    // --------------------------------------
    // SERVER STATUS
    // --------------------------------------

    if (req.method === 'GET' && url.pathname === '/api/status') {
        return send(res, 200, {
            ok: true,
            geminiConfigured: Boolean(KEY),
            geminiModel: MODEL,
            geminiFallbackModel: FALLBACK_MODEL,
            geminiResilience:
                'One primary attempt; fallback on network/server errors; no retry on HTTP 429',
            airProvider: 'Open-Meteo Air Quality API / CAMS model data',
            keySource,
            note: 'Key presence does not prove successful authentication.'
        });
    }

    // --------------------------------------
    // CITY GEOCODING API
    // --------------------------------------

    if (req.method === 'GET' && url.pathname === '/api/geocode') {
        const query = (
            url.searchParams.get('q') || ''
        )
            .trim()
            .slice(0, 100);

        if (query.length < 2) {
            return send(res, 400, {
                error: 'Enter at least two characters.'
            });
        }

        try {
            const params = new URLSearchParams({
                name: query,
                count: '6',
                language: 'en',
                format: 'json'
            });

            const data = await getJsonCached(
                `https://geocoding-api.open-meteo.com/v1/search?${params}`,
                24 * 60 * 60 * 1000
            );

            return send(res, 200, {
                results: (data.results || []).map((item) => ({
                    name: item.name,
                    admin1: item.admin1 || '',
                    country: item.country || '',
                    latitude: item.latitude,
                    longitude: item.longitude,
                    timezone: item.timezone || 'auto'
                }))
            });

        } catch (error) {
            return send(res, 502, {
                error: error.message
            });
        }
    }

    // --------------------------------------
    // AIR QUALITY API
    // --------------------------------------

    if (req.method === 'GET' && url.pathname === '/api/air-quality') {
        const latitude = Number(
            url.searchParams.get('lat')
        );

        const longitude = Number(
            url.searchParams.get('lon')
        );

        if (
            !Number.isFinite(latitude) ||
            latitude < -90 ||
            latitude > 90 ||
            !Number.isFinite(longitude) ||
            longitude < -180 ||
            longitude > 180
        ) {
            return send(res, 400, {
                error: 'Valid coordinates required.'
            });
        }

        try {
            const params = new URLSearchParams({
                latitude: String(latitude),
                longitude: String(longitude),

                current:
                    'pm2_5,pm10,us_aqi,european_aqi,nitrogen_dioxide,ozone',

                hourly: 'pm2_5,pm10,us_aqi',

                forecast_days: '3',

                timezone: 'auto'
            });

            const data = await getJsonCached(
                `https://air-quality-api.open-meteo.com/v1/air-quality?${params}`,
                10 * 60 * 1000
            );

            return send(res, 200, {
                ...data,
                provider: 'Open-Meteo',
                model: 'CAMS forecast/model estimate',
                measurementType:
                    'Not a regulatory ground-station measurement'
            });

        } catch (error) {
            return send(res, 502, {
                error: error.message
            });
        }
    }

    // --------------------------------------
    // GEMINI CHAT API
    // --------------------------------------

    if (req.method === 'POST' && url.pathname === '/api/chat') {
        const ip = req.socket.remoteAddress || 'unknown';

        const now = Date.now();

        const recentHits = (requestHits.get(ip) || [])
            .filter((timestamp) => now - timestamp < 60000);

        if (requestHits.size > 1000) {
            for (const [clientIp, hits] of requestHits) {
                if (!hits.some((timestamp) => now - timestamp < 60000)) {
                    requestHits.delete(clientIp);
                }
            }
        }

        if (recentHits.length >= 12) {
            return send(res, 429, {
                error: 'Rate limit reached. Wait one minute.'
            });
        }

        recentHits.push(now);

        requestHits.set(ip, recentHits);

        let requestBody;

        try {
            requestBody = await readJsonBody(req);

        } catch (error) {
            const statusCode = error.message === 'Payload too large'
                ? 413
                : 400;

            return send(res, statusCode, {
                error: error.message
            });
        }

        const message = String(requestBody.message || '')
            .trim()
            .slice(0, 5000);

        if (!message) {
            return send(res, 400, {
                error: 'Message required.'
            });
        }

        if (!KEY) {
            return send(res, 503, {
                error: 'GEMINI_API_KEY_NOT_SET'
            });
        }

        const context = JSON.stringify(
            requestBody.context || {}
        ).slice(0, 4000);

        const prompt = [
            'You are AirLab AI.',
            'Give practical, evidence-aware urban air-quality guidance.',
            'Never invent live AQI, diagnoses or measured emission savings.',
            'Distinguish model estimates from observations.',
            `Context: ${context}`,
            `User: ${message}`
        ].join('\n');

        const payload = JSON.stringify({
            contents: [
                {
                    role: 'user',
                    parts: [
                        {
                            text: prompt
                        }
                    ]
                }
            ],

            generationConfig: {
                temperature: 0.35,
                maxOutputTokens: 600
            }
        });

        try {
            const result = await resilientGemini(payload);

            if (result.networkError) {
                return send(res, 502, {
                    error:
                        `Gemini connection failed after retry/fallback: ${result.message}`,

                    model: result.model || null
                });
            }

            if (result.status < 200 || result.status >= 300) {
                const isUnavailable = result.status === 503;

                const statusCode = result.status === 429
                    ? 429
                    : isUnavailable
                        ? 503
                        : 502;

                const primaryDetail = result.primaryError
                    ? ` Primary (${result.primaryModel}) returned: ${result.primaryError}`
                    : '';
                const fallbackDetail = result.fallbackError
                    ? ` Fallback (${result.model || FALLBACK_MODEL}) returned: ${result.fallbackError}`
                    : '';
                const upstreamMessage = result.data?.error?.message ||
                    `Gemini HTTP ${result.status}`;

                console.error(
                    'Gemini request failed:',
                    JSON.stringify({
                        primaryModel: result.primaryModel || MODEL,
                        primaryStatus: result.primaryStatus || result.status,
                        primaryError: result.primaryError || upstreamMessage,
                        fallbackModel: result.model || FALLBACK_MODEL,
                        fallbackStatus: result.fallbackStatus || result.status,
                        fallbackError: result.fallbackError || upstreamMessage
                    })
                );

                return send(res, statusCode, {
                    error: result.status === 429
                        ? 'Daily Gemini AI quota reached. The live AI assistant is temporarily unavailable. Please try again after the quota resets. Other AirLab features remain available.'
                        : isUnavailable
                            ? `Gemini is temporarily unavailable.${primaryDetail}${fallbackDetail}`
                            : upstreamMessage,
                    upstreamStatus: result.status,
                    model: result.model || MODEL,
                    primaryModel: result.primaryModel || null,
                    primaryStatus: result.primaryStatus || null,
                    fallbackStatus: result.fallbackStatus || null
                });
            }

            const reply = result.data
                ?.candidates?.[0]
                ?.content?.parts
                ?.map((part) => part.text || '')
                .join('\n')
                .trim();

            if (!reply) {
                return send(res, 502, {
                    error: 'Gemini returned no text.'
                });
            }

            return send(res, 200, {
                ok: true,
                mode: 'live',
                model: result.model || MODEL,
                requestedModel: result.requestedModel || MODEL,
                fallbackUsed: Boolean(result.fallbackUsed),
                reply
            });

        } catch (error) {
            return send(res, 502, {
                error: `Gemini request failed: ${error.message}`
            });
        }
    }

    // --------------------------------------
    // STATIC FRONTEND FILES
    // --------------------------------------

    const allowedFiles = [
        '/',
        '/index.html',
        '/app.js',
        '/simulation.js',
        '/styles.css',
        '/favicon.svg'
    ];

    if (
        req.method === 'GET' &&
        allowedFiles.includes(url.pathname)
    ) {
        const filename = url.pathname === '/'
            ? 'index.html'
            : url.pathname.slice(1);

        const filePath = path.join(
            publicDirectory,
            filename
        );

        try {
            const fileContent = fs.readFileSync(filePath);

            res.writeHead(200, {
                'Content-Type':
                    mimeTypes[path.extname(filePath)] ||
                    'application/octet-stream',

                'X-Content-Type-Options': 'nosniff',

                'X-Frame-Options': 'DENY',

                'Cache-Control': 'no-cache'
            });

            return res.end(fileContent);

        } catch {
            return send(res, 404, {
                error: 'Not found'
            });
        }
    }

    // --------------------------------------
    // UNKNOWN ROUTE
    // --------------------------------------

    return send(res, 404, {
        error: 'Not found'
    });
}

// ==========================================
// 9. START HTTP SERVER
// ==========================================

const server = http.createServer((req, res) => {
    route(req, res).catch((error) => {
        // Avoid exposing internal exception details to the browser.
        console.error(
            'Request handling error:',
            error.message
        );

        if (!res.headersSent) {
            send(res, 500, {
                error: 'Internal server error.'
            });

        } else if (!res.writableEnded) {
            res.end();
        }
    });
});

server.on('error', (error) => {
    console.error(
        'Server startup error:',
        error.message
    );

    process.exitCode = 1;
});

// Bind to 0.0.0.0 so Render can expose the web service.
server.listen(PORT, '0.0.0.0', () => {
    console.log(
        `AirLab AI: http://localhost:${PORT}\n` +
        `Gemini key present: ${Boolean(KEY)} (authentication unverified)\n` +
        `Key configuration: ${keySource}\n` +
        `Model: ${MODEL}\n` +
        `Fallback model: ${FALLBACK_MODEL}`
    );
});
