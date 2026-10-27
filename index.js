const express = require('express');
const path = require('path');
const fs = require('fs');
const login = require('facebook-chat-api'); 

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Render के लिए डायनामिक पोर्ट बाइंडिंग
const PORT = process.env.PORT || 3000;

// ग्लोबल स्टेट फ़ीचर्स
let botState = {
    isOnline: false,
    antiOut: false,
    groupLock: {
        enabled: false,
        threadID: null,
        lockedName: "👑 𝗔𝗠𝗔𝗡 𝗜𝗡𝗫𝗜𝗗𝗘 👑",
        lockedNickname: " ─꯭─⃝𝗔𝗺𝗮𝗻─⃝𝘅𝘄𝗱🤍🪽",
        lockedDP: "",
        adminUID: "61595656444866" // 👈 यहाँ अपनी असली फेसबुक UID (बिना किसी सिंबल के) डालें
    },
    targetSystem: {
        enabled: false,
        targetUID: null,
        threadID: null,
        intervalId: null
    },
    fightMode: {
        enabled: false,
        threadID: null
    }
};

// गाली और टाउंट्स लिस्ट (Fight Mode के लिए)
const tauntsList = [
    "TERI MAA KI CHODU HATER!",
    "AMAN INXIDE SE TAKKAR MAT LENA BETA!",
    "HAR HATER KI MAA KA BHAROSA AMAN INXIDE BOT!",
    "TERI AUKAAT NAHI HAI IS GROUP MEIN BOLNE KI!",
    "NIKAAL APNI GAAND YAHAN SE MADARJAAT!"
];

// ---------------- DASHBOARD ROUTES ----------------

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// स्टेटस चेक API
app.get('/status', (req, res) => {
    res.json({
        status: botState.isOnline ? "ONLINE" : "OFFLINE",
        uptime: process.uptime(),
        antiOut: botState.antiOut ? "ON" : "OFF",
        activeFeatures: (botState.groupLock.enabled ? 1 : 0) + (botState.targetSystem.enabled ? 1 : 0) + (botState.fightMode.enabled ? 1 : 0)
    });
});

// 🟢 डैशबोर्ड का असली रूट (/control) जो एरर को ठीक करेगा
app.post('/control', (req, res) => {
    // फ्रंटएंड अलग-अलग प्रकार के डेटा भेज सकता है (जैसे कुकीज़ या बटन कमांड्स)
    const { cookies, adminId, command } = req.body;
    
    // अगर कुकीज़ सबमिट की गई हैं (बोट चालू करने के लिए)
    if (cookies) {
        try {
            const parsedCookies = typeof cookies === 'string' ? JSON.parse(cookies) : cookies;
            
            login({ appState: parsedCookies }, (err, api) => {
                if (err) {
                    console.error("Facebook Login Error:", err);
                    return res.status(500).send("Failed to connect to Facebook. Check cookies.");
                }

                botState.isOnline = true;
                console.log("👑 AMAN INXIDE BOT IS NOW ONLINE! 👑");
                startBotListeners(api);
            });

            return res.send("Bot setup initiated successfully!");
        } catch (e) {
            return res.status(400).send("Invalid JSON format in cookies!");
        }
    }

    // अगर कोई बटन (जैसे Anti-Out) दबाया गया है
    if (command) {
        if (command === 'antiout_on') {
            botState.antiOut = true;
            botState.groupLock.enabled = true;
            return res.send("Anti-Out and Group Lock Activated!");
        }
        if (command === 'antiout_off') {
            botState.antiOut = false;
            botState.groupLock.enabled = false;
            return res.send("Anti-Out Deactivated!");
        }
    }

    res.send("Request processed.");
});

// ---------------- BOT ACTIONS & LISTENERS ----------------

function startBotListeners(api) {
    api.listenMqtt((err, event) => {
        if (err) return console.error(err);

        const threadID = event.threadID;
        const senderID = event.senderID;

        // --- 🛡️ 1. AUTOMATIC SECURITY (Group Name, DP & Nickname Lock) ---
        if (botState.groupLock.enabled) {
            
            // A. Group Name Lock
            if (event.type === "event" && event.logMessageType === "log:thread-name") {
                api.setTitle(botState.groupLock.lockedName, threadID);
            }

            // B. Photo / DP Lock
            if (event.type === "event" && event.logMessageType === "log:thread-icon") {
                api.sendMessage("⚠️ [SECURITY] ग्रुप प्रोफाइल पिक्चर (DP) लॉक है!", threadID);
            }

            // C. Bot Nickname Auto Correction
            if (event.type === "event" && event.logMessageType === "log:user-nickname") {
                const changedID = event.logMessageData.participant_id;
                if (changedID === api.getCurrentUserID()) {
                    api.changeNickname(botState.groupLock.lockedNickname, threadID, api.getCurrentUserID());
                }
            }
        }

        // --- 🎯 2. CHAT COMMANDS LIST ---
        if (event.body) {
            const message = event.body.trim().toLowerCase();

            if (message === '/start') {
                api.sendMessage("👑 AMAN INXIDE BOT ACTIVE! ⚡ सब हेटर्स की वाट लगाने के लिए तैयार!", threadID);
            }

            if (message === '/help') {
                const helpMsg = "👑 AMAN INXIDE BOT COMMANDS 👑\n\n" +
                                "/start - बोट एक्टिव करें\n" +
                                "/fyt - फाइट मोड ऑन/ऑफ करें\n" +
                                "/gclock [नाम] - ग्रुप का नाम लॉक करें\n" +
                                "/gcunlock - ग्रुप का नाम अनलॉक करें\n" +
                                "/roast - रोस्टिंग मैसेजेस\n" +
                                "/masti - मस्ती रिस्पांस\n\n" +
                                "🛡️ ग्रुप प्रोटेक्शन के लिए डैशबोर्ड पर 'Anti-Out ON' बटन दबाएं!";
                api.sendMessage(helpMsg, threadID);
            }

            // 🔒 3. MANUAL GROUP LOCK COMMANDS (Admin Only)
            if (message.startsWith('/gclock ')) {
                if (senderID !== botState.groupLock.adminUID) {
                    return api.sendMessage("❌ सिर्फ बोट का असली मालिक ही यह कमांड चला सकता है!", threadID);
                }
                const nameToLock = event.body.slice(8).trim();
                if (!nameToLock) return api.sendMessage("❌ कृपया एक नाम लिखें।", threadID);

                botState.groupLock.lockedName = nameToLock;
                botState.groupLock.enabled = true;

                api.setTitle(nameToLock, threadID, (err) => {
                    if (err) return api.sendMessage("❌ नाम बदलने में विफल। सुनिश्चित करें कि बोट ग्रुप एडमिन है।", threadID);
                    api.sendMessage(`🔒 [SECURITY] ग्रुप का नाम अब "${nameToLock}" पर लॉक कर दिया गया है!`, threadID);
                });
            }

            if (message === '/gcunlock') {
                if (senderID !== botState.groupLock.adminUID) {
                    return api.sendMessage("❌ सिर्फ बोट का असली मालिक ही यह कमांड चला सकता है!", threadID);
                }
                botState.groupLock.enabled = false;
                api.sendMessage("🔓 [SECURITY] ग्रुप का नाम अब अनलॉक कर दिया गया है।", threadID);
            }

            // ⚔ 4. FIGHT MODE COMMAND (/fyt)
            if (message === '/fyt') {
                botState.fightMode.enabled = !botState.fightMode.enabled;
                
                if (botState.fightMode.enabled) {
                    api.sendMessage("🔥 [FIGHT MODE ON] गाली तोफान शुरू!", threadID);
                    
                    botState.fightMode.intervalId = setInterval(() => {
                        const randomTaunt = tauntsList[Math.floor(Math.random() * tauntsList.length)];
                        api.sendMessage(randomTaunt, threadID);
                    }, 3000);
                } else {
                    clearInterval(botState.fightMode.intervalId);
                    api.sendMessage("🛑 [FIGHT MODE OFF] शांति स्थापित।", threadID);
                }
            }

            if (message === '/roast') {
                api.sendMessage("🔥 बेटा तुमसे ना हो पाएगा, जाओ जाके पोगो देखो!", threadID);
            }

            if (message === '/masti') {
                api.sendMessage("🤪 माहौल पूरा सेट है भाई लोग!", threadID);
            }
        }
    });
}

// सर्वर को चालू करना
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server Dashboard connected at port: ${PORT}`);
});
