const puppeteer = require('puppeteer');
const { expect: expectPuppeteer, setDefaultOptions } = require('expect-puppeteer');
require('dotenv').config();

const fs = require('fs');
const mkdirp = require('mkdirp');
const path = require('path');
const uuid = require('uuid');

const simpleConsole = require('console');
const {blue, cyan, green, magenta, red, yellow} = require('colorette')
const colors = {
    LOG: text => text,
    ERR: red,
    WAR: yellow,
    INF: cyan
};

const modes = ['light', 'dark'];
const resolution = JSON.parse(process.env.TEST_RESOLUTION);
const resolutionString = `${resolution.width}x${resolution.height}`;
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
     * Downloads a file by clicking the specified selector and returns the path to the downloaded file.
     * The file will be downloaded to a temporary directory created for each download.
     *
     * @param {puppeteer.Page} page - The page object to perform the download on.
     * @param {string} selector - The selector of the element to click for initiating the download.
     * @param {Object} [option] - Optional options for the click action.
     * @returns {Promise<string>} A promise that resolves to the path of the downloaded file.
     */
    download: async function (page, selector, option = {}) {
        const downloadPath = path.resolve(__dirname, 'download', uuid.v1());
        mkdirp(downloadPath);
        console.log('Downloading file to:', downloadPath);
        const cdpSession = await page.createCDPSession();
        await cdpSession.send('Page.setDownloadBehavior', {behavior: 'allow', downloadPath: downloadPath});
        await expectPuppeteer(page).toClick(selector, option);
        let filename = await this.waitForFileToDownload(downloadPath);
        return path.resolve(downloadPath, filename);
    },

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
     * Uploads a file by finding an input element of type "file" on the page and using its uploadFile method.
     *
     * @param {puppeteer.Page} page - The page object to perform the file upload on.
     * @param {string} file - The path to the file that should be uploaded.
     * @returns {Promise<void>} A promise that resolves when the file has been set for upload.
     */
    uploadFile: async function (page, file) {
        let inputUploadHandle;

        inputUploadHandle = await page.$('input[type=file]');
        await inputUploadHandle.uploadFile(file);
    },

    /**
     * Waits for a new window to be opened and returns the corresponding page object.
     * Rejects if no new window is opened within 10 seconds or if the target is not a page.
     *
     * @returns {Promise<puppeteer.Page>} A promise that resolves to the new page object.
     */
    getNewWindow: function () {
        return new Promise((resolve, reject) => {
            if (!browser) {
                reject(new Error('getNewWindow: browser is not initialized'));
                return;
            }

            const timer = setTimeout(() => {
                reject(new Error('getNewWindow: waiting for new window reached timeout'));
            }, 10000);

            browser.once('targetcreated', async (target) => {
                try {
                    const newPage = await target.page();
                    if (!newPage) {
                        clearTimeout(timer);
                        reject(new Error('getNewWindow: target is not a page'));
                        return;
                    }
                    clearTimeout(timer);
                    resolve(newPage);
                } catch (err) {
                    clearTimeout(timer);
                    reject(err);
                }
            });
        });
    },

    /**
     * Clicks a button with the specified text and waits for a new window to open.
     * Also waits for any loading mask to disappear and for the new window to be fully loaded.
     *
     * @param {string} btnText - The text of the button to click.
     * @param {puppeteer.Page} [win] - The page object to search for the button. Defaults to the main page.
     * @returns {Promise<puppeteer.Page>} A promise that resolves to the new page object of the opened window.
     */
    getEditDialog: async function (btnText, win) {
        const ctx = win || page;
        await expectPuppeteer(ctx).toMatchElement('.x-btn-text', {text: btnText, visible: true});

        const popupPromise = this.getNewWindow();
        await expectPuppeteer(ctx).toClick('.x-btn-text', {text: btnText});

        const popupWindow = await popupPromise;
        await this.proxyConsole(popupWindow);

        const maskSelector = '.ext-el-mask';
        const maskAppeared = await popupWindow.$(maskSelector);
        if (maskAppeared) {
            await popupWindow.waitForFunction(
                (sel) => {
                    const el = document.querySelector(sel);
                    return !el || el.offsetParent === null || getComputedStyle(el).display === 'none';
                },
                {timeout: 10000},
                maskSelector
            );
        }
        await popupWindow.waitForSelector(
            '.x-window, .x-window-body, .x-form-item, .x-grid3-viewport',
            {visible: true, timeout: 10000}
        );
        return popupWindow;
    },

    /**
     * Retrieves an element from the page based on the specified type and text content.
     *
     * @param type
     * @param page
     * @param text
     * @returns {Promise<*>}
     */
    getElement: async function (type, page, text) {
        return page.$x("//" + type + "[contains(., '" + text + "')]");
    },

    /**
     * Retrieves the current user information from the registry on the given page.
     *
     * @param page
     * @returns {Promise<*>}
     */
    getCurrentUser: async function (page) {
        return page.evaluate(() => Tine.Tinebase.registry.get('currentAccount'));
    },

    /**
     * Reloads the registry on the given page by calling the reload method with clearCache option set to true.
     *
     * @param page
     * @returns {Promise<void>}
     */
    reloadRegistry: async function (page) {
        page.evaluate(() => Tine.Tinebase.common.reload({
            clearCache: true
        }));
        // TODO: Replace setTimeout()
        await new Promise(r => setTimeout(r, 1000));
        await page.waitForSelector('.x-btn-text.tine-grid-row-action-icon.renderer_accountUserIcon', 20000);
    },

    /**
     * TODO make this work / see tests/e2etests/src/test/Felamimail/grid.test.js:9 ('grid adopts to folder selected')
     *
     * @param page
     * @param selector
     * @param visible
     * @returns {Promise<unknown>}
     */
    checkDisplayOfElement: async function (page, selector, visible) {
        // TODO allow to pass selector to querySelector
        const el_display = await page.evaluate((selector) => document.querySelector(selector).style.display);
        if (visible && el_display === 'none') {
            return Promise.reject('Error: ' + selector + ' still visible');
        } else if (!visible && el_display !== 'none') {
            return Promise.reject('Error: ' + selector + ' still invisible');
        }

        return Promise.resolve();
    },

    /**
     * TODO: Is this method still needed?
     *
     * set tine20 preference and reload registry afterwards
     *
     * @param page - the page object to perform the actions on
     * @param appName - the name of the app for which the preference should be set (e.g. 'Calendar')
     * @param preference
     * @param value
     * @returns {Promise<void>}
     */
    setPreference: async function (page, appName, preference, value) {
        console.log('setting preference ' + preference + ' of app '
            + appName + ' to "' + value + '"');

        await page.waitForSelector('.x-btn-text.tine-grid-row-action-icon.renderer_accountUserIcon');
        await page.click('.x-btn-text.tine-grid-row-action-icon.renderer_accountUserIcon');
        const frame = await expectPuppeteer(page).toMatchElement('.x-menu.x-menu-floating.x-layer', {visible: true});
        await expectPuppeteer(frame).toClick('.x-menu-item-icon.action_adminMode');
        const preferencePopup = await this.getNewWindow();
        await preferencePopup.waitForSelector('.x-tree-node');
        //wait for finish load dialog
        await expectPuppeteer(preferencePopup).toMatchElement('input[name=timezone]');
        await expectPuppeteer(preferencePopup).toClick('span', {text: appName});

        // TODO: Replace setTimeout() calls

        // change setting to YES
        await expectPuppeteer(preferencePopup).toMatchElement('input[name=' + preference + ']');
        await expectPuppeteer(preferencePopup).toFill('input[name=' + preference + ']', value);
        await new Promise(r => setTimeout(r, 500));
        await preferencePopup.keyboard.press('Enter');
        await new Promise(r => setTimeout(r, 500));
        await expectPuppeteer(preferencePopup).toClick('button', {text: 'Ok'});
        await new Promise(r => setTimeout(r, 1000));

        await this.reloadRegistry(page);
        await page.waitForSelector('.x-tab-strip-closable.x-tab-with-icon.tine-mainscreen-apptabspanel-menu-tabel', {timeout: 0});
    },

    /**
     * Opens the browser, navigates to tine website, switches the browser language to German,
     * logs in and optionally opens the specified app and module.
     *
     * @param app optional app to open after login
     * @param module optional module to open after login (requires app)
     * @returns {Promise<void>}
     */
    getBrowser: async function (app, module) {
        this.initJasmineAndExpect();
        await this.launchBrowser();
        const page = await this.createConfiguredPage();

        await page.goto(process.env.TEST_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await expectPuppeteer(page).toMatchElement('title', { text: process.env.TEST_BRANDING_TITLE });

        await this.switchToGermanIfNeeded(page);
        await this.login(page, {
            user: process.env.TEST_USERNAME,
            pass: process.env.TEST_PASSWORD
        });

        // TODO: MFA still working?
        try {
            await page.waitForSelector('.tine-dock', {timeout: 0});
            if (!!+process.env.MFA) {
                await page.waitForSelector('.x-window-header-text', {text: 'Multi Faktor Authentifikation'});
                const mfaDialog = await this.getEditDialog('OK');
                await expectPuppeteer(mfaDialog).toClick('button', {text: "Abbrechen"});
            }
        } catch (e) {
            // TODO: Fail properly
            console.log('login failed!');
            console.log(app);
            console.error(e);
        }

        if (app) {
            await expectPuppeteer(page).toClick('.action_menu.application-menu-btn');
            await page.waitForSelector('.application-menu-item');
            await expectPuppeteer(page).toClick('.application-menu-item__text', { text: app });
        }
        if (module) {
            await page.waitForSelector('span', { text: 'Module' });
            await expectPuppeteer(page).toClick('.tine-mainscreen-centerpanel-west .x-tree-node a span', {text: module});
        }
    },

    /**
     * Proxies console messages from the given page to the main console, filtering by log level and ignoring messages related to 'sockjs-node'.
     *
     * @param page
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
     * Opens the browser, navigates to the setup page, and logs in with setup credentials.
     * Also switches the browser language to German if not already set.
     *
     * @returns {Promise<void>} A promise that resolves when the setup process is complete.
     */
    getSetup: async function () {
        this.initJasmineAndExpect();
        await this.launchBrowser();
        const page = await this.createConfiguredPage({
            auth: {
                username: process.env.HTACCESS_USERNAME,
                password: process.env.HTACCESS_PASSWORD
            }
        });

        page.setDefaultTimeout(15000);
        await page.goto(process.env.TEST_URL + '/setup.php', {waitUntil: 'domcontentloaded', timeout: 30000});
        await expectPuppeteer(page).toMatchElement('title', {text: process.env.TEST_BRANDING_TITLE});

        await this.switchToGermanIfNeeded(page);
        await this.login(page, {
            user: process.env.SETUP_USERNAME,
            pass: process.env.SETUP_PASSWORD
        });

        // TODO: try catch necessary?
        try {
            await page.waitForSelector('.account-user-avatar', {timeout: 0});
        } catch (e) {
            console.log('login failed!');
            console.error(e);
        }
    },

    /**
     * Clicks a button with the specified text that is part of a split button and handles the click event to open the associated menu.
     *
     * @param page
     * @param text
     * @returns {Promise<void>}
     */
    clickSplitButton: async function (page, text) {
        return await page.evaluate((text) => {
            const btn = document.evaluate('//em[button[text()="' + text + '"]]', document).iterateNext();
            const box = btn.getBoundingClientRect();

            // cruid split btn hack
            const tmp = Ext.EventObject.getPageX;
            Ext.EventObject.getPageX = () => {
                return 10000
            }
            document.elementFromPoint(box.x + box.width, box.y).click();
            Ext.EventObject.getPageX = tmp;
        }, text);
    },

    /**
     * Takes a screenshot of the given page with the specified options.
     * The env variable TEST_ALL_SCREENSHOT set to 'true' will take screenshots in both light and dark modes.
     *
     * @param page
     * @param options - The options for taking the screenshot, including the path where the screenshot should be saved.
     * @returns {Promise<void>} A promise that resolves when the screenshot(s) have been taken and saved.
     */
    makeScreenshot: async function (page, options) {
        if (process.env.TEST_ALL_SCREENSHOT === 'true') {
            const basePath = options.path;
            console.log(options);
            console.log(basePath);
            if (!basePath) {
                throw new Error('Kein Pfad für den Screenshot angegeben.');
            }

            for (const mode of modes) {
                const filePath = basePath.replace(
                    /(\.\w+)$/,
                    `_${mode}$1`
                );

                await page.evaluate((m) => {
                    document.body.className = document.body.className.replace(
                        /(light|dark)-mode/,
                        `${m}-mode`
                    );
                }, mode);

                await page.setViewport(resolution);
                // TODO: Replace setTimeout()
                await new Promise(r => setTimeout(r, 500));

                await page.screenshot({ ...options, path: filePath });
            }
        } else {
            await page.screenshot(options);
        }
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
     * @param {Object} [options] - Optional configuration options for the page.
     * @param {Object} [options.auth] - Optional authentication credentials for HTTP authentication.
     * @param {string} options.auth.username - The username for HTTP authentication.
     * @param {string} options.auth.password - The password for HTTP authentication.
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
    }
};
