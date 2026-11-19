const fs=require('fs'),assert=require('assert');const h=fs.readFileSync('public/index.html','utf8'),s=fs.readFileSync('server.js','utf8'),a=fs.readFileSync('public/app.js','utf8');for(const v of ['overview','household','simulator','mobility','assistant','experiments'])assert(h.includes('id="'+v+'"'));for(const x of ['/api/status','/api/geocode','/api/air-quality','/api/chat'])assert(s.includes(x));assert(!/AQ\\.[A-Za-z0-9_-]{20,}/.test(a),'No API key may be hardcoded in browser JS');console.log('AirLab smoke tests passed: 11 assertions');
assert(s.includes('callModelWithRetry'),'Gemini retry handler exists');
assert(s.includes('resilientGemini'),'Gemini fallback handler exists');
assert(s.includes('gemini-3.5-flash-lite'),'Fallback model default exists');
assert(s.includes('exponential') || s.includes('1000*(2**i)'),'Backoff delay exists');
assert(a.includes('fallbackUsed'),'UI identifies fallback responses');
assert(a.includes('Automatic retry enabled'),'UI describes automatic retry');
console.log('Gemini resilience checks passed: 6 assertions');

assert(s.includes('function loadLocalEnv()'),'Server loads private .env configuration');
assert(s.includes("path.join(__dirname,'.env')"),'Reads .env from project folder');
assert(s.includes('process.env[name]!==undefined'),'Existing environment variables take precedence');
assert(fs.existsSync('.env.example'),'Safe environment template exists');
assert(fs.existsSync('start-windows.bat'),'Windows launcher exists');
assert(fs.readFileSync('.gitignore','utf8').includes('.env'),'Private .env is git-ignored');
console.log('Private .env configuration checks passed: 6 assertions');

const css=fs.readFileSync('public/styles.css','utf8');
assert(css.includes('--bg:#09070d'),'Black theme tokens exist');
assert(css.includes('--pink:#ff4f9a'),'Pink accent tokens exist');
assert(css.includes('@media(max-width:560px)'),'Mobile styles exist');
assert(h.includes('class="brand-mark"'),'Updated brand mark exists');
assert(s.includes('/favicon.svg'),'Favicon route is enabled');
assert(fs.existsSync('public/favicon.svg'),'SVG favicon exists');
console.log('Black/pink UI checks passed: 6 assertions');
