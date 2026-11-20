# AirLab AI — Black & Pink Edition — rebuilt for PromptWars Challenge 06

## Run (Windows)
1. Extract ZIP and open the `airlab-ai` folder.
2. Node.js 18+ is required. No `npm install` is needed.
3. Double-click `start-windows.bat`. On first launch it creates a private `.env` file from `.env.example` and opens it in Notepad.
4. Replace `PASTE_YOUR_PRIVATE_API_KEY_HERE` with your new Google AI Studio API key, save the file, and close Notepad. The server then starts automatically.
5. Open http://localhost:3000. For later launches, double-click `start-windows.bat` again; the saved `.env` file is loaded automatically.

You can also copy `.env.example` to `.env` manually and edit it. The server reads `.env` directly using Node.js built-ins; no dependency installation or PowerShell environment commands are required. OS environment variables take precedence over `.env`. The `.env` file is excluded from Git. Never paste your key into `server.js`, browser JavaScript, screenshots, or a public repository.

## Live Gemini (optional)
Create a key at https://aistudio.google.com/api-keys and put it only in the local `.env` file. Keep the default model and fallback model unless you have a reason to change them. `/api/status` reports key presence only; a successful Gemini chat response proves authentication. The key stays server-side. The assistant makes one bounded primary request (25-second upstream timeout) and makes one fallback request only for network or 5xx failures (default `gemini-3.5-flash-lite`). It limits generated output to 600 tokens to reduce wait time. HTTP 429 is returned clearly rather than repeatedly retrying and extending the wait. The UI labels fallback responses and shows a clear error if both models are unavailable. A fallback cannot eliminate a Google-side outage affecting multiple models.

## Data
Geocoding uses Open-Meteo Geocoding API. Outdoor PM2.5, PM10, AQI, NO2 and hourly forecast use Open-Meteo Air Quality API based on CAMS model forecasts. These are model estimates, not regulatory ground-station readings; selected grid cell may be kilometres away. Attribution: Open-Meteo and Copernicus Atmosphere Monitoring Service (CAMS). See https://open-meteo.com/en/docs/air-quality-api. For India decisions, compare with CPCB / State Pollution Control Board monitors and advisories.

## Science
Single-zone model: dC/dt = PλCout + S/V − (λ+k+CADR/V)C.
A=PλCout+S/V; K=λ+k+CADR/V; Css=A/K; C(t)=Css+(C0−Css)e^(−Kt).
t90,ss=ln(10)/K is time for excess above steady state to decay by 90%, not absolute clearance. Absolute 90% clearance is reachable only when Css < 0.1 C0. Model assumes constant inputs and a well-mixed room; not calibrated sensor data.

## Mobility
Default 0.18 kg CO2/km is an editable illustrative factor. Carpool assumes 50% per-person vehicle-km reduction. It excludes transit lifecycle emissions, occupancy and vehicle-specific factors. Outputs are scenario estimates, not measured reductions.

Educational information only; not medical advice.


## Interface theme update
The interface uses a responsive black and pink visual system, including a dark workspace, pink active navigation and action accents, updated metric cards, form controls, chat bubbles, mobile layouts, and an SVG favicon. The underlying page IDs and application workflows are preserved. Google Fonts are loaded through the HTML stylesheet link; the rest of the interface uses system fallbacks.
