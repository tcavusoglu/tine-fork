const puppeteer = require('puppeteer');
const { expect: expectPuppeteer, setDefaultOptions } = require('expect-puppeteer');
require('dotenv').config();
const fs = require('fs');
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
     * @param {string} downloadPath - The path to the directory where the file is being downloaded.
     * @returns {Promise<string>} A promise that resolves to the filename of the downloaded file.
     */
    waitForFileToDownload: async function (downloadPath) {
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
                if (process.env.LOGLEVEL >= ['ERR'] && !url.match('sockjs-node')) {
                    simpleConsole.log(magenta(`${request.failure().errorText} ${url}`))
                }
            })
    },

    /**
     * Initializes Jasmine and expect-puppeteer with default options.
     * Sets a default timeout of 5000ms for all expect-puppeteer actions.
     *
     * @returns void
     */
    initJasmineAndExpect: function () {
        jasmine.getEnv().addReporter({
            specStarted: result => jasmine.currentTest = result
        });
        setDefaultOptions({timeout: 5000});
    },

    /**
     * Launches the Puppeteer browser with specified options.
     *
     * @returns {Promise<puppeteer.Browser>} A promise that resolves to the launched browser instance.
     */
    launchBrowser: async function () {
        const args = ['--lang=de-DE,de', '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors', '--start-maximized'];
        const opts = {
            headless: process.env.TEST_MODE !== 'debug',
            //ignoreDefaultArgs: ['--enable-automation'],
            //slowMo: 250,
            defaultViewport: resolution,
            args: args
        };

        // TODO: Make error handling more robust and fail properly
        try {
            if (process.platform === 'darwin') {
                opts.executablePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
            }
            browser = await puppeteer.launch(opts);
        } catch (e) {
            console.log(e);
        }

        return browser;
    },

    /**
     * Creates a new page in the browser and configures it with necessary settings.
     * Sets up console logging, HTTP headers, viewport size, and optional authentication.
     *
     * @param {Object} [auth] - Optional authentication credentials for HTTP authentication.
     * @param {string} auth.username - The username for HTTP authentication.
     * @param {string} auth.password - The password for HTTP authentication.
     * @returns {Promise<puppeteer.Page>} A promise that resolves to the configured page object.
     */
    createConfiguredPage: async function ({auth} = {}) {
        page = await browser.newPage();
        await this.proxyConsole(page);
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'de'
        });
        await page.setViewport(resolution);
        if (auth) {
            await page.authenticate(auth);
        }
        return page;
    },

    /**
     * Switches the browser language to German if not already set and if not running in headless mode.
     *
     * @param {puppeteer.Page} page - The page object to perform the language switch on.
     * @returns {Promise<void>} A promise that resolves when the language switch is complete.
     */
    switchToGermanIfNeeded: async function (page) {
        if (process.env.TEST_MODE !== 'headless' && process.env.TEST_BROWSER_LANGUAGE !== 'de') {
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
};