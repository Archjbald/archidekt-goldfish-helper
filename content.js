// content.js
var browser = browser || chrome;

console.log("Goldfish Helper extension loaded");

let lastUrl = window.location.href;
let currentTurn = 0;
let isInitialized = false;
let isObservingTurns = false;
let creatureCount = 0;
let creatureObserver = null;
let activeThreats = []; // Array of { id, message, turnsLeft, icon }
let pastEvents = [];

let EVENT_TABLE = {};

async function loadEventTable() {
    try {
        const url = browser.runtime.getURL("config/events.json");
        const response = await fetch(url);
        EVENT_TABLE = await response.json();
        console.log("Event Table loaded from JSON");
    } catch (error) {
        console.error("Failed to load events.json:", error);
    }
}

function simulateEvent(turn, currentCreatures) {
    const random = Math.random();
    let cumulative = 0;

    console.log(`Turn: ${turn} | Draw: ${random.toFixed(3)}`);
    // Check if there is a 'wipe_needed' threat currently active
    const wipeIsNeeded = activeThreats.some(t => t.message.includes("wipe_needed") || t.id === "wipe_needed_id");

    for (const [key, data] of Object.entries(EVENT_TABLE)) {
        if (data.enabled === false) continue;

        let baseProb = 0; // Declare base outside the block
        if (turn >= (data.firstTurn || 0)) { // Add parentheses
            baseProb = (data.baseProb || 0) + ((turn - (data.firstTurn || 0)) * (data.turnCoeff || 0));
        }

        const pastSimilar = pastEvents.filter(obj => obj.message === data.message).length;

        // If someone needs a wipe, the chance of a Board Wipe increases by 10%
        let wipeBoost = (key === 'board_wipe' && wipeIsNeeded) ? 0.10 : 0;

        const modifier = (
            currentCreatures * (data.threatWeight || 0) +
            -0.05 * pastSimilar +
            wipeBoost
        );

        const finalProb = Math.max(baseProb + modifier, 0);
        cumulative += finalProb;

        console.log(
            `- ${key}: Base ${baseProb.toFixed(2)} | ` +
            `Mod ${modifier.toFixed(2)} (WipeBoost: ${wipeBoost}) | ` +
            `Total: ${finalProb.toFixed(2)} | ` +
            `Range: ${(cumulative - finalProb).toFixed(2)} - ${cumulative.toFixed(2)}`
        );

        if (random < cumulative) {
            pastEvents.push(data);

            // NEW: If a real board wipe happens, clear the "wipe needed" threats
            if (key === 'board_wipe') {
                activeThreats = activeThreats.filter(t => !t.isWipeThreat);
                console.log("A board wipe occurred! Clearing 'Wipe Needed' threats.");
            }

            return data;
        }
    }
    return null;
}

async function toggleSettingsMenu(specificEventKey = null, isBackAction = false) {
    let menu = document.getElementById("goldfish-settings-menu");

    if (menu) {
        menu.remove();
        if (!specificEventKey && !isBackAction) return;
    }

    menu = document.createElement("div");
    menu.id = "goldfish-settings-menu";
    menu.className = "settings-overlay";

    if (!specificEventKey) {
        // --- MAIN MENU ---
        menu.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                <h4 style="margin: 0;">Event Settings</h4>
                <button id="reset-all-settings" class="reset-btn" style="font-size: 10px; padding: 2px 6px; cursor: pointer;">Reset All</button>
            </div>
        `;

        menu.querySelector("#reset-all-settings").onclick = async () => {
            if (confirm("Are you sure you want to erase all modified parameters and reload defaults?")) {
                await SettingsManager.clearSettings(); //
                await loadEventTable(); // Reloads the base JSON
                toggleSettingsMenu(null, true); // Refresh the UI
            }
        };

        for (const [key, data] of Object.entries(EVENT_TABLE)) {
            const row = document.createElement("div");
            row.className = "settings-row main-link"; // Ensures the row is a flex container
            row.innerHTML = `
                <input type="checkbox" ${data.enabled !== false ? 'checked' : ''} id="check-${key}">
                <div class="event-name">
                    <span>${key.replace(/_/g, ' ')}</span>
                    <span>&#11157;</span>
                </div>
            `;

            row.querySelector(`#check-${key}`).onclick = (e) => {
                e.stopPropagation();
                data.enabled = e.target.checked;
                SettingsManager.saveEventParams(key, data);
            };

            row.querySelector(".event-name").onclick = () => toggleSettingsMenu(key);
            menu.appendChild(row);
        }
    } else {
        const data = EVENT_TABLE[specificEventKey];
        menu.innerHTML = `
                <div class="drilldown-header">
                    <button id="back-settings" class="back-btn">&#11013;</button>
                    <h4 style="margin:0; margin-left:10px; flex-grow:1;">${specificEventKey.replace(/_/g, ' ')}</h4>
                </div>
                <div id="params-list"></div>
            `;

        const paramsList = menu.querySelector("#params-list");

        for (const [param, value] of Object.entries(data)) {
            if (typeof value === 'number') {
                const formattedLabel = param.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());

                const pRow = document.createElement("div");
                pRow.className = "param-input-row";
                pRow.innerHTML = `
                    <label class="param-label">${formattedLabel}</label>
                    <input type="number" step="0.01" class="param-input" value="${value}" data-param="${param}">
                `;
                paramsList.appendChild(pRow);
            }
        }

        menu.querySelector("#back-settings").onclick = () => {
            paramsList.querySelectorAll("input").forEach(input => {
                const param = input.getAttribute("data-param");
                data[param] = parseFloat(input.value) || 0;
            });
            SettingsManager.saveEventParams(specificEventKey, data);
            toggleSettingsMenu(null, true);
        };
    }
    document.body.appendChild(menu);
}

function updateWidget(type, data = {}) {
    // 1. Find the existing widget from widget.html
    const widget = document.getElementById("goldfish-widget");
    if (!widget) return; // Wait for initializeWidget to load the HTML

    // 2. Target a specific area for content so we don't delete the Gear button
    let contentArea = widget.querySelector("#widget-content-area");
    if (!contentArea) {
        // Fallback if the ID isn't in your HTML yet
        contentArea = document.createElement("div");
        contentArea.id = "widget-content-area";
        widget.appendChild(contentArea);
    }

    // 3. Clear ONLY the content area
    contentArea.innerHTML = '';

    if (type === "LOGO") {
        const logoDiv = document.createElement("div");
        logoDiv.className = "logo";
        const img = document.createElement("img");
        img.src = browser.runtime.getURL("assets/logo_clean.png");
        img.alt = "Goldfish Helper";
        logoDiv.appendChild(img);
        contentArea.appendChild(logoDiv);
    } else if (type === "EVENT") {
        // Row 1: Turn Number
        const turnElement = document.createElement("div");
        turnElement.className = "turn-number";
        turnElement.textContent = `Turn: ${data.turn}`;
        contentArea.appendChild(turnElement);

        // Row 2: Event Message
        const messageElement = document.createElement("div");
        messageElement.className = "widget-content";
        if (data.event) {
            messageElement.innerHTML = `<span>${data.event.icon || ""}</span> <span>${data.event.message}</span>`;
        } else {
            messageElement.textContent = "No new event";
        }
        contentArea.appendChild(messageElement);

        // Row 3: Threat Countdown Button
        if (activeThreats.length > 0) {
            const threatContainer = document.createElement("div");
            threatContainer.className = "threat-container";
            threatContainer.style.marginTop = "10px";

            activeThreats.forEach(threat => {
                const threatButton = document.createElement("button");
                threatButton.className = "threat-button";

                // Apply dynamic color
                const bgColor = getThreatColor(threat.turnsLeft, threat.totalDuration);
                threatButton.style.backgroundColor = bgColor;

                const isGameOver = threat.turnsLeft <= 0;
                threatButton.textContent = isGameOver
                    ? `\u{2620}\u{FE0F} DEAD: ${threat.message}`
                    : `${threat.icon} ${threat.turnsLeft} turns: Resolve ${threat.name || " "}`;

                if (isGameOver) threatButton.style.backgroundColor = "black";

                threatButton.onclick = () => {
                    // Remove ONLY this threat from the array
                    activeThreats = activeThreats.filter(t => t.id !== threat.id);
                    updateWidget("EVENT", {turn: currentTurn, event: null});
                };

                threatContainer.appendChild(threatButton);
            });
            contentArea.appendChild(threatContainer);
        }
    }
}

function removeWidget() {
    const widget = document.getElementById("goldfish-widget");
    if (widget) widget.remove();
}

async function initializeWidget() {
    // 1. Load the external JSON config first
    await loadEventTable();

    // 2. Apply local storage overrides via SettingsManager
    if (typeof SettingsManager !== 'undefined') {
        EVENT_TABLE = await SettingsManager.getMergedConfig(EVENT_TABLE);
    }

    // 3. FETCH AND INJECT THE WIDGET HTML
    // This step is required to put the "gear-btn" and "widget-content-area" on the page
    const resp = await fetch(browser.runtime.getURL("assets/widget.html"));
    const htmlText = await resp.text();
    document.body.insertAdjacentHTML('beforeend', htmlText);

    // 4. Attach the Gear Button Logic
    // Now that the HTML is injected, we can find the button
    const gearBtn = document.getElementById("gear-btn");
    if (gearBtn) {
        gearBtn.onclick = (e) => {
            e.stopPropagation();
            toggleSettingsMenu();
        };
    }

    // 5. Load the CSS from the assets folder
    if (!document.getElementById('goldfish-style')) {
        const link = document.createElement('link');
        link.id = 'goldfish-style';
        link.rel = 'stylesheet';
        link.href = browser.runtime.getURL('assets/styles.css');
        document.head.appendChild(link);
    }

    updateWidget("LOGO");
    isInitialized = true;
}

function updateCreatureCount() {
    const playArea = document.getElementById("play-area-v2");
    if (!playArea) {
        creatureCount = 0;
        return 0;
    }

    const cards = playArea.querySelectorAll('.basicCard_container__rDv6F');
    let count = 0;

    cards.forEach(card => {
        if (card.innerText.includes("Creature") || card.getAttribute('title')?.includes("Creature")) {
            count++;
        }
    });

    if (count !== creatureCount) {
        creatureCount = count;
        console.log("Creature count changed! New total:", creatureCount);
    }
    return creatureCount;
}

function startCreatureMonitoring() {
    const playArea = document.getElementById("play-area-v2");
    if (!playArea || creatureObserver) return;

    console.log("Starting targeted creature monitoring on play-area");
    creatureObserver = new MutationObserver(() => {
        updateCreatureCount();
    });
    creatureObserver.observe(playArea, {childList: true});
    updateCreatureCount();
}

function checkPlaytester() {
    const isInPlaytester = window.location.href.includes("archidekt.com/playtester-v2");

    if (!isInPlaytester) {
        removeWidget();
        if (creatureObserver) {
            creatureObserver.disconnect();
            creatureObserver = null;
        }
        isInitialized = false;
        isObservingTurns = false;
    } else if (!isInitialized) {
        initializeWidget();
        observeTurnChanges();
        startCreatureMonitoring();
    }
}

function getCurrentTurn() {
    const turnElement = document.querySelector('.manaOptions_triggerGroup__53lv7');
    if (turnElement) {
        const text = turnElement.textContent.trim();
        const match = text.match(/: (\d+)/);
        if (match && match[1]) {
            return parseInt(match[1]);
        }
    }
    return 0;
}

function getThreatColor(turnsLeft, totalDuration) {
    if (turnsLeft <= 0) return "#000000"; // Black for Game Over

    // Calculate percentage (1.0 = fresh, 0.0 = urgent)
    const ratio = Math.min((turnsLeft - 1) / (totalDuration - 1), 1);

    // HSL: 0 is red, 120 is green.
    const hue = ratio * 120;
    return `hsl(${hue}, 70%, 45%)`;
}

function observeTurnChanges() {
    if (isObservingTurns) return;
    const targetNode = document.querySelector('.manaOptions_triggerGroup__53lv7');

    if (!targetNode) {
        updateWidget("LOGO");
        setTimeout(observeTurnChanges, 1000);
        return;
    }

    isObservingTurns = true;
    const config = {childList: true, subtree: true, characterData: true};

    const callback = function () {
        const newTurn = getCurrentTurn();
        if (newTurn !== currentTurn) {
            currentTurn = newTurn;

            if (currentTurn === 0) {
                activeThreats = [];
                pastEvents = [];
                updateWidget("LOGO");
            } else {
                // --- MODIFICATION STARTS HERE ---

                // 1. Progress and potentially Self-Resolve existing threats
                activeThreats = activeThreats.filter(threat => {
                    // Reduce countdown
                    if (threat.turnsLeft > 0) threat.turnsLeft -= 1;

                    // Small chance (e.g., 15%) that another player dealt with it
                    // We don't self-resolve if the game is already over (turnsLeft <= 0)
                    const resolvedByOpponent = Math.random();
                    if (resolvedByOpponent < (threat.resolvedByOpponent || 0) && threat.turnsLeft > 0) {
                        console.log(`AI Opponent dealt with: ${threat.message}`);
                        return false; // This removes the threat from the array
                    }
                    return true; // Keep the threat
                });

                // 2. Roll for NEW events
                const currentCount = updateCreatureCount();
                const rolledEvent = simulateEvent(currentTurn, currentCount);

                // 3. If the new event is a THREAT, add it to the stack
                if (rolledEvent && rolledEvent.type === "THREAT") {
                    activeThreats.push({
                        id: Date.now(),
                        message: rolledEvent.message,
                        turnsLeft: rolledEvent.duration,
                        totalDuration: rolledEvent.duration,
                        icon: rolledEvent.icon,
                        name: rolledEvent.short,
                        isWipeThreat: rolledEvent.isWipeThreat // Carry the flag over
                    });
                }

                // --- MODIFICATION ENDS HERE ---

                // 4. Update UI
                updateWidget("EVENT", {turn: currentTurn, event: rolledEvent});
            }
        }
    };

    const observer = new MutationObserver(callback);
    observer.observe(targetNode, config);

    const disconnectObserver = new MutationObserver((mutations, obs) => {
        if (!document.body.contains(targetNode)) {
            isObservingTurns = false;
            obs.disconnect();
            observer.disconnect();
            updateWidget("LOGO");
        }
    });

    if (targetNode.parentNode) {
        disconnectObserver.observe(targetNode.parentNode, {childList: true});
    }
}

checkPlaytester();

document.addEventListener('click', function (event) {
    if (event.target && event.target.textContent === "Keep this") {
        currentTurn = 0;
        updateWidget("EVENT", {turn: 0, event: {message: "Pre-game actions", icon: "\u{2699}"}});
        setTimeout(() => observeTurnChanges(), 100);
    }
});

const navObserver = new MutationObserver(() => {
    const currentUrl = window.location.href;
    if (currentUrl !== lastUrl) {
        lastUrl = currentUrl;
        checkPlaytester();
    }
});
navObserver.observe(document.body, {childList: true, subtree: true});