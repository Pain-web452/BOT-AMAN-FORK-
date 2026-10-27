const express = require('express');
const path = require('path');
const fs = require('fs');
// नोट: यह बोट आमतौर पर 'fb-chat-api' या 'fca-project-orion' जैसी लाइब्रेरी का उपयोग करता है
// हम यहाँ एक मानक फेसबुक चैट एपीआई संरचना का उपयोग कर रहे हैं।
const login = require('facebook-chat-api'); 

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Render के लिए डायनामिक पोर्ट बाइंडिंग
const PORT = process.env.PORT || 3000;

// ग्लोबल स्टेट फ़ीचर्स (README के अनुसार)
let botState = {
    isOnline: false,
    antiOut: false,
    groupLock: {
        enabled: false,
        threadID: null,
        lockedName: "👑 𝗔𝗠𝗔𝗡 𝗜𝗡𝗫𝗜𝗗𝗘 👑",
        lockedNickname: " ─꯭─⃝𝗔𝗺𝗮𝗻─⃝𝘅𝘄𝗱🤍🪽",
        lockedDP: ""
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

// बोट स्टार्ट और कॉन्फ़िगरेशन सबमिशन API
app.post('/start-bot', (req, res) => {
    const { cookies, adminId } = req.body;
    
    if (!cookies) {
        return res.status(400).json({ error: "Cookies are required!" });
    }

    try {
        const parsedCookies = typeof cookies === 'string' ? JSON.parse(cookies) : cookies;
        
        // फेसबुक लॉगिन इनिशियलाइज़ेशन
        login({ appState: parsedCookies }, (err, api) => {
            if (err) {
                console.error("Facebook Login Error:", err);
                return res.status(500).json({ error: "Failed to connect to Facebook. Check cookies." });
            }

            botState.isOnline = true;
            console.log("👑 AMAN INXIDE BOT IS NOW ONLINE! 👑");
            
            // फेसबुक चैट इवेंट्स सुनना शुरू करें
            startBotListeners(api, adminId);
        });

        res.json({ success: "Bot startup initiated successfully!" });

    } catch (e) {
        res.status(400).json({ error: "Invalid JSON format in cookies!" });
    }
});

// डैशबोर्ड से एंटी-आउट और फ़ीचर्स कंट्रोल करना
app.post('/toggle-feature', (req, res) => {
    const { feature, action } = req.body;
    if (feature === 'antiOut') {
        botState.antiOut = action === 'ON';
        botState.groupLock.enabled = action === 'ON'; // सुरक्षा चालू करें
    }
    res.json({ success: `${feature} toggled ${action}` });
});

// ---------------- BOT ACTIONS & LISTENERS ----------------

function startBotListeners(api, adminId) {
    api.listenMqtt((err, event) => {
        if (err) return console.error(err);

        const threadID = event.threadID;

        // --- 🛡️ 1. AUTOMATIC SECURITY (README: Group Name, DP & Nickname Lock) ---
        if (botState.groupLock.enabled) {
            
            // A. Group Name Lock
            if (event.type === "event" && event.logMessageType === "log:thread-name") {
                console.log("[🔒 SECURITY] किसी ने ग्रुप का नाम बदलने की कोशिश की!");
                api.setTitle(botState.groupLock.lockedName, threadID, (err) => {
                    if (!err) api.sendMessage("⚠️ [SECURITY] इस ग्रुप का नाम लॉक है! आप इसे नहीं बदल सकते।", threadID);
                });
            }

            // B. Photo / DP Lock
            if (event.type === "event" && event.logMessageType === "log:thread-icon") {
                console.log("[🔒 SECURITY] किसी ने ग्रुप की DP बदलने की कोशिश की!");
                // अगर आपके पास डिफ़ॉल्ट इमेज पाथ है तो उसे वापस सेट करें
                api.sendMessage("⚠️ [SECURITY] ग्रुप प्रोफाइल पिक्चर (DP) लॉक है! इसे बदलना मना है।", threadID);
            }

            // C. Bot Nickname Auto Correction
            if (event.type === "event" && event.logMessageType === "log:user-nickname") {
                const changedID = event.logMessageData.participant_id;
                if (changedID === api.getCurrentUserID()) {
                    console.log("[🔒 SECURITY] बोट का निकनेम बदला गया! वापस ठीक कर रहा हूँ...");
                    api.changeNickname(botState.groupLock.lockedNickname, threadID, api.getCurrentUserID());
                }
            }
        }

        // --- 🎯 2. CHAT COMMANDS LIST ---
        if (event.body) {
            const message = event.body.trim().toLowerCase();

            // /start Command
            if (message === '/start') {
                api.sendMessage("👑 AMAN INXIDE BOT ACTIVE! ⚡ सब हेटर्स की वाट लगाने के लिए तैयार!", threadID);
            }

            // /stop Command
            if (message === '/stop') {
                api.sendMessage("🛑 बोट को डीएक्टिवेट किया जा रहा है...", threadID);
                // बोट को रोकने का लॉजिक
            }

            // /help Command
            if (message === '/help') {
                const helpMsg = "👑 AMAN INXIDE BOT COMMANDS 👑\n\n" +
                                "/start - बोट एक्टिव करें\n" +
                                "/stop - बोट बंद करें\n" +
                                "/fyt - फाइट मोड ऑन करें\n" +
                                "/roast - रोस्टिंग मैसेजेस\n" +
                                "/masti - मस्ती रिस्पांस\n\n" +
                                "🛡️ ग्रुप नाम, फोटो और निकनेम लॉक डैशबोर्ड से 'Anti-Out ON' करने पर बैकग्राउंड में अपने आप काम करते हैं!";
                api.sendMessage(helpMsg, threadID);
            }

            // ⚔ 3. FIGHT MODE COMMAND (/fyt)
            if (message.startsWith('/fyt')) {
                botState.fightMode.enabled = !botState.fightMode.enabled;
                
                if (botState.fightMode.enabled) {
                    api.sendMessage("🔥 [FIGHT MODE ON] गाली तोफान शुरू! मेंबर्स बच के रहें!", threadID);
                    
                    // हर 3 सेकंड में ग्रुप में नॉन-स्टॉप ताउंट्स भेजना
                    botState.fightMode.intervalId = setInterval(() => {
                        const randomTaunt = tauntsList[Math.floor(Math.random() * tauntsList.length)];
                        api.sendMessage(randomTaunt, threadID);
                    }, 3000);
                } else {
                    clearInterval(botState.fightMode.intervalId);
                    api.sendMessage("🛑 [FIGHT MODE OFF] शांति का माहौल वापस स्थापित।", threadID);
                }
            }

            // /roast Command
            if (message === '/roast') {
                api.sendMessage("🔥 बेटा तुमसे ना हो पाएगा, जाओ जाके पोगो देखो! AMAN INXIDE से पंगा भारी पड़ेगा!", threadID);
            }

            // /masti Command
            if (message === '/masti') {
                api.sendMessage("🤪 माहौल पूरा सेट है भाई लोग, मस्ती रुकनी नहीं चाहिए!", threadID);
            }
        }
    });
}

// सर्वर को चालू करना
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server Dashboard connected at port: ${PORT}`);
});
