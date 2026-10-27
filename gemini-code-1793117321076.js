// aahan_bot_complete.js
const express = require('express');
const bodyParser = require('body-parser');
const login = require('ws3-fca');
const fs = require('fs');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const multer = require('multer');

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

// Anti-out system
let antiOutEnabled = true;
const lastActiveTime = {};
const ANTI_OUT_CHECK_INTERVAL = 60000; // 1 minute

// === LOCK SYSTEMS STORAGE ===
const gcLocks = new Map();     // threadID -> locked group title
const nickLocks = new Map();   // threadID -> Map(userID -> locked nickname)
const dpLocks = new Map();     // threadID -> boolean (DP lock state)

// Fyt tasks tracking map
const activeFytTasks = new Map();

// Admin user ID
const ADMIN_USER_ID = '100021420605776';

// Bot uptime tracking
let botStartTime = Date.now();
let isBotRunning = true;

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

// Auto rejoin when user leaves group
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
🤖 *AAHAN H3R3 BOT COMMANDS* 🤖

🛠️ *Basic Commands:*
/start - Bot activate kare
/stop - Bot deactivate kare  
/help - Ye help message dikhaye

🛡️ *Lock Systems (Group mein use karein):*
/gclock - Group name lock on
/gcunlock - Group name lock off
/nlock - Nickname lock on
/nunlock - Nickname lock off
/dplock - Group DP lock on
/dpunlock - Group DP lock off

😊 *Fun Commands:*
/flirt, /roast, /masti, /joke, /mazedaar, /shayari, /baat

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

async function sendAntiOutMessage(threadID) {
  if (!botAPI || !isBotRunning) return;
  try {
    await botAPI.sendMessage(`Kya hua? Sab so gaye kya? 😴 Yaad kar lo!${getSignature()}`, threadID);
    lastActiveTime[threadID] = Date.now();
  } catch (error) {}
}

function startListening(api){
  api.listenMqtt(async (err,event)=>{
    if(err) return emitLog('Listener error: '+err.message,true);
    if(!event) return;

    // Event log handlers (Locks & unsubscribes)
    if (event.type === 'event') {
      const { threadID, logMessageType, logMessageData } = event;
      if (logMessageType === 'log:unsubscribe') await handleUserLeave(event);
      if (logMessageType === 'log:subscribe' && logMessageData.addedParticipants) {
        const botID = api.getCurrentUserID();
        if (addedParticipants.some(p => p.userFbId === botID)) await sendWelcomeMessage(threadID);
      }

      // 1. Group Name Lock Check
      if (logMessageType === 'log:thread-name' && gcLocks.has(threadID)) {
        const lockedName = gcLocks.get(threadID);
        if (logMessageData.name !== lockedName) {
          try {
            await api.setTitle(lockedName, threadID);
            await api.sendMessage(`🔒 **Group Name Lock Active!** Reverted to: "${lockedName}"${getSignature()}`, threadID);
          } catch (err) {}
        }
        return;
      }

      // 2. Nickname Lock Check
      if (logMessageType === 'log:user-nickname' && nickLocks.has(threadID)) {
        const threadNickMap = nickLocks.get(threadID);
        const targetID = logMessageData.participant_id;
        if (threadNickMap && threadNickMap.has(targetID)) {
          const lockedNick = threadNickMap.get(targetID);
          if (logMessageData.nickname !== lockedNick) {
            try {
              await api.changeNickname(lockedNick || '', threadID, targetID);
              await api.sendMessage(`🔒 **Nickname Lock Active!** Reverted.${getSignature()}`, threadID);
            } catch (err) {}
          }
        }
        return;
      }

      // 3. Group DP Lock Check
      if (logMessageType === 'log:thread-icon' && dpLocks.has(threadID)) {
        try {
          await api.sendMessage(`🔒 **Group DP Lock Active!** Picture change restricted.${getSignature()}`, threadID);
        } catch (err) {}
        return;
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

      if (text === `${prefix}help`) return api.sendMessage(helpMessage, threadID);

      // Bot Controls
      if(text===`${prefix}stop` && isAdmin){ botActive=false; return api.sendMessage(`🤖 Bot stopped! ${getSignature()}`, threadID); }
      if(text===`${prefix}start` && isAdmin){ botActive=true; return api.sendMessage(`🤖 Bot started! ${getSignature()}`, threadID); }
      if(text===`${prefix}antion` && isAdmin){ antiOutEnabled=true; return api.sendMessage(`🛡️ Anti-out ON! ${getSignature()}`, threadID); }
      if(text===`${prefix}antioff` && isAdmin){ antiOutEnabled=false; return api.sendMessage(`🛡️ Anti-out OFF! ${getSignature()}`, threadID); }

      // Lock Commands
      if(text===`${prefix}gclock`) {
        api.getThreadInfo(threadID, async (err, info) => {
          if (err) return;
          const threadName = info.threadName || info.name || 'Group';
          gcLocks.set(threadID, threadName);
          await api.sendMessage(`🔒 **GC Lock Activated!** Locked to: "${threadName}"${getSignature()}`, threadID);
        });
        return;
      }
      if(text===`${prefix}gcunlock`) {
        gcLocks.delete(threadID);
        return api.sendMessage(`🔓 **GC Lock Deactivated!**${getSignature()}`, threadID);
      }
      if(text===`${prefix}nlock`) {
        api.getThreadInfo(threadID, async (err, info) => {
          if (err) return;
          const nickMap = new Map();
          if (info.nicknames) {
            for (const [uid, nick] of Object.entries(info.nicknames)) nickMap.set(uid, nick);
          }
          nickLocks.set(threadID, nickMap);
          await api.sendMessage(`🔒 **Nickname Lock Activated!**${getSignature()}`, threadID);
        });
        return;
      }
      if(text===`${prefix}nunlock`) {
        nickLocks.delete(threadID);
        return api.sendMessage(`🔓 **Nickname Lock Deactivated!**${getSignature()}`, threadID);
      }
      if(text===`${prefix}dplock`) {
        dpLocks.set(threadID, true);
        return api.sendMessage(`🔒 **Group DP Lock Activated!**${getSignature()}`, threadID);
      }
      if(text===`${prefix}dpunlock`) {
        dpLocks.delete(threadID);
        return api.sendMessage(`🔓 **Group DP Lock Deactivated!**${getSignature()}`, threadID);
      }

      if(!botActive) return;

      let replyText = null;
      if(lowerText.includes('hi')) replyText = pickRandom(replies.hi);
      else if(lowerText.includes('hello')) replyText = pickRandom(replies.hello);
      else if(lowerText.includes('shayari')) replyText = pickRandom(replies.shayari);
      else if(lowerText.includes('joke')) replyText = pickRandom(replies.jokes);

      if(replyText){
        let name='User';
        try{ const info=await api.getUserInfo(senderID); name=info[senderID]?.name||name; }catch{}
        await api.sendMessage({ body:`@${name} ${replyText}`, mentions:[{ tag:name, id:senderID }] }, threadID);
      }
    }catch(e){ emitLog('Handler error: '+e.message,true); }
  });
}

// === EXPRESS & WEB DASHBOARD WITH BULK & FYT PANELS ===
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Aahan Bot - Control & Panels</title>
        <style>
            body { background: #0f172a; color: #f8fafc; font-family: sans-serif; padding: 20px; }
            .container { max-width: 800px; margin: auto; }
            .card { background: #1e293b; padding: 20px; border-radius: 10px; margin-bottom: 20px; border: 1px solid #334155; }
            h2 { color: #38bdf8; }
            label { display: block; margin-top: 10px; font-weight: bold; }
            input, textarea { width: 100%; padding: 10px; margin-top: 5px; background: #0f172a; border: 1px solid #475569; color: white; border-radius: 5px; box-sizing: border-box; }
            button { background: #0284c7; color: white; border: none; padding: 12px 20px; margin-top: 15px; border-radius: 5px; cursor: pointer; font-weight: bold; width: 100%; }
            button:hover { background: #0369a1; }
            .terminal { background: #000; color: #00ff66; padding: 15px; border-radius: 5px; height: 180px; overflow-y: auto; font-family: monospace; font-size: 13px; }
        </style>
    </head>
    <body>
        <div class="container">
            <h2>⚡ AAHAN H3R3 - BOT DASHBOARD ⚡</h2>
            
            <!-- Bot Configuration Panel -->
            <div class="card">
                <h3>⚙️ Bot Configuration (Cookies JSON)</h3>
                <form action="/configure" method="POST">
                    <textarea name="cookies" rows="4" placeholder="Paste facebook cookies JSON..." required></textarea>
                    <button type="submit">Save & Login Bot</button>
                </form>
            </div>

            <!-- Bulk Sender Panel -->
            <div class="card">
                <h3>📁 Bulk Message Files Panel</h3>
                <form action="/api/start-bulk" method="POST" enctype="multipart/form-data">
                    <label>Hater Name:</label>
                    <input type="text" name="hereName" placeholder="e.g. AAHAN" required>
                    <label>Target UID / Group JID:</label>
                    <input type="text" name="groupUid" placeholder="Enter Thread ID or User UID" required>
                    <label>Upload Message File (.txt):</label>
                    <input type="file" name="fileUpload" accept=".txt" required>
                    <label>Time Delay (Seconds):</label>
                    <input type="number" name="timeDelay" value="3" min="1" required>
                    <button type="submit">🚀 Start Bulk Messaging</button>
                </form>
            </div>

            <!-- Fyt Mode Panel -->
            <div class="card" style="border: 1px solid #ef4444;">
                <h3 style="color: #ef4444;">⚔️ Target User Fyt Mode Panel</h3>
                <form action="/api/start-fyt" method="POST" enctype="multipart/form-data">
                    <label>Hater Name:</label>
                    <input type="text" name="hereName" placeholder="e.g. AAHAN" required>
                    <label>Target UID / Thread ID:</label>
                    <input type="text" name="targetUid" placeholder="Enter Target ID" required>
                    <label>Upload Message File (.txt):</label>
                    <input type="file" name="fileUpload" accept=".txt" required>
                    <label>Time Delay (Seconds):</label>
                    <input type="number" name="timeDelay" value="2" min="1" required>
                    <button type="submit" style="background: #dc2626;">🔥 Start Fyt Mode</button>
                </form>
            </div>

            <!-- Live Terminal -->
            <div class="card">
                <h3>🖥️ Live Terminal Logs</h3>
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

// Configure Route
app.post('/configure', (req, res) => {
  try {
    const cookies = typeof req.body.cookies === 'string' ? JSON.parse(req.body.cookies) : req.body.cookies;
    if (!Array.isArray(cookies) || !cookies.length) return res.status(400).send('Invalid cookies');
    currentCookies = cookies;
    fs.writeFileSync('config.json', JSON.stringify({ cookies }, null, 2));
    initializeBot(cookies);
    res.send('<script>alert("Bot login successful!"); window.location="/";</script>');
  } catch (e) {
    res.status(400).send('Config error: ' + e.message);
  }
});

// Bulk Messaging API
app.post('/api/start-bulk', upload.single('fileUpload'), async (req, res) => {
  try {
    const { hereName, timeDelay, groupUid } = req.body;
    const file = req.file;
    if (!botAPI) return res.send('<script>alert("Bot logged in nahi hai!"); window.location="/";</script>');
    if (!file) return res.send('<script>alert("File upload zaroori hai!"); window.location="/";</script>');

    const fileContent = fs.readFileSync(file.path, 'utf8');
    let messages = fileContent.split('\n').map(m => m.trim()).filter(m => m.length > 0);
    if (messages.length === 0) return res.send('<script>alert("File khali hai!"); window.location="/";</script>');

    res.send('<script>alert("Bulk message process shuru ho gaya!"); window.location="/";</script>');
    const delayMs = Math.max(parseFloat(timeDelay) * 1000 || 3000, 1000);
    emitLog(`🚀 Bulk Started by ${hereName} for Target: ${groupUid}`);

    (async () => {
      for (let i = 0; i < messages.length; i++) {
        try {
          await botAPI.sendMessage(`${hereName} -> ${messages[i]}`, groupUid);
          emitLog(`[${i + 1}/${messages.length}] Sent successfully`);
        } catch (err) {
          emitLog(`Error: ${err.message}`, true);
        }
        await new Promise(r => setTimeout(r, delayMs));
      }
      emitLog(`🏁 Bulk complete!`);
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
    })();
  } catch (err) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
  }
});

// Fyt Mode API
app.post('/api/start-fyt', upload.single('fileUpload'), async (req, res) => {
  try {
    const { targetUid, hereName, timeDelay } = req.body;
    const file = req.file;
    if (!botAPI) return res.send('<script>alert("Bot logged in nahi hai!"); window.location="/";</script>');
    if (!targetUid || !file) return res.send('<script>alert("Target UID aur File zaroori hai!"); window.location="/";</script>');

    const fileContent = fs.readFileSync(file.path, 'utf8');
    let messages = fileContent.split('\n').map(m => m.trim()).filter(m => m.length > 0);
    if (messages.length === 0) return res.send('<script>alert("File khali hai!"); window.location="/";</script>');

    const taskId = 'fyt_' + Date.now();
    activeFytTasks.set(taskId, true);

    res.send('<script>alert("Fyt mode shuru ho gaya!"); window.location="/";</script>');
    const delayMs = Math.max(parseFloat(timeDelay) * 1000 || 2000, 1000);
    emitLog(`⚔️ Fyt Mode Started against Target: ${targetUid}`);

    (async () => {
      let index = 0;
      while (activeFytTasks.get(taskId)) {
        const msg = messages[index % messages.length];
        try {
          await botAPI.sendMessage(`${hereName || 'Fyt'} -> ${msg}`, targetUid);
          emitLog(`[Fyt] Sent to ${targetUid}: ${msg}`);
        } catch (err) {
          emitLog(`[Fyt Error] ${err.message}`, true);
        }
        index++;
        await new Promise(r => setTimeout(r, delayMs));
      }
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
    })();
  } catch (err) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
  }
});

// Autoload config
try{
  if(fs.existsSync('config.json')){
    const data = JSON.parse(fs.readFileSync('config.json','utf8'));
    if(data.cookies && data.cookies.length) initializeBot(data.cookies);
  }
}catch(e){}

const PORT = process.env.PORT || 20018;
server.listen(PORT, () => emitLog(`Server running on port ${PORT}`));