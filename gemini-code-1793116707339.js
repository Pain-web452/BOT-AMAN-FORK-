// super_masti_bot_v8_complete.js
const express = require('express');
const bodyParser = require('body-parser');
const login = require('ws3-fca');
const fs = require('fs');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

let botAPI = null;
let currentCookies = null;
let botActive = true;
let prefix = '/';
const handledMessageIds = new Map();
const lastReplyAt = {};
const THREAD_COOLDOWN_MS = 2000;

// Anti-out system - FIXED: Now properly mutable
let antiOutEnabled = true;
const lastActiveTime = {};
const ANTI_OUT_CHECK_INTERVAL = 60000; // 1 minute

// === NEW: LOCK SYSTEMS STORAGE ===
const gcLocks = new Map();     // threadID -> locked group title
const nickLocks = new Map();   // threadID -> Map(userID -> locked nickname)
const dpLocks = new Map();     // threadID -> boolean (DP lock state)

// Schedule goodnight messages
let goodnightScheduled = false;

// Admin user ID (replace with your actual Facebook ID)
const ADMIN_USER_ID = '100021420605776';

// Bot uptime tracking
let botStartTime = Date.now();
let isBotRunning = true;

// User gender detection storage
const userGenderCache = new Map();
const userMessageCount = new Map();

// NEW: Track left users for auto-rejoin
const leftUsers = new Map();
const autoRejoinEnabled = true;

// Anti-out monitoring - FIXED: Properly checks antiOutEnabled variable
setInterval(() => {
  if (!botAPI || !antiOutEnabled || !isBotRunning) return;
  const now = Date.now();
  Object.keys(lastActiveTime).forEach(threadID => {
    if (now - lastActiveTime[threadID] > 30*60*1000) { // 30 minutes inactive
      sendAntiOutMessage(threadID);
    }
  });
}, ANTI_OUT_CHECK_INTERVAL);

function pickRandom(arr){ return arr[Math.floor(Math.random()*arr.length)]; }
function emitLog(msg,isErr=false){ const log = `[${new Date().toISOString()}] ${isErr?'ERROR':'INFO'}: ${msg}`; console.log(log); io.emit('botlog',log); }
function getMessageId(event){ return event.messageID || event.messageId || null; }
function containsEmoji(text){ return /[\p{Emoji}]/u.test(text); }

// Stylish AAHAN H3R3 signature
function getSignature() {
  const signatures = [
    "\n\n✨ 🅐🅐🅗🅐🅝 🅗3🅡3 ✨",
    "\n\n🌟 🇦 🇦 🇭 🇦 🇳  🇭 3 🇷 3 🌟", 
    "\n\n🔥 𝔸𝔸ℍ𝔸ℕ ℍ3ℝ3 🔥",
    "\n\n💫 𝓐𝓐𝓗𝓐𝓝 𝓗3𝓡3 💫",
    "\n\n🎯 𝔄𝔄𝔥𝔄𝔫 ℌ3\3 🎯",
    "\n\n⚡ ₳₳Ⱨ₳₦ Ⱨ3Ɽ3 ⚡",
    "\n\n🚀 ᗩᗩᕼᗩᑎ ᕼ3ᖇ3 🚀",
    "\n\n💖 ααнαη н3я3 💖"
  ];
  return pickRandom(signatures);
}

// NEW: Auto rejoin when user leaves group
async function handleUserLeave(event) {
  if (!botAPI || !autoRejoinEnabled) return;
  
  try {
    const { threadID, logMessageData } = event;
    const leftUserID = logMessageData.leftParticipantFbId;
    
    if (!leftUserID) return;
    
    // Store left user info
    leftUsers.set(leftUserID, {
      threadID,
      leftAt: Date.now(),
      userName: logMessageData.leftParticipantFullName || 'User'
    });
    
    emitLog(`User ${leftUserID} left group ${threadID}, ready for auto-rejoin`);
    
    // Send notification to admin
    const adminMessage = `🚨 User Left Group 🚨\n\nName: ${logMessageData.leftParticipantFullName || 'Unknown'}\nID: ${leftUserID}\nGroup: ${threadID}\n\nAuto-rejoin feature is active!`;
    
    await botAPI.sendMessage(adminMessage, ADMIN_USER_ID);
    
  } catch (error) {
    emitLog('User leave handler error: ' + error.message, true);
  }
}

// NEW: Auto rejoin user when they message the bot
async function autoRejoinUser(userID) {
  if (!botAPI || !autoRejoinEnabled) return false;
  
  try {
    const leftUserInfo = leftUsers.get(userID);
    if (!leftUserInfo) return false;
    
    const { threadID, userName } = leftUserInfo;
    
    // Add user back to group
    await botAPI.addUserToGroup(userID, threadID);
    
    // Remove from tracking
    leftUsers.delete(userID);
    
    // Send success message
    const successMsg = `✅ Successfully added ${userName} back to the group!`;
    await botAPI.sendMessage(successMsg, ADMIN_USER_ID);
    
    emitLog(`Auto-rejoined user ${userName} to group ${threadID}`);
    return true;
    
  } catch (error) {
    emitLog('Auto-rejoin error: ' + error.message, true);
    return false;
  }
}

// NEW: Set bot nickname in group
async function setBotNickname(threadID) {
  if (!botAPI) return;
  
  try {
    const nicknames = ["99H9N H3R3😎", "𝕬𝖆𝖍𝖆𝖓 𝕳3𝖗3🔥", "₳₳Ⱨ₳₦ Ⱨ3Ɽ3⚡", "ααнαη н3я3💫"];
    const nickname = pickRandom(nicknames);
    
    await botAPI.changeNickname(nickname, botAPI.getCurrentUserID(), threadID);
    emitLog(`Set nickname to ${nickname} in group ${threadID}`);
  } catch (error) {
    emitLog('Nickname set error: ' + error.message, true);
  }
}

// NEW: Enhanced welcome message when bot is added to group
async function sendWelcomeMessage(threadID) {
  if (!botAPI) return;
  
  try {
    const welcomeMessages = [
      `🎉 AAGYA AAGYA DIL CHURANE MAIN AAGAYA! 🎉\n\nMai aa gaya hoon tumhare group ko rock karne! 🚀\n\nMere paas hai:\n✅ 50+ Romantic Shayari\n✅ 30+ Mazedaar Jokes\n✅ 25+ Flirty Messages\n✅ 20+ Roasting Lines\n✅ Baatchit ke liye ready!\n\nType "/help" for commands!${getSignature()}`,
      
      `🔥 AA GAYA SWAG KE SAATH! 🔥\n\nTumhara wait khatam, main aa gaya!\n\nFeatures:\n✨ Smart Baatchit\n💖 Heart Touching Shayari\n😂 Hasane Wale Jokes\n😎 Flirty Conversations\n🎯 Roasting Game Strong\n\nUse "/help" to explore!${getSignature()}`
    ];
    
    const welcomeMsg = pickRandom(welcomeMessages);
    await botAPI.sendMessage(welcomeMsg, threadID);
    await setBotNickname(threadID);
    
    emitLog(`Sent welcome message to group ${threadID}`);
  } catch (error) {
    emitLog('Welcome message error: ' + error.message, true);
  }
}

// Detect if user is female based on name and message patterns
async function detectUserGender(api, userID) {
  if (userGenderCache.has(userID)) {
    return userGenderCache.get(userID);
  }

  try {
    const userInfo = await api.getUserInfo(userID);
    const user = userInfo[userID];
    if (user) {
      const name = user.name || '';
      const firstName = name.split(' ')[0].toLowerCase();
      
      const femaleIndicators = ['priya', 'neha', 'sonia', 'kavita', 'pooja', 'anjali', 'ritu', 'sneha', 'divya', 'shweta', 'mehak', 'sana', 'zoya', 'aisha', 'fatima', 'sarah', 'ayesha'];
      const maleIndicators = ['rahul', 'rohit', 'amit', 'vivek', 'sanjay', 'ravi', 'akash', 'vikas', 'deepak', 'suresh', 'mohit', 'nitin', 'gaurav', 'anil'];
      
      if (femaleIndicators.some(indicator => firstName.includes(indicator))) {
        userGenderCache.set(userID, 'female');
        return 'female';
      } else if (maleIndicators.some(indicator => firstName.includes(indicator))) {
        userGenderCache.set(userID, 'male');
        return 'male';
      }
    }
  } catch (error) {
    emitLog('Gender detection error: ' + error.message, true);
  }
  
  userGenderCache.set(userID, 'unknown');
  return 'unknown';
}

const replies = {
  goodmorning:[
    `Good morning ☀️ uth jao lazy panda 😴${getSignature()}`,
    `Good morning hero 😎 - aaj ka din tumhara hai!${getSignature()}`
  ],
  goodnight:[
    `Good night 🌙 sweet dreams 😴${getSignature()}`
  ],
  hi:[
    `Hi cutie 😍${getSignature()}`
  ],
  hello:[
    `Hello ji 😍 kya haal hai?${getSignature()}`
  ],
  bot:[
    `Kya hua bhai, bot ko yaad kiya 😏${getSignature()}`
  ],
  emoji:[
    `Nice emoji 😍${getSignature()}`
  ],
  shayari:[
    `Tere jaise dost mile to zindagi easy lagti hai 💕${getSignature()}`
  ],
  gana:[
    `Aaj mood me hoon mai full on music 🎶${getSignature()}`
  ],
  flirt:[
    `Aankhein mila ke dekho toh pata chalega 😉${getSignature()}`
  ],
  roast:[
    `Tere jaise logo ko dekh ke lagta hai nature ne experiment kiya tha 😂${getSignature()}`
  ],
  masti:[
    `Party shuru kar do! 🎉${getSignature()}`
  ],
  jokes:[
    `Teacher: Bachcho, batado 5 aise fruits... 🤣${getSignature()}`
  ],
  mazedaar:[
    `Yaar aaj toh maza aa gaya! 😝${getSignature()}`
  ],
  baatchit:[
    `Kya haal chaal hai bhai? Sab theek? 😊${getSignature()}`
  ],
  female_flirt: [
    `Aapki profile pic dekh ke toh dil dhadak gaya! 😍${getSignature()}`
  ]
};

const helpMessage = `
🤖 *AAHAN H3R3 BOT COMMANDS* 🤖

🛠️ *Basic Commands:*
/start - Bot activate kare
/stop - Bot deactivate kare  
/help - Ye help message dikhaye

🛡️ *Lock Systems (New):*
/gclock - Group name lock on
/gcunlock - Group name lock off
/nlock - Nickname lock on
/nunlock - Nickname lock off
/dplock - Group DP lock on
/dpunlock - Group DP lock off

😊 *Greetings & Fun:*
/flirt, /roast, /masti, /joke, /mazedaar, /shayari, /baat

🛡️ *Admin Controls:*
/antion - Anti-out system on
/antioff - Anti-out system off
/status - Bot status check

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
    
    if (!goodnightScheduled) {
      scheduleGoodnightMessages();
      goodnightScheduled = true;
    }
    
    startListening(api);
  });
}

function scheduleGoodnightMessages() {
  const now = new Date();
  const nightTime = new Date();
  nightTime.setHours(24, 0, 0, 0);
  
  const timeUntilNight = nightTime.getTime() - now.getTime();
  
  setTimeout(() => {
    sendScheduledGoodnight();
    setInterval(sendScheduledGoodnight, 24 * 60 * 60 * 1000);
  }, timeUntilNight);
}

async function sendScheduledGoodnight() {
  if (!botAPI || !isBotRunning) return;
  try {
    const threadList = await botAPI.getThreadList(100, null, []);
    for (const thread of threadList) {
      if (thread.isGroup) {
        await botAPI.sendMessage(`🌙 Good Night Everyone! 😴 ${getSignature()}`, thread.threadID);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  } catch (error) {
    emitLog('Error sending scheduled goodnight: ' + error.message, true);
  }
}

async function sendAntiOutMessage(threadID) {
  if (!botAPI || !isBotRunning) return;
  try {
    await botAPI.sendMessage(`Kya hua? Sab so gaye kya? 😴 Yaad kar lo!${getSignature()}`, threadID);
    lastActiveTime[threadID] = Date.now();
  } catch (error) {}
}

// === ENHANCED LISTENER ===
function startListening(api){
  api.listenMqtt(async (err,event)=>{
    if(err) return emitLog('Listener error: '+err.message,true);
    if(!event) return;
    
    // === EVENT LOG HANDLERS (Locks, Unsubscribes, Subscribes) ===
    if (event.type === 'event') {
      const { threadID, logMessageType, logMessageData } = event;
      
      if (logMessageType === 'log:unsubscribe') {
        await handleUserLeave(event);
        return;
      }
      
      if (logMessageType === 'log:subscribe' && logMessageData.addedParticipants) {
        const addedParticipants = logMessageData.addedParticipants;
        const botID = api.getCurrentUserID();
        if (addedParticipants.some(participant => participant.userFbId === botID)) {
          await sendWelcomeMessage(threadID);
          return;
        }
      }

      // 1. GC Lock Check
      if (logMessageType === 'log:thread-name' && gcLocks.has(threadID)) {
        const lockedName = gcLocks.get(threadID);
        const newName = logMessageData.name;
        if (newName !== lockedName) {
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
          const currentNick = logMessageData.nickname;
          if (currentNick !== lockedNick) {
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
      if (leftUsers.has(senderID)) {
        await autoRejoinUser(senderID);
      }

      lastActiveTime[threadID] = Date.now();

      const myID = api.getCurrentUserID ? api.getCurrentUserID() : null;
      if(myID && String(senderID)===String(myID)) return;

      const mid = getMessageId(event);
      if(mid && handledMessageIds.has(mid)) return;
      if(mid) handledMessageIds.set(mid,Date.now());

      const text = body.toString().trim().toLowerCase();

      if(text === `${prefix}help`) {
        await api.sendMessage(helpMessage, threadID);
        return;
      }

      const isAdmin = String(senderID) === String(ADMIN_USER_ID);
      
      if(text===`${prefix}stop` && isAdmin){ botActive=false; await api.sendMessage(`🤖 Bot stopped! ${getSignature()}`,threadID); return; }
      if(text===`${prefix}start` && isAdmin){ botActive=true; await api.sendMessage(`🤖 Bot started! ${getSignature()}`,threadID); return; }
      if(text===`${prefix}antion` && isAdmin){ antiOutEnabled=true; await api.sendMessage(`🛡️ Anti-out ON! ${getSignature()}`,threadID); return; }
      if(text===`${prefix}antioff` && isAdmin){ antiOutEnabled=false; await api.sendMessage(`🛡️ Anti-out OFF! ${getSignature()}`,threadID); return; }

      // === LOCK COMMANDS ===
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
        await api.sendMessage(`🔓 **GC Lock Deactivated!**${getSignature()}`, threadID);
        return;
      }

      if(text===`${prefix}nlock`) {
        api.getThreadInfo(threadID, async (err, info) => {
          if (err) return;
          const nickMap = new Map();
          if (info.nicknames) {
            for (const [uid, nick] of Object.entries(info.nicknames)) {
              nickMap.set(uid, nick);
            }
          }
          nickLocks.set(threadID, nickMap);
          await api.sendMessage(`🔒 **Nickname Lock Activated!**${getSignature()}`, threadID);
        });
        return;
      }

      if(text===`${prefix}nunlock`) {
        nickLocks.delete(threadID);
        await api.sendMessage(`🔓 **Nickname Lock Deactivated!**${getSignature()}`, threadID);
        return;
      }

      if(text===`${prefix}dplock`) {
        dpLocks.set(threadID, true);
        await api.sendMessage(`🔒 **Group DP Lock Activated!**${getSignature()}`, threadID);
        return;
      }

      if(text===`${prefix}dpunlock`) {
        dpLocks.delete(threadID);
        await api.sendMessage(`🔓 **Group DP Lock Deactivated!**${getSignature()}`, threadID);
        return;
      }

      if(text===`${prefix}status`){ 
        const uptime = Math.floor((Date.now() - botStartTime) / 1000);
        const statusMessage = `🤖 *BOT STATUS* 🤖\n\n📊 Status: ${botActive ? '🟢 ACTIVE' : '🔴 INACTIVE'}\n🔒 GC Lock: ${gcLocks.has(threadID) ? '🟢 ON' : '🔴 OFF'}\n🔒 Nick Lock: ${nickLocks.has(threadID) ? '🟢 ON' : '🔴 OFF'}\n🔒 DP Lock: ${dpLocks.has(threadID) ? '🟢 ON' : '🔴 OFF'}\n⏰ Uptime: ${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`;
        await api.sendMessage(statusMessage, threadID);
        return;
      }

      // Public commands
      if(text===`${prefix}flirt`){ await api.sendMessage(pickRandom(replies.flirt),threadID); return;}
      if(text===`${prefix}roast`){ await api.sendMessage(pickRandom(replies.roast),threadID); return;}
      if(text===`${prefix}masti`){ await api.sendMessage(pickRandom(replies.masti),threadID); return;}
      if(text===`${prefix}joke`){ await api.sendMessage(pickRandom(replies.jokes),threadID); return;}
      if(text===`${prefix}mazedaar`){ await api.sendMessage(pickRandom(replies.mazedaar),threadID); return;}
      if(text===`${prefix}shayari`){ await api.sendMessage(`📜 ${pickRandom(replies.shayari)}`,threadID); return;}
      if(text===`${prefix}baat`){ await api.sendMessage(pickRandom(replies.baatchit),threadID); return;}

      if(!botActive) return;

      let replyText = null;
      if(text.includes('hi')) replyText = pickRandom(replies.hi);
      else if(text.includes('hello')) replyText = pickRandom(replies.hello);
      else if(text.includes('shayari')) replyText = pickRandom(replies.shayari);

      if(replyText){
        let name='User';
        try{ const info=await api.getUserInfo(senderID); name=info[senderID]?.name||name; }catch{}
        await api.sendMessage({ body:`@${name} ${replyText}`, mentions:[{ tag:name, id:senderID }] }, threadID);
      }
    }catch(e){ emitLog('Handler error: '+e.message,true); }
  });
}

// === EXPRESS SERVER ===
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/configure',(req,res)=>{
  try{
    const cookies=typeof req.body.cookies==='string'?JSON.parse(req.body.cookies):req.body.cookies;
    if(!Array.isArray(cookies)||!cookies.length) return res.status(400).send('Invalid cookies');
    currentCookies=cookies;
    fs.writeFileSync('config.json',JSON.stringify({cookies},null,2));
    initializeBot(cookies);
    res.send('Bot configured & starting...');
  }catch(e){ res.status(400).send('Config error: '+e.message); }
});

try{
  if(fs.existsSync('config.json')){
    const data=JSON.parse(fs.readFileSync('config.json','utf8'));
    if(data.cookies && data.cookies.length) initializeBot(data.cookies);
  }
}catch(e){ emitLog('Config load error: '+e.message,true); }

const PORT = process.env.PORT||20018;
server.listen(PORT,()=>emitLog(`Server running on port ${PORT} - Locks Active!`));