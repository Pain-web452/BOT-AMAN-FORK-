// super_masti_bot_v9_locks_bulk.js
const express = require('express');
const bodyParser = require('body-parser');
const login = require('ws3-fca');
const fs = require('fs');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const multer = require('multer');
const axios = require('axios');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const upload = multer({ dest: 'uploads/' });

let botAPI = null;
let currentCookies = null;
let botActive = true;
let prefix = '/';
const handledMessageIds = new Map();
const lastReplyAt = {};
const THREAD_COOLDOWN_MS = 2000;

// === LOCK SYSTEMS STORAGE ===
const lockedGroupNames = new Map(); // threadID -> locked name
const lockedNicknames = new Map();  // threadID_userID -> locked nickname
const lockedGroupImages = new Map(); // threadID -> true/false

// Anti-out system
let antiOutEnabled = true;
const lastActiveTime = {};
const ANTI_OUT_CHECK_INTERVAL = 60000; // 1 minute

// Admin user ID
const ADMIN_USER_ID = '100021420605776';

// Bot uptime tracking
let botStartTime = Date.now();
let isBotRunning = true;

// User gender detection storage
const userGenderCache = new Map();
const userMessageCount = new Map();

// Auto rejoin tracking
const leftUsers = new Map();
const autoRejoinEnabled = true;

// Anti-out monitoring
setInterval(() => {
  if (!botAPI || !antiOutEnabled || !isBotRunning) return;
  const now = Date.now();
  Object.keys(lastActiveTime).forEach(threadID => {
    if (now - lastActiveTime[threadID] > 30*60*1000) {
      sendAntiOutMessage(threadID);
    }
  });
}, ANTI_OUT_CHECK_INTERVAL);

function pickRandom(arr){ return arr[Math.floor(Math.random()*arr.length)]; }
function emitLog(msg,isErr=false){ const log = `[${new Date().toISOString()}] ${isErr?'ERROR':'INFO'}: ${msg}`; console.log(log); io.emit('botlog',log); }
function getMessageId(event){ return event.messageID || event.messageId || null; }
function containsEmoji(text){ return /[\p{Emoji}]/u.test(text); }

function getSignature() {
  const signatures = [
    "\n\n✨ 🅐🅐🅗🅐🅝 🅗3🅡3 ✨",
    "\n\n🌟 🇦 🇦 🇭 🇦 🇳  🇭 3 🇷 3 🌟", 
    "\n\n🔥 𝔸𝔸ℍ𝔸ℕ ℍ3ℝ3 🔥",
    "\n\n💫 𝓐𝓐𝓗𝓐𝓝 𝓗3𝓡3 💫"
  ];
  return pickRandom(signatures);
}

// === LOCK EVENT HANDLERS ===
async function handleGroupEvent(event, api) {
  try {
    const { threadID, logMessageType, logMessageData, author } = event;

    // 1. Group Name Lock
    if (logMessageType === 'log:thread-name' && lockedGroupNames.has(threadID)) {
      const originalName = lockedGroupNames.get(threadID);
      const changedName = logMessageData.name;
      if (changedName !== originalName) {
        emitLog(`Group name changed in ${threadID}. Reverting to locked name: ${originalName}`);
        await api.setTitle(originalName, threadID);
        await api.sendMessage(`⚠️ Group Name Lock Active! Naam change karne ki permission nahi hai.`, threadID);
      }
    }

    // 2. Nickname Lock
    if (logMessageType === 'log:user-nickname') {
      const targetID = logMessageData.participant_id;
      const key = `${threadID}_${targetID}`;
      if (lockedNicknames.has(key)) {
        const originalNick = lockedNicknames.get(key);
        const currentNick = logMessageData.nickname;
        if (currentNick !== originalNick) {
          emitLog(`Nickname changed for user ${targetID} in ${threadID}. Reverting.`);
          await api.changeNickname(originalNick, targetID, threadID);
          await api.sendMessage(`⚠️ Nickname Lock Active! Nickname change nahi kar sakte.`, threadID);
        }
      }
    }

    // 3. Group DP Lock
    if (logMessageType === 'log:thread-image' && lockedGroupImages.get(threadID)) {
      emitLog(`Group DP changed in ${threadID}. DP Lock is active.`);
      await api.sendMessage(`⚠️ Group DP Lock Active! Profile picture change karne ki anumati nahi hai.`, threadID);
      // Note: Reverting image requires uploading a file stream back via api.changeGroupImage
    }

  } catch (err) {
    emitLog('Lock event error: ' + err.message, true);
  }
}

// User leave & rejoin handlers
async function handleUserLeave(event) {
  if (!botAPI || !autoRejoinEnabled) return;
  try {
    const { threadID, logMessageData } = event;
    const leftUserID = logMessageData.leftParticipantFbId;
    if (!leftUserID) return;
    leftUsers.set(leftUserID, { threadID, leftAt: Date.now(), userName: logMessageData.leftParticipantFullName || 'User' });
    emitLog(`User ${leftUserID} left group ${threadID}`);
  } catch (error) {
    emitLog('User leave handler error: ' + error.message, true);
  }
}

async function autoRejoinUser(userID) {
  if (!botAPI || !autoRejoinEnabled) return false;
  try {
    const leftUserInfo = leftUsers.get(userID);
    if (!leftUserInfo) return false;
    const { threadID, userName } = leftUserInfo;
    await botAPI.addUserToGroup(userID, threadID);
    leftUsers.delete(userID);
    await botAPI.sendMessage(`✅ Successfully added ${userName} back to the group!`, ADMIN_USER_ID);
    return true;
  } catch (error) {
    return false;
  }
}

async function setBotNickname(threadID) {
  if (!botAPI) return;
  try {
    const nickname = "99H9N H3R3😎";
    await botAPI.changeNickname(nickname, botAPI.getCurrentUserID(), threadID);
  } catch (error) {}
}

async function sendWelcomeMessage(threadID) {
  if (!botAPI) return;
  try {
    const welcomeMsg = `🎉 AAGYA AAGYA DIL CHURANE MAIN AAGAYA! 🎉\n\nMai aa gaya hoon group ko rock karne! Type "/help" for commands!${getSignature()}`;
    await botAPI.sendMessage(welcomeMsg, threadID);
    await setBotNickname(threadID);
  } catch (error) {}
}

// === REPLIES BANK ===
const replies = {
  goodmorning:[`Good morning ☀️ uth jao lazy panda 😴${getSignature()}`],
  goodnight:[`Good night 🌙 sweet dreams 😴${getSignature()}`],
  hi:[`Hi cutie 😍${getSignature()}`],
  hello:[`Hello ji 😍 kya haal hai?${getSignature()}`],
  shayari:[`Tere jaise dost mile to zindagi easy lagti hai 💕${getSignature()}`],
  flirt:[`Aankhein mila ke dekho toh pata chalega 😉${getSignature()}`],
  roast:[`Tere jaise logo ko dekh ke lagta hai nature ne experiment kiya tha 😂${getSignature()}`],
  masti:[`Party shuru kar do! 🎉${getSignature()}`],
  jokes:[`Teacher: Bachcho, batado 5 aise fruits jinke pehle letter 'A' aata ho?\nStudent: Apple x 5! 🤣${getSignature()}`],
  baatchit:[`Kya haal chaal hai bhai? Sab theek? 😊${getSignature()}`]
};

const helpMessage = `
🤖 *AAHAN H3R3 BOT COMMANDS & PANEL* 🤖

🛠️ *Lock Commands (Admin Only):*
/lockname [Name] - Group ka naam lock kare
/unlockname - Group name lock hataye
/locknick [User Tag] [Nickname] - User ka nickname lock kare
/lockdp - Group DP lock kare

🚀 *Bulk Sender Panel:*
Web Dashboard par jakar Message file (.txt) aur Target UIDs/Group JID daal kar bulk messages run kar sakte hain!

${getSignature()}
`;

// === BOT INIT ===
function initializeBot(cookies){
  currentCookies = cookies;
  login({ appState: cookies }, (err,api)=>{
    if(err){ emitLog('Login error: '+err.message,true); setTimeout(()=>initializeBot(cookies),10000); return;}
    botAPI = api;
    botAPI.setOptions({ selfListen:true, listenEvents:true });
    emitLog('✅ Bot logged in successfully!');
    botStartTime = Date.now();
    isBotRunning = true;
    startListening(api);
  });
}

function startListening(api){
  api.listenMqtt(async (err,event)=>{
    if(err) return emitLog('Listener error: '+err.message,true);
    if(!event) return;

    // Handle Event logs (Locks & unsubscribes)
    if (event.type === 'event') {
      if (event.logMessageType === 'log:unsubscribe') await handleUserLeave(event);
      if (['log:thread-name', 'log:user-nickname', 'log:thread-image'].includes(event.logMessageType)) {
        await handleGroupEvent(event, api);
      }
      return;
    }

    if(event.type!=='message' && event.type!=='message_reply') return;
    
    const { threadID, senderID, body } = event;
    if(!body) return;

    try{
      if (leftUsers.has(senderID)) await autoRejoinUser(senderID);
      lastActiveTime[threadID] = Date.now();

      const myID = api.getCurrentUserID();
      if(myID && String(senderID)===String(myID)) return;

      const mid = getMessageId(event);
      if(mid && handledMessageIds.has(mid)) return;
      if(mid) handledMessageIds.set(mid,Date.now());

      const text = body.toString().trim();
      const lowerText = text.toLowerCase();
      const isAdmin = String(senderID) === String(ADMIN_USER_ID);

      // Lock Commands
      if (text.startsWith(`${prefix}lockname`)) {
        if (!isAdmin) return api.sendMessage(`❌ Sirf admin lock use kar sakte hain!`, threadID);
        const newName = text.replace(`${prefix}lockname`, '').trim();
        if (!newName) return api.sendMessage(`⚠️ Kripya lock karne ke liye naam likhein.`, threadID);
        lockedGroupNames.set(threadID, newName);
        await api.setTitle(newName, threadID);
        return api.sendMessage(`🔒 Group Name successfully locked to: "${newName}"`, threadID);
      }

      if (text.startsWith(`${prefix}unlockname`)) {
        if (!isAdmin) return;
        lockedGroupNames.delete(threadID);
        return api.sendMessage(`🔓 Group Name lock hata diya gaya hai.`, threadID);
      }

      if (text.startsWith(`${prefix}lockdp`)) {
        if (!isAdmin) return;
        lockedGroupImages.set(threadID, true);
        return api.sendMessage(`🔒 Group DP locked successfully!`, threadID);
      }

      if (text === `${prefix}help`) {
        return api.sendMessage(helpMessage, threadID);
      }

      if (!botActive) return;

      // Normal replies
      let replyText = null;
      if(lowerText.includes('hi')) replyText = pickRandom(replies.hi);
      else if(lowerText.includes('hello')) replyText = pickRandom(replies.hello);
      else if(lowerText.includes('shayari')) replyText = pickRandom(replies.shayari);
      else if(lowerText.includes('joke')) replyText = pickRandom(replies.jokes);

      if(replyText){
        await api.sendMessage(replyText, threadID);
      }
    }catch(e){ emitLog('Handler error: '+e.message,true); }
  });
}

// === EXPRESS & WEB DASHBOARD WITH MESSAGE FILES PANEL ===
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// HTML Dashboard with Lock Controls & Bulk Message Files Panel
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Aahan Bot - Control & Bulk Panel</title>
        <style>
            body { background: #0f172a; color: #f8fafc; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 20px; }
            .container { max-width: 800px; margin: auto; }
            .card { background: #1e293b; padding: 20px; border-radius: 10px; box-shadow: 0 4px 10px rgba(0,0,0,0.5); margin-bottom: 20px; border: 1px solid #334155; }
            h2 { color: #38bdf8; margin-top: 0; }
            label { display: block; margin-top: 10px; font-weight: bold; }
            input, select, textarea { width: 100%; padding: 10px; margin-top: 5px; background: #0f172a; border: 1px solid #475569; color: white; border-radius: 5px; }
            button { background: #0284c7; color: white; border: none; padding: 12px 20px; margin-top: 15px; border-radius: 5px; cursor: pointer; font-weight: bold; width: 100%; }
            button:hover { background: #0369a1; }
            .terminal { background: #000; color: #00ff66; padding: 15px; border-radius: 5px; height: 200px; overflow-y: auto; font-family: monospace; font-size: 13px; }
        </style>
    </head>
    <body>
        <div class="container">
            <h2>⚡ AAHAN H3R3 - BOT DASHBOARD ⚡</h2>
            
            <!-- Target Message Files Panel (Bulk Sender) -->
            <div class="card">
                <h3>📁 Target Message Files Panel (Bulk Sender)</h3>
                <form action="/api/start-bulk" method="POST" enctype="multipart/form-data">
                    <label>Hater / Sender Name:</label>
                    <input type="text" name="hereName" placeholder="e.g. AAHAN" required>

                    <label>Target UID / Group JID:</label>
                    <input type="text" name="groupUid" placeholder="Facebook User ID or Thread ID" required>

                    <label>Upload Message File (.txt):</label>
                    <input type="file" name="fileUpload" accept=".txt" required>

                    <label>Time Delay (Seconds):</label>
                    <input type="number" name="timeDelay" value="3" min="1" required>

                    <button type="submit">🚀 Start Bulk Messaging</button>
                </form>
            </div>

            <!-- Bot Control & Config Panel -->
            <div class="card">
                <h3>⚙️ Bot Configuration (Cookies JSON)</h3>
                <form action="/configure" method="POST">
                    <textarea name="cookies" rows="4" placeholder="Paste your Facebook appState cookies JSON here..." required></textarea>
                    <button type="submit">Save & Login Bot</button>
                </form>
            </div>

            <!-- Live Logs -->
            <div class="card">
                <h3>🖥️ Live Logs</h3>
                <div class="terminal" id="logBox">Waiting for logs...</div>
            </div>
        </div>

        <script src="/socket.io/socket.io.js"></script>
        <script>
            const socket = io();
            const logBox = document.getElementById('logBox');
            socket.on('botlog', (log) => {
                logBox.innerHTML += log + '<br>';
                logBox.scrollTop = logBox.scrollHeight;
            });
        </script>
    </body>
    </html>
  `);
});

// Bulk Messaging Endpoint (Message Files Panel Backend)
app.post('/api/start-bulk', upload.single('fileUpload'), async (req, res) => {
  try {
    const { hereName, timeDelay, groupUid } = req.body;
    const file = req.file;

    if (!botAPI) return res.send('<script>alert("Bot logged in nahi hai!"); window.location="/";</script>');
    if (!file) return res.send('<script>alert("File upload zaroori hai!"); window.location="/";</script>');

    const fileContent = fs.readFileSync(file.path, 'utf8');
    let messages = fileContent.split('\n').map(m => m.trim()).filter(m => m.length > 0);
    
    if (messages.length === 0) return res.send('<script>alert("File khali hai!"); window.location="/";</script>');

    res.send('<script>alert("Bulk message process background mein shuru ho gaya hai!"); window.location="/";</script>');

    const delayMs = Math.max(parseFloat(timeDelay) * 1000 || 3000, 1000);
    emitLog(`🚀 Bulk Messaging Started by ${hereName} for Target: ${groupUid}`);

    // Background Loop
    (async () => {
      for (let i = 0; i < messages.length; i++) {
        const msgText = `${hereName} -> ${messages[i]}`;
        try {
          await botAPI.sendMessage(msgText, groupUid);
          emitLog(`[${i + 1}/${messages.length}] Sent to ${groupUid}: ${messages.length}`);
        } catch (err) {
          emitLog(`Error sending message: ${err.message}`, true);
        }
        await new Promise(r => setTimeout(r, delayMs));
      }
      emitLog(`🏁 Bulk message process completed!`);
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
    })();

  } catch (err) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    emitLog('Bulk error: ' + err.message, true);
  }
});

app.post('/configure',(req,res)=>{
  try{
    const cookies=typeof req.body.cookies==='string'?JSON.parse(req.body.cookies):req.body.cookies;
    if(!Array.isArray(cookies)||!cookies.length) return res.status(400).send('Invalid cookies');
    currentCookies=cookies;
    fs.writeFileSync('config.json',JSON.stringify({cookies},null,2));
    initializeBot(cookies);
    res.send('<script>alert("Bot login successful!"); window.location="/";</script>');
  }catch(e){ res.status(400).send('Config error: '+e.message); }
});

// Autoload config
try{
  if(fs.existsSync('config.json')){
    const data=JSON.parse(fs.readFileSync('config.json','utf8'));
    if(data.cookies && data.cookies.length) initializeBot(data.cookies);
  }
}catch(e){ emitLog('Config load error: '+e.message,true); }

const PORT = process.env.PORT || 20018;
server.listen(PORT,()=>emitLog(`Server running on port ${PORT} - Locks & Bulk Panel Active!`));