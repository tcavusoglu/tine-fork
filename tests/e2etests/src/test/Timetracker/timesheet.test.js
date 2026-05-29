const { expect: expectPuppeteer } = require('expect-puppeteer');
const lib = require('../../lib/browser');

// TODO: Create a dummy time account in the test setup, use it for testing instead of relying on existing data, and delete it again.

beforeAll(async () => {
    await lib.getBrowser('Zeiterfassung', 'Stundenzettel');
});

describe('Create and delete time sheet', () => {
    const testDescription = 'test description ' + Math.round(Math.random() * 10000000);
    let popupWindow = null;

    test('Open dialog', async () => {
        popupWindow = await lib.getEditDialog('Stundenzettel hinzufügen', global.page);
        await expectPuppeteer(popupWindow).toMatchElement('span.x-tab-strip-text', {text: 'Stundenzettel'});
    });

    test('Select time account', async() => {
        await popupWindow.waitForSelector('[name="timeaccount_id"]');
        await expectPuppeteer(popupWindow).toFill('[name="timeaccount_id"]', 'test');
        await popupWindow.waitForSelector('.x-combo-list-item');
        await expectPuppeteer(popupWindow).toClick('.x-combo-list-item', {text: '1 - Test Timeaccount 1'});
    });

    test('Enter start and end time', async() => {
        const currentUser = await lib.getCurrentUser(popupWindow);
        const duration = {selector: 'input[name="duration"]', value: '03:30'};
        const start = {selector: 'input[name="start_time"]', value: '08:00'};

        // TODO: Try using .waitForNetworkIdle() instead of waiting for the selectors.
        await popupWindow.waitForSelector(duration.selector, { visible: true });
        await popupWindow.waitForSelector(start.selector, { visible: true });

        // Enter the values and wait until they are set in the input fields.
        await expectPuppeteer(popupWindow).toFillForm('form.x-form', {
            duration: duration.value,
            start_time: start.value,
        });
        await popupWindow.waitForFunction(
            (sel, expected) => {
                const el = document.querySelector(sel);
                return !!el && el.value.trim() === expected;
            },
            { timeout: lib.getEnvInt('TEST_TIMEOUT_FORM_VALUE_CHANGED') },
            duration.selector,
            duration.value
        );
        await popupWindow.waitForFunction(
            (sel, expected) => {
                const el = document.querySelector(sel);
                return !!el && el.value.trim() === expected;
            },
            { timeout: lib.getEnvInt('TEST_TIMEOUT_FORM_VALUE_CHANGED') },
            start.selector,
            start.value
        );

        // Check if the current username is correct.
        expect(await popupWindow.evaluate(() => document.querySelector('input[name=account_id]').value)).toEqual(currentUser.accountDisplayName);
    });

    test('Enter description', async () => {
        await popupWindow.waitForSelector('[name="description"]', { visible: true });
        await expectPuppeteer(popupWindow).toClick('[name="description"]');
        await expectPuppeteer(popupWindow).toFill('[name=description]', testDescription);
    });

    test('Confirm', async() => {
        await expectPuppeteer(popupWindow).toClick('button', {text: 'Ok'});
    });

    test('Check values in the grid', async() => {
        // Reload list and wait until the new entry appears in the grid.
        await global.page.waitForSelector('.t-app-timetracker .x-btn-image.x-tbar-loading');
        await expectPuppeteer(global.page).toClick('.t-app-timetracker .x-btn-image.x-tbar-loading');
        await global.page.waitForFunction(
            (text) => {
                const nodes = Array.from(document.querySelectorAll('div.x-grid3-col-description'));
                return nodes.some(n => n.textContent && n.textContent.includes(text));
            },
            {timeout: lib.getEnvInt('TEST_TIMEOUT_GRID_UPDATED')},
            testDescription
        );
        await expectPuppeteer(global.page).toMatchElement('div.x-grid3-col-timeaccount_id', {text: '1 - Test Timeaccount 1', visible: true});
        await expectPuppeteer(global.page).toMatchElement('div.x-grid3-col-description', {text: testDescription, visible: true});
        await expectPuppeteer(global.page).toMatchElement('div.x-grid3-col-duration span.duration-renderer-medium', {text: '3 Stunden, 30 Minuten'});
        await expectPuppeteer(global.page).toMatchElement('div.x-grid3-col-duration span.duration-renderer-small', {text: '3:30', visible: true});
        await expectPuppeteer(global.page).toMatchElement('div.x-grid3-col-accounting_time span.duration-renderer-medium', {text: '3 Stunden, 30 Minuten', visible: true});

    });

    test('Delete and confirm', async() => {
        // Click on entry and press Delete key.
        await expectPuppeteer(global.page).toClick('div.x-grid3-col-description', {text: testDescription, visible: true});
        await global.page.waitForSelector('.x-grid3-row-selected', { visible: true, timeout: lib.getEnvInt('TEST_TIMEOUT_ACTIONABLE') });
        await global.page.keyboard.press('Delete');

        // Wait for modal confirmation dialog to appear, click on "Ja" and wait until the dialog disappears.
        await global.page.waitForSelector('.btn.btn-md.vue-button.yes-button', {visible: true});
        await expectPuppeteer(global.page).toClick('.btn.btn-md.vue-button.yes-button', {text: 'Ja', visible: true});
        try {
            await global.page.waitForSelector('.btn.btn-md.vue-button.yes-button', {hidden: true, timeout: lib.getEnvInt('TEST_TIMEOUT_POPUP_CLOSE')});
        } catch (e) {
            // If the selector is still visible after the timeout, we can assume that the confirmation dialog did not close properly.
            throw new Error('Confirmation dialog did not close after confirming deletion');
        }

        // Refresh grid and check for absence of the entry.
        await global.page.waitForSelector('.t-app-timetracker .x-btn-image.x-tbar-loading');
        await global.page.click('.t-app-timetracker .x-btn-image.x-tbar-loading');
        await global.page.waitForFunction(
            (text) => {
                const nodes = Array.from(document.querySelectorAll('div.x-grid3-col-description'));
                return !nodes.some(n => n.textContent && n.textContent.includes(text));
            },
            { timeout: lib.getEnvInt('TEST_TIMEOUT_GRID_UPDATED') },
            testDescription
        );
        await expectPuppeteer(global.page).not.toMatchElement('div.x-grid3-col-description', {text: testDescription});
    });
});

afterAll(async () => {
    global.browser.close();
});
