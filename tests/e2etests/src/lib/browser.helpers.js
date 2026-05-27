const puppeteer = require('puppeteer');
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
const resolution = JSON.parse(process.env.TEST_RESOLUTION);

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
        page
            .on('console', message => {
                const type = message.type().substr(0, 3).toUpperCase()
                const messageText = message.text();
                if (process.env.LOGLEVEL >= priorities[type] && !messageText.match('sockjs-node')) {
                    const color = colors[type] || blue
                    simpleConsole.log(color(`${type} ${messageText}`))
                }
            })
            .on('pageerror', ({message}) => {
                if (process.env.LOGLEVEL >= priorities['ERR'] && !message.match('sockjs-node')) {
                    simpleConsole.log(red(message))
                }
            })
            .on('response', response => {
                if (process.env.LOGLEVEL >= priorities['DEB']) {
                    simpleConsole.log(green(`${response.status()} ${response.url()}`))
                }
            })
            .on('requestfailed', request => {
                const url = request.url();
                if (process.env.LOGLEVEL >= priorities['ERR'] && !url.match('sockjs-node')) {
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
            '--ignore-certificate-errors',
            '--start-maximized'
        ];

        const opts = {
            headless: process.env.TEST_MODE !== 'debug',
            //ignoreDefaultArgs: ['--enable-automation'],
            //slowMo: 250,
            defaultViewport: resolution,
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

        await page.setViewport(resolution);
        if (auth) {
            await page.authenticate(auth);
        }

        // Simulate slow network and CPU throttling.
        await this.applyThrottling(page, process.env.TEST_NETWORK_CONDITIONS_MAIN, process.env.TEST_CPU_THROTTLING_RATE_MAIN);

        return page;
    },

    /**
     * Switches the browser language to German if not already set and if not running in headless mode.
     *
     * @param {function} expectPuppeteer - The expect-puppeteer function to perform actions on the page.
     * @param {puppeteer.Page} page - The page object to perform the language switch on.
     * @returns {Promise<void>} A promise that resolves when the language switch is complete.
     */
    switchToGermanIfNeeded: async function (expectPuppeteer, page) {
        if (process.env.TEST_MODE === 'debug' && process.env.TEST_BROWSER_LANGUAGE !== 'de') {
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
     * @param {function} expectPuppeteer - The expect-puppeteer function to perform actions on the page.
     * @param {puppeteer.Page} page - The page object to perform the login on.
     * @param {Object} credentials - An object containing the username and password for login.
     * @param {string} credentials.user - The username for login.
     * @param {string} credentials.pass - The password for login.
     * @returns {Promise<void>} A promise that resolves when the login process is complete.
     */
    login: async function (expectPuppeteer, page, { user, pass }) {
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
     * @param {string|null} envNetwork - A JSON string representing the network conditions to apply (see TEST_NETWORK_CONDITIONS_*), or null to skip network throttling.
     * @param {string|number|null} envCpuThrottling - A number representing the CPU throttling rate to apply (see TEST_CPU_THROTTLING_RATE_*), or null to skip CPU throttling.
     * @returns {Promise<void>} A promise that resolves when the throttling has been applied.
     */
    applyThrottling: async function (page, envNetwork = null, envCpuThrottling = null) {
        if (!envNetwork && !envCpuThrottling) return;

        let client;
        try {
            client = await page.createCDPSession();
        } catch (err) {
            console.warn('applyThrottling: could not create CDP session — skipping throttling', err);
            return;
        }

        if (envNetwork) {
            let network;
            try {
                network = JSON.parse(envNetwork);
            } catch (err) {
                console.warn('applyThrottling: TEST_NETWORK_CONDITIONS JSON parse failed - skipping network throttling', err);
                network = null;
            }

            if (network) {
                try {
                    // If offline, set values to 0; otherwise use parsed numbers.
                    const offline = !!network.offline;
                    const download = offline ? 0 : Number(network.downloadThroughput) || 100;
                    const upload = offline ? 0 : Number(network.uploadThroughput) || 100;
                    const latency = offline ? 0 : Number(network.latency) || 20;

                    if (offline || (!Number.isNaN(download) && !Number.isNaN(upload))) {
                        if (offline) {
                            console.log('applyThrottling: offline network conditions');
                        } else {
                            const downStr = `${network.downloadThroughput} B/s (${Math.round(parseInt(network.downloadThroughput) / 1024)} kB/s) down`;
                            const upStr = `${network.uploadThroughput} B/s (${Math.round(parseInt(network.uploadThroughput) / 1024)} kB/s) up`;
                            console.log(`applyThrottling: network throttling: ${downStr}, ${upStr}, ${network.latency} ms latency`);
                        }

                        await client.send('Network.enable');
                        await client.send('Network.emulateNetworkConditions', {
                            offline: offline,
                            downloadThroughput: download,
                            uploadThroughput: upload,
                            latency: latency
                        });
                    } else {
                        console.warn('applyThrottling: network config missing numeric download/upload and not offline - skipping network emulation', network);
                    }
                } catch (err) {
                    console.warn('applyThrottling: error applying network emulation - continuing', err);
                }
            }
        }

        if (envCpuThrottling && parseFloat(envCpuThrottling) >= 1) {
            const rate = parseFloat(envCpuThrottling);
            if (!Number.isNaN(rate) && rate >= 1) {
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
    }
};