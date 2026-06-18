const { expect: expectPuppeteer } = require('expect-puppeteer');
const lib = require('../../lib/browser');
require('dotenv').config();
let currentUser;
let adminAccountMenuNode;
let subject;

beforeAll(async () => {
    await lib.getBrowser('E-Mail');
    currentUser = await lib.getCurrentUser(global.page);

    // Shortcut to avoid traversing through the DOM every time.
    adminAccountMenuNode = await getAdminMailAccountMenuNode();
    await expectPuppeteer(adminAccountMenuNode).toMatchElement('span', { text: 'Posteingang' });
    await expectPuppeteer(adminAccountMenuNode).toClick('span', {text: 'Posteingang'});
});

beforeEach(async () => {

})

// skip... is to unstable
describe('test action button of felamimail (grid)', () => {
    test('delete email', async () => {
        // First create a dummy mail with a random subject, send it and check if it appears in the Posteingang.
        await createSendVerifyMail();

        // Select mail and click "delete", no confirmation dialog.
        await expectPuppeteer(global.page).toClick('.x-grid3-cell-inner.x-grid3-col-subject', {text: subject});
        await global.page.click('.t-app-felamimail .x-toolbar-left-row .x-btn-image.action_delete');

        // Right-click on mail account main folder and reload folder list, to make sure the mail really disappeared.
        await expectPuppeteer(adminAccountMenuNode).toClick('.x-tree-node-anchor span', {text: currentUser.accountEmailAddress, button: 'right'});
        await adminAccountMenuNode.waitForSelector('.x-menu.x-menu-floating');
        await expectPuppeteer(adminAccountMenuNode).toClick('.x-menu.x-menu-floating span', {text: 'Ordnerliste aktualisieren'});

        // Open Mülleimer.
        await expectPuppeteer(adminAccountMenuNode).toMatchElement('a span', {text: 'Mülleimer'});
        await expectPuppeteer(adminAccountMenuNode).toClick('a span',{text: "Mülleimer"});

        // Reload list and check if the deleted mail appears.
        await expectPuppeteer(global.page).toClick('.t-app-felamimail .x-btn-image.x-tbar-loading');
        await global.page.waitForFunction(
            (sel, text) => {
                const nodes = Array.from(document.querySelectorAll(sel));
                return nodes.some(n => n.textContent && n.textContent.includes(text));
            },
            {timeout: lib.getEnvInt('TEST_TIMEOUT_GRID_UPDATED')},
            '.x-grid3-cell-inner.x-grid3-col-subject',
            subject
        );

        // Open Posteingang again for next tests.
        await expectPuppeteer(adminAccountMenuNode).toMatchElement('span', { text: 'Posteingang' });
        await expectPuppeteer(adminAccountMenuNode).toClick('span', {text: 'Posteingang'});
    })

    // TODO: Fix following tests, they are broken.

    test.skip('reply mail', async () => {
        await expectPuppeteer(global.page).toClick('.x-grid3-cell-inner.x-grid3-col-subject', {text: subject});
        const newWindowPromis = lib.getNewWindow();
        await global.page.click(('.t-app-felamimail .x-toolbar-left-row .x-btn-image.action_email_reply'));

        await sendMail('reply',newWindowPromis);

        await expectPuppeteer(global.page).toClick('.x-grid3-cell-inner.x-grid3-col-subject', {text: 'reply'});
    })
    test.skip('all reply mail', async () => {
        await expectPuppeteer(global.page).toClick('.x-grid3-cell-inner.x-grid3-col-subject', {text: subject});
        const newWindowPromis = lib.getNewWindow();
        await global.page.click(('.t-app-felamimail .x-toolbar-left-row  .x-btn-image.action_email_replyAll'));

        await sendMail('replyAll',newWindowPromis, true);

        await expectPuppeteer(global.page).toClick('.x-grid3-cell-inner.x-grid3-col-subject', {text: 'replyAll'});
    })
    test.skip('forward email', async () => {
        await expectPuppeteer(global.page).toClick('.x-grid3-cell-inner.x-grid3-col-subject', {text: subject});
        const newWindowPromis = lib.getNewWindow();
        await global.page.click(('.t-app-felamimail .x-toolbar-left-row .x-btn-image.action_email_forward'));

        await sendMail('forward',newWindowPromis, true);

        await expectPuppeteer(global.page).toClick('.x-grid3-cell-inner.x-grid3-col-subject', {text: 'forward'});
    })
});

afterAll(async () => {
    global.browser.close();
});

async function getAdminMailAccountMenuNode() {
    const selector = '.x-tree-node-el.felamimail-node-account .x-tree-node-anchor span';

    // Wait for the admin email menu appears.
    await global.page.waitForFunction(
        (sel, contains) => {
            const spans = Array.from(document.querySelectorAll(sel));
            const span = spans.find(s => s.textContent.trim() === contains);
            return !!span;
        },
        {timeout: lib.getEnvInt('TEST_TIMEOUT_CONTENT_READY')},
        selector,
        currentUser.accountEmailAddress
    );

    // Find the part that only includes the admin email menu with its folders.
    const adminMenuHandle = await global.page.evaluateHandle((sel, txt) => {
        const spans = Array.from(document.querySelectorAll(sel));
        const span = spans.find(s => s.textContent.trim() === txt);
        return span ? span.closest('li.x-tree-node') : null;
    }, selector, currentUser.accountEmailAddress);

    const li = adminMenuHandle.asElement();
    if (!li) throw new Error(`li with span text "${currentUser.accountEmailAddress}" not found`);

    return li;
}

async function createSendVerifyMail(){
    let popupWindow = await lib.getEditDialog('Verfassen');
    subject = 'test '+ Math.round(Math.random() * 10000000);

    // TODO: Move to helper function, see timesheet.test.js -> test('Select time account')
    // Add recipient.
    // Wait for the recipients inputs, enter current user's email into first occurrence, click on
    // first selected entry of combo box, wait for the user's email to appear in the field.
    await popupWindow.waitForSelector('.felamimail-recipient-grid input[type=text]');
    await expectPuppeteer(popupWindow).toFill('.felamimail-recipient-grid input[type=text]', currentUser.accountEmailAddress);
    await popupWindow.waitForSelector('.search-item.x-combo-selected');
    await expectPuppeteer(popupWindow).toClick('.search-item.x-combo-selected');
    await popupWindow.waitForFunction(
        (sel, contains) => {
            const el = document.querySelector(sel);
            return !!el && el.innerText.indexOf(contains) !== -1;
        },
        {timeout: lib.getEnvInt('TEST_TIMEOUT_FORM_VALUE_CHANGED')},
        '.tinebase-contact-link .responsive-grid-text-small',
        currentUser.accountEmailAddress
    );

    // Add subject.
    await lib.formInsertInputValue(popupWindow, 'input[name=subject]', subject);

    // Send mail, this will automatically close the popup.
    await expectPuppeteer(popupWindow).toClick('button', {text: 'Senden'});

    // Reload grid and compare the values.
    await global.page.waitForSelector('.t-app-felamimail .x-btn-image.x-tbar-loading');
    await expectPuppeteer(global.page).toClick('.t-app-felamimail .x-btn-image.x-tbar-loading');
    await global.page.waitForFunction(
        (sel, text) => {
            const nodes = Array.from(document.querySelectorAll(sel));
            return nodes.some(n => n.textContent && n.textContent.includes(text));
        },
        {timeout: lib.getEnvInt('TEST_TIMEOUT_GRID_UPDATED')},
        '.x-grid3-cell-inner.x-grid3-col-subject',
        subject
    );
    await expectPuppeteer(global.page).toMatchElement('.x-grid3-cell-inner.x-grid3-col-subject', {text: subject, visible: true});
    await expectPuppeteer(global.page).toMatchElement('.x-grid3-cell-inner.x-grid3-col-from_email', {text: currentUser.accountEmailAddress, visible: true});
    await expectPuppeteer(global.page).toMatchElement('.x-grid3-cell-inner.x-grid3-col-from_name', {text: currentUser.accountFullName, visible: true});
}

async function sendMail(subject, newWindowPromis, user= false) {
    let popupWindow = await newWindowPromis;
    try {
        await popupWindow.waitForSelector('.ext-el-mask', {timeout: 5000});
    } catch {}
    await popupWindow.waitForFunction(() => !document.querySelector('.ext-el-mask'));
    await new Promise(r => setTimeout(r, 3000)); //musst wait for input!

    if(user) {
        // add recipient
        let inputFields = await popupWindow.$$('input');
        await inputFields[2].type(currentUser.accountEmailAddress);
        await popupWindow.waitForSelector('.search-item.x-combo-selected');
        await popupWindow.click('.search-item.x-combo-selected');
        await new Promise(r => setTimeout(r, 1000)); //wait for new mail line!
    }
    await new Promise(r => setTimeout(r, 1000)); //wait for new mail line!
    await popupWindow.keyboard.press('Tab');
    await new Promise(r => setTimeout(r, 1000));
    await popupWindow.click('input[name=subject]');
    await new Promise(r => setTimeout(r, 1000));
    await expectPuppeteer(popupWindow).toFill('input[name=subject]', subject);

    // send message
    await expectPuppeteer(popupWindow).toClick('button', {text: 'Senden'});

    await new Promise(r => setTimeout(r, 2000)); //wait to close editDialog

    for(let i = 0; i < 10; i++) {
        await global.page.click('.t-app-felamimail .x-btn-image.x-tbar-loading');
        await new Promise(r => setTimeout(r, 500));
        try{
            await expectPuppeteer(global.page).toMatchElement('.x-grid3-cell-inner.x-grid3-col-subject', {text: subject, timeout: 2000});
            break;
        } catch(e){
            console.warn(`mail with subject ${subject} not received with attempt #${i+1}`)
        }
    }
}
