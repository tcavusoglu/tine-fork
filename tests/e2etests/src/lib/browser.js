const helpers = require('./browser.helpers');

const puppeteer = require('puppeteer');
const { expect: expectPuppeteer, setDefaultOptions } = require('expect-puppeteer');
require('dotenv').config();

const mkdirp = require('mkdirp');
const fs = require('fs');
const path = require('path');
const uuid = require('uuid');

const modes = ['light', 'dark'];
const resolution = JSON.parse(process.env.TEST_RESOLUTION);

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

        // Set the global variables.
        browser = await helpers.launchBrowser();
        page = await helpers.createConfiguredPage(browser);
        const localPage = page;

        await localPage.goto(process.env.TEST_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await expectPuppeteer(localPage).toMatchElement('title', { text: process.env.TEST_BRANDING_TITLE });

        await helpers.switchToGermanIfNeeded(expectPuppeteer, localPage);
        await helpers.login(expectPuppeteer, localPage, {
            user: process.env.TEST_USERNAME,
            pass: process.env.TEST_PASSWORD
        });

        await localPage.waitForSelector('.tine-dock', {timeout: 0});

        if (!!+process.env.MFA) {
            // TODO: second parameter might not work
            await localPage.waitForSelector('.x-window-header-text', {text: 'Multi Faktor Authentifikation'});
            const mfaDialog = await this.getEditDialog('OK');
            await expectPuppeteer(mfaDialog).toClick('button', {text: "Abbrechen"});
        }

        if (app) {
            await expectPuppeteer(localPage).toClick('.action_menu.application-menu-btn');
            await localPage.waitForSelector('.application-menu-item');
            await expectPuppeteer(localPage).toClick('.application-menu-item__text', { text: app });
        }
        if (module) {
            // TODO: second parameter might not work
            await localPage.waitForSelector('span', { text: 'Module' });
            await expectPuppeteer(localPage).toClick('.tine-mainscreen-centerpanel-west .x-tree-node a span', {text: module});
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

        // Set the global variables.
        browser = await helpers.launchBrowser();
        page = await helpers.createConfiguredPage(browser,{
            auth: {
                username: process.env.HTACCESS_USERNAME,
                password: process.env.HTACCESS_PASSWORD
            }
        });
        const localPage = page;

        localPage.setDefaultTimeout(15000);

        await localPage.goto(process.env.TEST_URL + '/setup.php', {waitUntil: 'domcontentloaded', timeout: 30000});
        await expectPuppeteer(localPage).toMatchElement('title', {text: process.env.TEST_BRANDING_TITLE});

        await helpers.switchToGermanIfNeeded(expectPuppeteer, localPage);
        await helpers.login(expectPuppeteer, localPage, {
            user: process.env.SETUP_USERNAME,
            pass: process.env.SETUP_PASSWORD
        });

        await localPage.waitForSelector('.account-user-avatar', {timeout: 0});
    },

    /**
     * Downloads a file by clicking the specified selector and returns the path to the downloaded file.
     * The file will be downloaded to a temporary directory created for each download.
     *
     * @param {puppeteer.Page} localPage - The page object to perform the download on.
     * @param {string} selector - The selector of the element to click for initiating the download.
     * @param {Object} [option] - Optional options for the click action.
     * @returns {Promise<string>} A promise that resolves to the path of the downloaded file.
     */
    download: async function (localPage, selector, option = {}) {
        const downloadPath = path.resolve(__dirname, 'download', uuid.v1());
        // TODO: Check if this is working at all
        mkdirp(downloadPath);
        console.log('Downloading file to:', downloadPath);
        const cdpSession = await localPage.createCDPSession();
        await cdpSession.send('Page.setDownloadBehavior', {behavior: 'allow', downloadPath: downloadPath});
        await expectPuppeteer(localPage).toClick(selector, option);
        let filename = await helpers.waitForFileToDownload(fs, downloadPath);
        return path.resolve(downloadPath, filename);
    },

    /**
     * Uploads a file by finding an input element of type "file" on the page and using its uploadFile method.
     *
     * @param {puppeteer.Page} localPage - The page object to perform the file upload on.
     * @param {string} file - The path to the file that should be uploaded.
     * @returns {Promise<void>} A promise that resolves when the file has been set for upload.
     */
    uploadFile: async function (localPage, file) {
        let inputUploadHandle;

        inputUploadHandle = await localPage.$('input[type=file]');
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
                reject(new Error('getNewWindow: global browser is not initialized'));
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
     * @param {puppeteer.Page} [window] - The page object to search for the button. Defaults to the main page.
     * @returns {Promise<puppeteer.Page>} A promise that resolves to the new page object of the opened window.
     */
    getEditDialog: async function (btnText, window = null) {
        const ctx = window || page;
        await expectPuppeteer(ctx).toMatchElement('.x-btn-text', {text: btnText, visible: true});

        const popupPromise = this.getNewWindow();
        await expectPuppeteer(ctx).toClick('.x-btn-text', {text: btnText});

        const popupWindow = await popupPromise;
        await helpers.proxyConsole(popupWindow);

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
     * @param {puppeteer.Page} localPage
     * @param text
     * @returns {Promise<*>}
     */
    getElement: async function (type, localPage, text) {
        return localPage.$x("//" + type + "[contains(., '" + text + "')]");
    },

    /**
     * Retrieves the current user information from the registry on the given page.
     *
     * @param {puppeteer.Page} localPage
     * @returns {Promise<*>}
     */
    getCurrentUser: async function (localPage) {
        return localPage.evaluate(() => Tine.Tinebase.registry.get('currentAccount'));
    },

    /**
     * Reloads the registry on the given page by calling the reload method with clearCache option set to true.
     *
     * @param {puppeteer.Page} localPage
     * @returns {Promise<void>}
     */
    reloadRegistry: async function (localPage) {
        await localPage.evaluate(() => Tine.Tinebase.common.reload({
            clearCache: true
        }));
        // TODO: Replace setTimeout()
        await new Promise(r => setTimeout(r, 1000));
        await localPage.waitForSelector('.x-btn-text.tine-grid-row-action-icon.renderer_accountUserIcon', {timeout: 20000});
    },

    /**
     * TODO make this work / see tests/e2etests/src/test/Felamimail/grid.test.js:9 ('grid adopts to folder selected')
     *
     * @param {puppeteer.Page} localPage
     * @param selector
     * @param visible
     * @returns {Promise<unknown>}
     */
    checkDisplayOfElement: async function (localPage, selector, visible) {
        // TODO allow to pass selector to querySelector
        const el_display = await localPage.evaluate((selector) => document.querySelector(selector).style.display);
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
     * @param {puppeteer.Page} localPage - the page object to perform the actions on
     * @param appName - the name of the app for which the preference should be set (e.g. 'Calendar')
     * @param preference
     * @param value
     * @returns {Promise<void>}
     */
    setPreference: async function (localPage, appName, preference, value) {
        console.log('setting preference ' + preference + ' of app '
            + appName + ' to "' + value + '"');

        await localPage.waitForSelector('.x-btn-text.tine-grid-row-action-icon.renderer_accountUserIcon');
        await localPage.click('.x-btn-text.tine-grid-row-action-icon.renderer_accountUserIcon');
        const frame = await expectPuppeteer(localPage).toMatchElement('.x-menu.x-menu-floating.x-layer', {visible: true});
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

        await this.reloadRegistry(localPage);
        await localPage.waitForSelector('.x-tab-strip-closable.x-tab-with-icon.tine-mainscreen-apptabspanel-menu-tabel', {timeout: 0});
    },

    /**
     * Clicks a button with the specified text that is part of a split button and handles the click event to open the associated menu.
     *
     * @param {puppeteer.Page} localPage
     * @param text
     * @returns {Promise<void>}
     */
    clickSplitButton: async function (localPage, text) {
        return await localPage.evaluate((text) => {
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
     * @param {puppeteer.Page} localPage
     * @param options - The options for taking the screenshot, including the path where the screenshot should be saved.
     * @returns {Promise<void>} A promise that resolves when the screenshot(s) have been taken and saved.
     */
    makeScreenshot: async function (localPage, options) {
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

                await localPage.evaluate((m) => {
                    document.body.className = document.body.className.replace(
                        /(light|dark)-mode/,
                        `${m}-mode`
                    );
                }, mode);

                await localPage.setViewport(resolution);
                // TODO: Replace setTimeout()
                await new Promise(r => setTimeout(r, 500));

                await localPage.screenshot({ ...options, path: filePath });
            }
        } else {
            await localPage.screenshot(options);
        }
    },
};
