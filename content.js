// content.js
console.log("Goldfish Helper extension loaded");

let lastUrl = window.location.href;
let currentTurn = 0;
let isInitialized = false;
let isObservingTurns = false;
let creatureCount = 0;
let creatureObserver = null;
let activeThreats = []; // Array of { id, message, turnsLeft, icon }
let pastEvents = [];

const EVENT_TABLE = {
    removal_needed: {
        type: "THREAT",
        message: "Opponent played a threat!",
        probs: [0, 0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.30], // High frequency
        threatWeight: 0.0,
        duration: 3,
        resolvedByOpponent: 0.25,
        icon: "\u{26A0}\u{FE0F}" // Warning ⚠️
    },
    wipe_needed: {
        type: "THREAT",
        isWipeThreat: true, // Custom flag
        message: "Wipe needed (Opponent overextended)!",
        probs: [0, 0, 0, 0.05, 0.05, 0.10, 0.10, 0.30], // High frequency
        threatWeight: -0.01,
        duration: 3,
        icon: "\u{26A0}\u{FE0F}" // Warning ⚠️
    },
    your_threat_removed: {
        type: "INSTANT",
        message: "Your best permanent was removed!",
        probs: [0, 0, 0.10, 0.15, 0.20, 0.20, 0.20, 0.20],
        threatWeight: 0.01,
        icon: "\u{274C}" // Cross ❌
    },
    board_wipe: {
        type: "INSTANT",
        message: "Board wipe! Clear all creatures.",
        probs: [0, 0, 0, 0, 0.05, 0.10, 0.15, 0.15],
        threatWeight: 0.04, // Scales heavily with your board
        icon: "\u{1F4A5}" // Explosion 💥
    },
    graveyard_exiled: {
        type: "INSTANT",
        message: "Bojuka Bog! Exile your graveyard.",
        probs: [0, 0, 0.05, 0.05, 0.10, 0.10, 0.10, 0.10],
        threatWeight: 0, // Usually happens regardless of creature count
        icon: "\u{1F526}" // Flashlight 🔦
    }
};

function simulateEvent(turn, currentCreatures) {
    const random = Math.random();
    let cumulative = 0;

    console.log(`Turn: ${turn} | Draw: ${random.toFixed(3)}`);
    // Check if there is a 'wipe_needed' threat currently active
    const wipeIsNeeded = activeThreats.some(t => t.message.includes("wipe_needed") || t.id === "wipe_needed_id");

    for (const [key, data] of Object.entries(EVENT_TABLE)) {
        const baseProb = data.probs[turn - 1] !== undefined
            ? data.probs[turn - 1]
            : data.probs[data.probs.length - 1];

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

        // Restoration of detailed logging
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

function updateWidget(type, data = {}) {
    let widget = document.getElementById("goldfish-widget");
    if (!widget) {
        widget = document.createElement("div");
        widget.id = "goldfish-widget";
        widget.className = "widget";
        document.body.appendChild(widget);
    }

    widget.innerHTML = '';

    if (type === "LOGO") {
        const logoDiv = document.createElement("div");
        logoDiv.className = "logo";
        const img = document.createElement("img");
        img.src = browser.runtime.getURL("logo_clean.png");
        img.alt = "Goldfish Helper";
        logoDiv.appendChild(img);
        widget.appendChild(logoDiv);
    } else if (type === "EVENT") {
        // Row 1: Turn Number
        const turnElement = document.createElement("div");
        turnElement.className = "turn-number";
        turnElement.textContent = `Turn: ${data.turn}`;
        widget.appendChild(turnElement);

        // Row 2: Event Message
        const messageElement = document.createElement("div");
        messageElement.className = "widget-content";
        if (data.event) {
            messageElement.innerHTML = `<span>${data.event.icon || ""}</span> <span>${data.event.message}</span>`;
        } else {
            messageElement.textContent = "No new event";
        }
        widget.appendChild(messageElement);

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
                    : `${threat.icon} ${threat.turnsLeft} turns: Resolve`;

                if (isGameOver) threatButton.style.backgroundColor = "black";

                threatButton.onclick = () => {
                    // Remove ONLY this threat from the array
                    activeThreats = activeThreats.filter(t => t.id !== threat.id);
                    updateWidget("EVENT", {turn: currentTurn, event: null});
                };

                threatContainer.appendChild(threatButton);
            });
            widget.appendChild(threatContainer);
        }
    }
}

function removeWidget() {
    const widget = document.getElementById("goldfish-widget");
    if (widget) widget.remove();
}

function initializeWidget() {
    if (!document.getElementById('goldfish-style')) {
        const link = document.createElement('link');
        link.id = 'goldfish-style';
        link.rel = 'stylesheet';
        link.href = browser.runtime.getURL('styles.css');
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
                    if (resolvedByOpponent < threat.resolvedByOpponent || 0 && threat.turnsLeft > 0) {
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