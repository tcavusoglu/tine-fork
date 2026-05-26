const { expect: expectPuppeteer } = require('expect-puppeteer');
const lib = require('../../lib/browser');

require('dotenv').config();

//@todo some demodata in editDialog?
// TODO: Use process.env.TEST_TIMEOUT_* instead of magic numbers.

beforeAll(async () => {
    await lib.getBrowser('Zeiterfassung');
    await lib.makeScreenshot(
        global.page, {path: 'screenshots/Zeiterfassung/1_zeiterfassung_module.png',
        clip: {x: 0, y: 0, width: 150, height: 300}}
    )
});

describe('timeaccount', () => {
    describe('Edit Timeaccount', () => {
        let editDialog;
        test('mainpage Zeitkonten', async () => {
            await expectPuppeteer(global.page).toClick('.tine-mainscreen-centerpanel-west span', {text: 'Zeitkonten'});
        });
        test('open Zeitkonto hinzufügen popup dialog', async () => {
            editDialog = await lib.getEditDialog('Zeitkonto hinzufügen');
            await lib.makeScreenshot(editDialog,{path: 'screenshots/Zeiterfassung/2_zeiterfassung_zeitkonto_neu.png'});
        });

        test('permissions tab', async () => {
            await expectPuppeteer(editDialog).toClick('.x-tab-panel-header .x-tab-strip-text', {text: 'Zugriffsrechte'});
            await editDialog.waitForSelector('.x-grid3-viewport', { visible: true, timeout: 10000 });
            await lib.makeScreenshot(editDialog,{path: 'screenshots/Zeiterfassung/3_zeiterfassung_zeitkonto_rechte.png'});
            await expectPuppeteer(editDialog).toClick('button', {text: 'Abbrechen'});
        })
    });
});

describe('timetracker', () => {
    describe('Edit Timesheet', () => {
        let editDialog;
        test('mainpage Stundenzettel', async () => {
            // Very precise CSS selector due to two "Stundenzettel" Module menu items with the exact same name.
            await expectPuppeteer(global.page).toClick('.tine-mainscreen-centerpanel-west-modules .x-tree-node-el img.TimetrackerTimesheet + a.x-tree-node-anchor span', {text: 'Stundenzettel'});
        });

        test('open Stundenzettel hinzufügen popup dialog', async () => {
            editDialog = await lib.getEditDialog('Stundenzettel hinzufügen');
            await lib.makeScreenshot(editDialog,{path: 'screenshots/Zeiterfassung/4_zeiterfassung_stundenzettel_neu.png'});
            await expectPuppeteer(editDialog).toClick('button', {text: 'Abbrechen'});
        });
    });
});

afterAll(async () => {
    global.browser.close();
});
