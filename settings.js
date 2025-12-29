// settings.js

const SettingsManager = {
    async getMergedConfig(jsonDefaults) {
        const stored = await browser.storage.local.get("goldfishSettings");
        const userOverrides = stored.goldfishSettings || {};
        const merged = JSON.parse(JSON.stringify(jsonDefaults));

        for (const key in merged) {
            if (userOverrides[key]) {
                // Only copy values that exist in the original JSON structure
                for (const param in merged[key]) {
                    if (userOverrides[key][param] !== undefined) {
                        merged[key][param] = userOverrides[key][param];
                    }
                }
            }
        }
        return merged;
    },

    async saveEventParams(eventKey, params) {
        const stored = await browser.storage.local.get("goldfishSettings");
        const settings = stored.goldfishSettings || {};
        settings[eventKey] = params;
        await browser.storage.local.set({ goldfishSettings: settings });
        console.log(`Saved parameters for ${eventKey}`);
    },

    async clearSettings() {
        await browser.storage.local.remove("goldfishSettings");
        console.log("All custom settings cleared.");
    }
};