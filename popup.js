let settings = {};

window.addEventListener('DOMContentLoaded', async () => {

    /*
     * Execute a function with its arguments in the current tab (instead of in the popup)
     */
    async function executeFunctionInCurrentTab(func, args) {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        const response = await browser.scripting.executeScript({
            target: { tabId: tab.id },
            func: func,
            args: args
        });
        return response[0].result;
    }

    /*
     * Add rpcCall method to the current tab so that it can be called by other methods
     * interacting with the current tab (fetching records, setting value, ...)
     */
    function addRpcCallMethod() {
        window.rpcCall = async function(model, method, args, kwargs) {
            const originUrl = window.location.origin;
            const response = await fetch(`${originUrl}/web/dataset/call_kw/${model}/${method}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    method: 'call',
                    params: { model, method, args: args || [], kwargs: kwargs || {} },
                    id: Math.floor(Math.random() * 1000)
                }),
            });
            return await response.json();
        };
    }

    /*
     * Load mapping and records in the popup
     */
    async function renderRecords(mapping, containerId, fetchFunc, setFunc, deleteFunc, filterFunc, valueFieldName) {
        // Get container
        const container = document.getElementById(containerId);

        // Fetch IAP accounts from the current tab
        const responseJson = await executeFunctionInCurrentTab(fetchFunc, [mapping]);
        if (responseJson?.error) {
            container.textContent = responseJson.error?.data?.message || "Odoo error";
            return;
        }
        const records = responseJson.result || [];

        // VALIDATION FIX: Use replaceChildren() instead of innerHTML = ''
        container.replaceChildren();

        // Insert records in the popup
        container.innerHTML = '';
        for (const [key, choices] of Object.entries(mapping)) {
            if (!choices.show) {
                continue;
            }

            let record = filterFunc(records, key);
            record = record.length >= 1 ? record[0] : {};

            const recordContainer = document.createElement('div');
            recordContainer.className = 'record-container';
            container.appendChild(recordContainer);

            const label = document.createElement('div');
            label.className = 'record-key';
            label.textContent = key;
            recordContainer.appendChild(label);

            const currentValueElem = document.createElement('p');
            currentValueElem.textContent = "Current value: " + (record.id ? record[valueFieldName] : 'Does not exist');
            recordContainer.appendChild(currentValueElem);

            const buttonGroup = document.createElement('div');
            buttonGroup.className = 'button-group';
            recordContainer.appendChild(buttonGroup);

            for (const choice of Object.keys(choices).filter(value => value !== 'show')) {
                const button = document.createElement('button');
                button.textContent = choice;

                // Select by default the current value
                if (record[valueFieldName] === mapping[key][choice]) {
                    button.classList.add('selected');
                }

                // Handle click
                button.addEventListener('click', async () => {
                    button.disabled = true;
                    button.textContent = "...";
                    await executeFunctionInCurrentTab(setFunc, [record, mapping[key][choice], key]);
                    await new Promise(r => setTimeout(r, 500)); // Wait for Odoo DB
                    await setup(); // Re-renders everything
                });

                buttonGroup.appendChild(button);
            }

            // Delete button
            if (deleteFunc) {
                const deleteButton = document.createElement('button');
                deleteButton.textContent = "Delete";
                deleteButton.className = 'delete-button';
                if (!record.id) {
                    deleteButton.classList.add('display-none');
                }
                deleteButton.addEventListener('click', async () => {
                    deleteButton.disabled = true;
                    await executeFunctionInCurrentTab(deleteFunc, [record]);
                    await new Promise(r => setTimeout(r, 500));
                    await setup(); // Re-renders everything
                });
                buttonGroup.appendChild(deleteButton);
            }
        }
    }


    /*
     * Load Config Params in the popup
     */
    async function renderConfigParams() {

        async function fetchConfigParams(mapping) {
            return await window.rpcCall("ir.config_parameter", "search_read", [], {
                domain: [['key', 'in', Object.keys(mapping)]],
                fields: ['key', 'value'],
            });
        }

        async function setConfigParam(record, value, key) {
            const method = record.id ? "write" : "create";
            const args = record.id ? [[record.id], { 'value': value }] : [{ 'key': key, 'value': value }];
            return await window.rpcCall("ir.config_parameter", method, args, {});
        }

        async function deleteConfigParam(record) {
            return await window.rpcCall("ir.config_parameter", "unlink", [[record.id]], {});
        }

        function filterFunc(records, fieldValue) {
            return records.filter((record) => record.key === fieldValue);
        }

        if (!settings.configParamsShow) {
            document.getElementById("config-parameters-section").classList.add("display-none");
        } else {
            document.getElementById("config-parameters-section").classList.remove("display-none");
        }

        await renderRecords(
            settings.configParamsMapping, 'container-config-params',
            fetchConfigParams, setConfigParam, deleteConfigParam,
            filterFunc, "value",
        );
    }


    /*
     * Load IAP Accounts in the popup
     */
    async function renderIapAccounts() {

        async function fetchIapAccounts(mapping) {
            return await window.rpcCall("iap.account", "search_read", [], {
                domain: [['service_name', 'in', Object.keys(mapping)]],
                fields: ['account_token', 'service_name'],
            });
        }
        async function setIAPAccountToken(record, accountToken, serviceName) {
            if (record.id) {
                return await window.rpcCall("iap.account", "write", [[record.id], { 'account_token': accountToken }], {});
            }
            return await window.rpcCall("iap.account", "create", [{ 'service_name': serviceName, 'account_token': accountToken }], {});
        }
        function filterFunc(records, fieldValue) {
            return records.filter((record) => record.service_name === fieldValue);
        }

        if (!settings.iapAccountsShow) {
            document.getElementById("iap-accounts-section").classList.add("display-none");
        } else {
            document.getElementById("iap-accounts-section").classList.remove("display-none");
        }

        await renderRecords(
            settings.iapAccountsMapping, 'container-iap-accounts',
            fetchIapAccounts, setIAPAccountToken, null,
            filterFunc, "account_token",
        );
    }

    async function setup() {
        await executeFunctionInCurrentTab(addRpcCallMethod, []);
        const result = await browser.storage.sync.get('settings');
        settings = result.settings || DEFAULT_SETTINGS;

        // Use Promise.all to load both sections simultaneously
        await Promise.all([renderConfigParams(), renderIapAccounts()]);
    }

    // Settings button listener (only once)
    document.querySelector('#settings-button').addEventListener('click', function() {
        browser.runtime.openOptionsPage();
    });

    await setup();
});
