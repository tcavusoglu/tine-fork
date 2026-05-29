const helpers = require('./browser.helpers');
const { expect: expectPuppeteer, setDefaultOptions } = require('expect-puppeteer');
require('dotenv').config();

const mkdirp = require('mkdirp');
const fs = require('fs');
const path = require('path');
const uuid = require('uuid');

const modes = ['light', 'dark'];

// TODO: Import browser.helpers.js functions here and export them as part of this module, so they can be used everywhere without importing browser.helpers.js separately.

module.exports = {
    /**
     * Opens the browser, navigates to tine website, switches the browser language to German,
     * logs in and optionally opens the specified app and module.
     *
     * @param {string} app optional app to open after login
     * @param {string} module optional module to open after login (requires app)
     * @returns {Promise<void>}
     */
    getBrowser: async function (app, module) {
        helpers.initJasmineAndExpect(setDefaultOptions);

        // TODO: Cleanup the created content from every test when it fails, maybe using the database?

        // Assign the global variables.
        global.browser = await helpers.launchBrowser();
        global.page = await helpers.createConfiguredPage(global.browser);
        const page = global.page;

        await page.goto(this.getEnvStr('TEST_URL'), { waitUntil: 'domcontentloaded', timeout: this.getEnvInt('TEST_TIMEOUT_BROWSER') });
        await expectPuppeteer(page).toMatchElement('title', { text: this.getEnvStr('TEST_BRANDING_TITLE') });

        await helpers.switchToGermanIfNeeded(page);
        await helpers.login(page, {
            user: this.getEnvStr('TEST_USERNAME'),
            pass: this.getEnvStr('TEST_PASSWORD')
        });

        await page.waitForNetworkIdle({
            timeout: this.getEnvInt('TEST_TIMEOUT_NETWORK_TIMEOUT'),
            idleTime: this.getEnvInt('TEST_TIMEOUT_NETWORK_IDLE')
        });
        await page.waitForSelector('.tine-dock', {timeout: this.getEnvInt('TEST_TIMEOUT_CONTENT_READY')});

        if (this.getEnvBool('MFA')) {
            // TODO: second parameter might not work
            await page.waitForSelector('.x-window-header-text', {text: 'Multi Faktor Authentifikation'});
            const mfaDialog = await this.getEditDialog('OK');
            await expectPuppeteer(mfaDialog).toClick('button', {text: "Abbrechen"});
        }

        if (app) {
            await expectPuppeteer(page).toClick('.action_menu.application-menu-btn');
            await page.waitForSelector('.application-menu-item');
            await expectPuppeteer(page).toClick('.application-menu-item__text', { text: app });
        }
        if (module) {
            await expectPuppeteer(page).toMatchElement('span', { text: 'Module' });
            await expectPuppeteer(page).toClick('.tine-mainscreen-centerpanel-west .x-tree-node a span', {text: module});
        }
    },

    /**
     * Opens the browser, navigates to the setup page, and logs in with setup credentials.
     * Also switches the browser language to German if not already set.
     *
     * @returns {Promise<void>} A promise that resolves when the setup process is complete.
     */
    getSetup: async function () {
        helpers.initJasmineAndExpect(setDefaultOptions);

        // Assign the global variables.
        global.browser = await helpers.launchBrowser();
        global.page = await helpers.createConfiguredPage(global.browser,{
            auth: {
                username: this.getEnvStr('HTACCESS_USERNAME'),
                password: this.getEnvStr('HTACCESS_PASSWORD')
            }
        });
        const page = global.page;

        page.setDefaultTimeout(15000);

        await page.goto(this.getEnvStr('TEST_URL') + '/setup.php', {waitUntil: 'domcontentloaded', timeout: this.getEnvInt('TEST_TIMEOUT_BROWSER')});
        await expectPuppeteer(page).toMatchElement('title', {text: this.getEnvStr('TEST_BRANDING_TITLE')});

        await helpers.switchToGermanIfNeeded(page);
        await helpers.login(page, {
            user: this.getEnvStr('SETUP_USERNAME'),
            pass: this.getEnvStr('SETUP_PASSWORD')
        });

        await page.waitForSelector('.account-user-avatar', {timeout: this.getEnvInt('TEST_TIMEOUT_CONTENT_READY')});
    },

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
        // TODO: Check if this is working at all
        mkdirp(downloadPath);
        console.log('Downloading file to:', downloadPath);
        const cdpSession = await page.createCDPSession();
        await cdpSession.send('Page.setDownloadBehavior', {behavior: 'allow', downloadPath: downloadPath});
        await expectPuppeteer(page).toClick(selector, option);
        let filename = await helpers.waitForFileToDownload(fs, downloadPath);
        return path.resolve(downloadPath, filename);
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
     * Rejects if no new window is opened within TIMEOUT_POPUP_OPEN ms or if the target is not a page.
     *
     * @returns {Promise<puppeteer.Page>} A promise that resolves to the new page object.
     */
    getNewWindow: function () {
        return new Promise((resolve, reject) => {
            if (!global.browser) {
                reject(new Error('getNewWindow: global browser is not initialized'));
                return;
            }

            let timer = null;
            if (this.getEnvInt('TIMEOUT_POPUP_OPEN') > 0) {
                timer = setTimeout(() => {
                    reject(new Error('getNewWindow: waiting for new window reached timeout'));
                }, this.getEnvInt('TIMEOUT_POPUP_OPEN'));
            }

            global.browser.once('targetcreated', async (target) => {
                try {
                    const newPage = await target.page();
                    if (!newPage) {
                        clearTimeout(timer);
                        reject(new Error('getNewWindow: target is not a page'));
                        return;
                    }
                    clearTimeout(timer);

                    // Simulate slow network and CPU throttling.
                    // TODO: Simplify
                    await helpers.applyThrottling(newPage, this.getEnvJson('TEST_NETWORK_CONDITIONS_POPUP', null), this.getEnvInt('TEST_CPU_THROTTLING_RATE_POPUP'), 'New Window');

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
     * @param {puppeteer.Page} [page] - The page object to search for the button. Defaults to the main page.
     * @returns {Promise<puppeteer.Page>} A promise that resolves to the new page object of the opened window.
     */
    getEditDialog: async function (btnText, page = null) {
        const ctx = page || (typeof global.page !== 'undefined' ? global.page : null);
        if (!ctx) throw new Error('getEditDialog: no page/context available');

        // Find the desired button and wait until it is actionable.
        await expectPuppeteer(ctx).toMatchElement('.x-btn-text', {text: btnText, visible: true});
        await helpers.waitForActionableButton(ctx, btnText, this.getEnvInt('TEST_TIMEOUT_ACTIONABLE'), '.x-btn-text');

        const popupPromise = this.getNewWindow();
        await expectPuppeteer(ctx).toClick('.x-btn-text', {text: btnText});
        const popupWindow = await popupPromise;
        await helpers.proxyConsole(popupWindow);

        // Wait until up to two loading masks have disappeared.
        try {
            await popupWindow.waitForSelector('.tine-viewport-waitcycle', {hidden: true, timeout: this.getEnvInt('TEST_TIMEOUT_MASK')});
            await popupWindow.waitForSelector('.ext-el-mask', {hidden: true, timeout: this.getEnvInt('TEST_TIMEOUT_MASK')});
        } catch (err) {
            // If waiting for mask removal times out, we log and continue; subsequent waits will fail clearly.
            console.warn('getEditDialog: waiting for loading masks timed out - continuing', err);
        }
        await popupWindow.waitForNetworkIdle({
            timeout: this.getEnvInt('TEST_TIMEOUT_NETWORK_TIMEOUT'),
            idleTime: this.getEnvInt('TEST_TIMEOUT_NETWORK_IDLE')
        });

        // Wait for the dialog content to be ready (form/grid/window).
        await popupWindow.waitForSelector(
            '.x-window, .x-window-body, .x-form-item, .x-grid3-viewport',
            {visible: true, timeout: this.getEnvInt('TEST_TIMEOUT_CONTENT_READY')}
        );

        return popupWindow;
    },

    /**
     * Retrieves an element from the page based on the specified type and text content.
     *
     * @param type
     * @param {puppeteer.Page} page
     * @param text
     * @returns {Promise<*>}
     */
    getElement: async function (type, page, text) {
        return page.$x("//" + type + "[contains(., '" + text + "')]");
    },

    /**
     * Retrieves the current user information from the registry on the given page.
     *
     * @param {puppeteer.Page} page
     * @returns {Promise<*>}
     */
    getCurrentUser: async function (page) {
        return page.evaluate(() => Tine.Tinebase.registry.get('currentAccount'));
    },

    /**
     * Retrieves an environment variable and parses it as an integer.
     * Undefined environment variables or parsing failures will return the default value.
     *
     * @param {string} envName - The name of the environment variable to retrieve.
     * @param {number} [defaultValue=0] - The default value to return if the environment variable is not set or cannot be parsed as an integer.
     * @returns {number} The integer value of the environment variable, or the default value if not set or invalid.
     */
    getEnvInt: function (envName, defaultValue = 0) {
        return helpers.baseGetEnv(envName, {type: 'int', defaultValue});
    },

    /**
     * Retrieves an environment variable and parses it as a string.
     * Undefined environment variables or parsing failures will return the default value.
     *
     * @param {string} envName - The name of the environment variable to retrieve.
     * @param {string} [defaultValue=''] - The default value to return if the environment variable is not set.
     * @returns {string} The string value of the environment variable, or the default value if not set.
     */
    getEnvStr: function (envName, defaultValue = '') {
        return helpers.baseGetEnv(envName, {type: 'string', defaultValue});
    },

    /**
     * Retrieves an environment variable and parses it as a boolean.
     * Undefined environment variables or parsing failures will return the default value.
     *
     * @param {string} envName - The name of the environment variable to retrieve.
     * @param {boolean} [defaultValue=false] - The default value to return if the environment variable is not set or cannot be parsed as a boolean.
     * @returns {boolean} The boolean value of the environment variable, or the default value if not set or invalid.
     */
    getEnvBool: function (envName, defaultValue = false) {
        return helpers.baseGetEnv(envName, {type: 'bool', defaultValue});
    },

    /**
     * Retrieves an environment variable and parses it as JSON.
     *
     * @param {string} envName - The name of the environment variable to retrieve.
     * @param {Object} [defaultValue={}] - The default value to return if the environment variable is not set or cannot be parsed as JSON.
     * @returns {Object} The parsed JSON object from the environment variable, or the default value if not set or invalid.
     */
    getEnvJson: function (envName, defaultValue = {}) {
        return helpers.baseGetEnv(envName, {type: 'json', defaultValue});
    },

    /**
     * Reloads the registry on the given page by calling the reload method with clearCache option set to true.
     * After triggering the reload, it waits for the app-side loading indicator to report that loading is finished.
     *
     * @param {puppeteer.Page} page
     * @returns {Promise<void>}
     */
    reloadRegistry: async function (page) {
        await page.evaluate(() => Tine.Tinebase.common.reload({
            clearCache: true
        }));

        // Wait until the app-side loading indicator (if available) reports finished.
        try {
            await page.waitForFunction(() => {
                // guard: if Tine or the method is missing, return true to avoid hanging
                if (typeof window.Tine === 'undefined' || !window.Tine.Tinebase || !window.Tine.Tinebase.common || typeof window.Tine.Tinebase.common.isLoading !== 'function') {
                    return true;
                }
                return !window.Tine.Tinebase.common.isLoading();
            }, { timeout: 10000 });
        } catch (err) {
            console.warn('reloadRegistry: waitForFunction timed out - continuing to wait for UI selector as fallback');
        }

        await page.waitForSelector('.x-btn-text.tine-grid-row-action-icon.renderer_accountUserIcon', {timeout: 20000});
    },

    /**
     * TODO make this work / see tests/e2etests/src/test/Felamimail/grid.test.js:9 ('grid adopts to folder selected')
     *
     * @param {puppeteer.Page} page
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
     * TODO: This method is not used anywhere - check if it can be removed.
     *
     * Sets a preference for a specific app in the Tine20 application and reloads the registry afterwards.
     *
     * @param {puppeteer.Page} page - the page object to perform the actions on
     * @param {string} appName - The name of the app for which the preference should be set (e.g. 'Calendar').
     * @param {string} preference - The name of the preference to set.
     * @param {string} value - The value to set for the preference.
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
     * Clicks a button with the specified text that is part of a split button and handles the click event to open the associated menu.
     *
     * @param {puppeteer.Page} page
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
     * @param {puppeteer.Page} page
     * @param options - The options for taking the screenshot, including the path where the screenshot should be saved.
     * @returns {Promise<void>} A promise that resolves when the screenshot(s) have been taken and saved.
     */
    makeScreenshot: async function (page, options) {
        if (this.getEnvBool('TEST_ALL_SCREENSHOT')) {
            const basePath = options.path;
            if (!basePath) {
                throw new Error('makeScreenshot: missing path for saving a screenshot');
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

                const resolution = this.getEnvJson('TEST_RESOLUTION');
                await page.setViewport(resolution);
                await page.waitForFunction(
                    (m) => document.body.className.includes(`${m}-mode`),
                    { timeout: 2000 },
                    mode
                );

                await page.screenshot({ ...options, path: filePath });
            }
        } else {
            await page.screenshot(options);
        }
    },
};
