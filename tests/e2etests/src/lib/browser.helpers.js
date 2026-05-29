const puppeteer = require('puppeteer');
const { expect: expectPuppeteer } = require('expect-puppeteer');
require('dotenv').config();
const simpleConsole = require('console');
const {blue, cyan, green, magenta, red, yellow} = require('colorette')
const colors = {
    LOG: text => text,
    ERR: red,
    WAR: yellow,
    INF: cyan
};
const priorities = {
    EME: 0,  // Emergency: system is unusable
    ALE: 1,  // Alert: action must be taken immediately
    CRI: 2,  // Critical: critical conditions
    ERR: 3,  // Error: error conditions
    WAR: 4,  // Warning: warning conditions
    NOT: 5,  // Notice: normal but significant condition
    INF: 6,  // Informational: informational messages
    DEB: 7,   // Debug: debug messages
    TRA: 8   // Debug: debug messages
};

module.exports = {
    /**
     * Waits for a file to be downloaded in the specified directory and returns the filename.
     * It checks for the presence of a file that does not have the '.crdownload' extension, which indicates an ongoing download in Chrome.
     *
     * @param fs - The file system module to read the directory contents.
     * @param {string} downloadPath - The path to the directory where the file is being downloaded.
     * @returns {Promise<string>} A promise that resolves to the filename of the downloaded file.
     */
    waitForFileToDownload: async function (fs, downloadPath) {
        // TODO: This method loops indefinitely, consider adding a timeout.
        console.log('Waiting to download file...');
        let filename;
        while (!filename || filename.endsWith('.crdownload')) {
            filename = fs.readdirSync(downloadPath)[0];
            // TODO: Replace setTimeout()
            await new Promise(r => setTimeout(r, 500));
        }
        return filename;
    },

    /**
     * Wait until a button-like element with given visible text is actionable/clickable.
     *
     * @param {puppeteer.Page} page - Page or frame context
     * @param {string} text - Visible button text to match
     * @param {number} [timeout=7000] - Timeout in ms
     * @param {string} [labelSelector='.x-btn-text'] - Selector to find the text element (optional)
     * @returns {Promise<void>}
     */
    waitForActionableButton: async function (page, text, timeout = 7000, labelSelector = '.x-btn-text') {
        if (!page) throw new Error('waitForActionableButton: page is required');

        // Runs in page context: uses window.getComputedStyle and DOM checks
        await page.waitForFunction(
            (labelSelectorInner, textInner) => {
                const nodes = Array.from(document.querySelectorAll(labelSelectorInner || '.x-btn-text'));
                const el = nodes.find(e => e.textContent && e.textContent.trim() === textInner);
                if (!el) return false;
                const btn = el.closest('button') || el.parentElement;
                if (!btn) return false;
                const style = window.getComputedStyle(btn);
                // offsetParent !== null -> element is laid out; ensure not hidden or disabled
                return btn.offsetParent !== null &&
                    style.display !== 'none' &&
                    !btn.disabled &&
                    !btn.classList.contains('x-item-disabled');
            },
            {timeout},
            labelSelector,
            text
        );
    },

    /**
     * Proxies console messages from the given page to the main console, filtering by log level and ignoring messages related to 'sockjs-node'.
     *
     * @param {puppeteer.Page} page
     * @returns {Promise<void>}
     */
    proxyConsole: async function (page) {
        const logLevel = this.baseGetEnv('LOGLEVEL', {type: 'int', defaultValue: priorities['DEB']});
        page
            .on('console', message => {
                const type = message.type().substr(0, 3).toUpperCase()
                const messageText = message.text();
                if (logLevel >= priorities[type] && !messageText.match('sockjs-node')) {
                    const color = colors[type] || blue
                    simpleConsole.log(color(`${type} ${messageText}`))
                }
            })
            .on('pageerror', ({message}) => {
                if (logLevel >= priorities['ERR'] && !message.match('sockjs-node')) {
                    simpleConsole.log(red(message))
                }
            })
            .on('response', response => {
                if (logLevel >= priorities['DEB']) {
                    simpleConsole.log(green(`${response.status()} ${response.url()}`))
                }
            })
            .on('requestfailed', request => {
                const url = request.url();
                if (logLevel >= priorities['ERR'] && !url.match('sockjs-node')) {
                    simpleConsole.log(magenta(`${request.failure().errorText} ${url}`))
                }
            })
    },

    /**
     * Initializes Jasmine and expect-puppeteer with default options.
     * Sets a default timeout of 5000ms for all expect-puppeteer actions.
     *
     * @param {function} setDefaultOptions - The function to set default options for expect-puppeteer.
     * @returns void
     */
    initJasmineAndExpect: function (setDefaultOptions) {
        jasmine.getEnv().addReporter({
            specStarted: result => jasmine.currentTest = result
        });
        setDefaultOptions({timeout: 5000});
    },

    /**
     * Launches the Puppeteer browser with specified options and returns the browser instance.
     *
     * @returns {Promise<puppeteer.Browser>}
     */
    launchBrowser: async function () {
        const args = [
            '--lang=de-DE,de',
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-popup-blocking',
            '--ignore-certificate-errors',
            '--start-maximized'
        ];

        const opts = {
            headless: this.baseGetEnv('TEST_MODE', {type: 'string'}) !== 'debug',
            //ignoreDefaultArgs: ['--enable-automation'],
            //slowMo: 250,
            defaultViewport: this.baseGetEnv('TEST_RESOLUTION', {type: 'json'}),
            args: args
        };

        if (process.platform === 'darwin') {
            opts.executablePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
        }

        return await puppeteer.launch(opts);
    },

    /**
     * Creates a new page in the browser and configures it with necessary settings.
     * Sets up console logging, HTTP headers, viewport size, and optional authentication.
     *
     * @param {puppeteer.Browser} browser - The Puppeteer browser instance to create the page in.
     * @param {Object} [auth] - Optional authentication credentials for HTTP authentication.
     * @param {string} auth.username - The username for HTTP authentication.
     * @param {string} auth.password - The password for HTTP authentication.
     * @returns {Promise<puppeteer.Page>} A promise that resolves to the configured page object.
     */
    createConfiguredPage: async function (browser, {auth} = {}) {
        if (!browser) {
            throw new Error('createConfiguredPage: browser is not initialized');
        }
        const page = await browser.newPage();
        await this.proxyConsole(page);

        await page.setExtraHTTPHeaders({
            'Accept-Language': 'de'
        });

        await page.setViewport(this.baseGetEnv('TEST_RESOLUTION', {type: 'json'}));
        if (auth) {
            await page.authenticate(auth);
        }

        // Simulate slow network and CPU throttling.
        // TODO: Simplify
        await this.applyThrottling(page, this.baseGetEnv('TEST_NETWORK_CONDITIONS_MAIN', {type: 'json', defaultValue: null}), this.baseGetEnv('TEST_CPU_THROTTLING_RATE_MAIN', {type: 'int'}), 'Main Page');

        return page;
    },

    /**
     * Switches the browser language to German if not already set and if not running in headless mode.
     *
     * @param {puppeteer.Page} page - The page object to perform the language switch on.
     * @returns {Promise<void>} A promise that resolves when the language switch is complete.
     */
    switchToGermanIfNeeded: async function (page) {
        if (this.baseGetEnv('TEST_MODE', {type: 'string'}) === 'debug' && this.baseGetEnv('TEST_BROWSER_LANGUAGE', {type: 'string'}) !== 'de') {
            console.log('switching to German');
            const langSelector = '#langChooser input[type=text]';
            await page.waitForSelector(langSelector, {visible: true});
            await page.click(langSelector);
            await expectPuppeteer(page).toClick('.x-combo-list-item', {text: 'Deutsch [de]'});
            await page.waitForFunction(() => !document.querySelector('.x-combo-list'), {timeout: 5000}).catch(() => {});
            await page.waitForSelector(langSelector, {visible: true, timeout: 10000});
        }
    },

    /**
     * Performs the login action on the given page using the provided user credentials.
     *
     * @param {puppeteer.Page} page - The page object to perform the login on.
     * @param {Object} credentials - An object containing the username and password for login.
     * @param {string} credentials.user - The username for login.
     * @param {string} credentials.pass - The password for login.
     * @returns {Promise<void>} A promise that resolves when the login process is complete.
     */
    login: async function (page, { user, pass }) {
        await page.waitForSelector('input[name=username]', { timeout: 30000 });
        await page.focus('input[name=username]');
        await page.waitForFunction(() => {
            const el = document.querySelector('input[name=username]');
            return !!el && document.activeElement === el && !el.disabled && !el.readOnly;
        }, { timeout: 10000 });

        await expectPuppeteer(page).toFill('input[name=username]', user, { delay: 50 });
        await expectPuppeteer(page).toFill('input[name=password]', pass, { delay: 50 });
        await expectPuppeteer(page).toClick('button', { text: 'Anmelden' });
    },

    /**
     * Applies network and CPU throttling to the given page based on the provided environment variables.
     *
     * @param {puppeteer.Page} page - The page to apply throttling to.
     * @param {Object|null} envNetwork - An object representing the network conditions to apply (see TEST_NETWORK_CONDITIONS_*), or null to skip network throttling.
     * @param {number|null} envCpuThrottling - A number representing the CPU throttling rate to apply (see TEST_CPU_THROTTLING_RATE_*), or null to skip CPU throttling.
     * @param {string|null} displayInfo - Optional string to display in the console about the applied throttling conditions.
     * @returns {Promise<void>} A promise that resolves when the throttling has been applied.
     */
    applyThrottling: async function (page, envNetwork = null, envCpuThrottling = null, displayInfo = null) {
        if (!envNetwork && !envCpuThrottling) return;

        const DEFAULT_THROUGHPUT = 10 * 1024 * 1024; // 10 MB/s
        const DEFAULT_LATENCY = 20;

        let client;
        try {
            client = await page.createCDPSession();
        } catch (err) {
            console.warn('applyThrottling: could not create CDP session — skipping throttling', err);
            return;
        }

        if (displayInfo) { console.log(`applyThrottling info: ${displayInfo}`); }

        if (envNetwork) {
            if (typeof envNetwork !== 'object' || !['offline', 'downloadThroughput', 'uploadThroughput', 'latency'].some(k => k in envNetwork)) {
                console.warn('applyThrottling: env network conditions is not an object or keys are incorrect - skipping network emulation', envNetwork);
                return;
            }
            // If offline, set values to 0; otherwise use parsed numbers.
            const offline = !!envNetwork.offline;
            const download = offline ? 0 : this.safeNumber(envNetwork.downloadThroughput, DEFAULT_THROUGHPUT);
            const upload = offline ? 0 : this.safeNumber(envNetwork.uploadThroughput, DEFAULT_THROUGHPUT);
            const latency = offline ? 0 : this.safeNumber(envNetwork.latency, DEFAULT_LATENCY);

            if (offline || (Number.isFinite(download) && Number.isFinite(upload))) {
                if (offline) {
                    console.log('applyThrottling: offline network conditions');
                } else {
                    console.log(`applyThrottling: network throttling: ${download} B/s (${Math.round(download / 1024)} kB/s) down, ${upload} B/s (${Math.round(upload / 1024)} kB/s) up, ${latency} ms latency`);
                }

                try {
                    await client.send('Network.enable');
                    await client.send('Network.emulateNetworkConditions', {
                        offline: offline,
                        downloadThroughput: download,
                        uploadThroughput: upload,
                        latency: latency
                    });
                } catch (err) {
                    console.warn('applyThrottling: error applying network emulation - continuing', err);
                }
            } else {
                console.warn('applyThrottling: network config missing numeric download/upload and not offline - skipping network emulation', envNetwork);
            }
        }

        if (envCpuThrottling != null) {
            const rate = this.safeNumber(envCpuThrottling);
            if (rate >= 1) {
                try {
                    await client.send('Emulation.setCPUThrottlingRate', {rate: rate});
                    console.log(`applyThrottling: CPU throttling: ${rate}x slowdown`);
                } catch (err) {
                    console.warn('applyThrottling: error applying CPU throttling', err);
                }
            } else {
                console.warn('applyThrottling: env CPU throttling value invalid or <1 - skipping', envCpuThrottling);
            }
        }
    },

    /**
     * Retrieves an environment variable and parses it according to the specified type.
     * Supports 'int', 'bool', 'string', 'json' and 'auto' (default) types.
     * Undefined environment variables or parsing failures will return the default value.
     *
     * TODO: Consider simplifying this and its short-hands getEnvInt, getEnvBool, getEnvString, getEnvJson.
     * NOTE: The classic process.env.VAR_NAME still works fine though.
     *
     * @param {string} envName - The name of the environment variable to retrieve.
     * @param {Object} [opts] - Optional settings for parsing the environment variable.
     * @param {string} [opts.type='auto'] - The type to parse the environment variable as ('int', 'bool', 'string', 'json' or 'auto').
     * @param {*} [opts.defaultValue=null] - The default value to return if the environment variable is not set or cannot be parsed.
     * @returns {*} The parsed environment variable value, or the default value if not set or invalid.
     */
    baseGetEnv: function (envName, opts = {}) {
        const {type = 'auto', defaultValue = null} = opts;

        if (typeof envName !== 'string' || envName.length === 0 || !Object.prototype.hasOwnProperty.call(process.env, envName)) {
            return defaultValue;
        }

        const rawValue = process.env[envName];
        const strValue = String(rawValue).trim();
        const intValue = parseInt(strValue, 10);

        if (type === 'int') {
            if (strValue === '') return defaultValue;
            return (Number.isFinite(intValue)) ? intValue : defaultValue;
        }
        if (type === 'bool') {
            if (['1', 'true', 'yes', 'on'].includes(strValue.toLowerCase())) return true;
            if (['0', 'false', 'no', 'off'].includes(strValue.toLowerCase())) return false;
            return defaultValue;
        }
        if (type === 'string') {
            if (rawValue == null) return defaultValue;
            return strValue;
        }
        if (type === 'json') {
            try {
                return JSON.parse(strValue);
            } catch {
                return defaultValue;
            }
        }
        // type = auto
        return strValue;
    },

    /**
     * Safely converts a value to a number, and returns fallback value if conversion fails or value is not finite.
     * Supports converting hex to decimal, parsing strings with whitespaces and numbers with units (e.g. '10ms' -> 10).
     *
     * @param {*} v - The value to convert to a number.
     * @param {number} [fallback=0] - The value to return if the conversion fails or if the value is not finite.
     * @returns {number} The converted number, or the fallback value if conversion fails or if the value is not finite.
     */
    safeNumber: function (v, fallback = 0) {
        if (v == null) return fallback;

        if (typeof v === 'number') return Number.isFinite(v) ? v : fallback;

        const n = Number(v);
        if (Number.isFinite(n)) return n;

        if (typeof v === 'string') {
            const s = v.trim();
            if (s === '') return fallback;
            const f = parseFloat(s);
            return Number.isFinite(f) ? f : fallback;
        }
        return fallback;
    }

};