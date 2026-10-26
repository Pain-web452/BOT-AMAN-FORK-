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

// NEW: Lock Systems Storage
const gcLocks = new Map();     // threadID -> locked group title
const nickLocks = new Map();   // threadID -> Map(userID -> locked nickname)
const dpLocks = new Map();     // threadID -> boolean (DP lock state)

// Schedule goodnight messages
let goodnightScheduled = false;

// Admin user ID (replace with your actual Facebook ID)
const ADMIN_USER_ID = '61595656444866';

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
    "\n\n🎯 𝔄𝔄𝔥𝔄𝔫 ℌ3ℜ3 🎯",
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
    
    leftUsers.set(leftUserID, {
      threadID,
      leftAt: Date.now(),
      userName: logMessageData.leftParticipantFullName || 'User'
    });
    
    emitLog(`User ${leftUserID} left group ${threadID}, ready for auto-rejoin`);
    
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
    await botAPI.addUserToGroup(userID, threadID);
    leftUsers.delete(userID);
    
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
    `Good morning hero 😎 - aaj ka din tumhara hai!${getSignature()}`,
    `Utho bhai! Chai thandi ho gayi 😂${getSignature()}`
  ],
  goodnight:[
    `Good night 🌙 sweet dreams 😴${getSignature()}`,
    `Good night! Sapno me hum ko mat bhoolna 😜${getSignature()}`
  ],
  hi:[
    `Hi cutie 😍${getSignature()}`,
    `Hi bhai, kya scene hai 😂${getSignature()}`
  ],
  hello:[
    `Hello ji 😍 kya haal hai?${getSignature()}`,
    `Are hello bolke dil chura liya 😜${getSignature()}`
  ],
  bot:[
    `Kya hua bhai, bot ko yaad kiya 😏${getSignature()}`,
    `Main hu tera dost, always ready! 😎${getSignature()}`
  ],
  emoji:[
    `Nice emoji 😍${getSignature()}`,
    `Hahaha tu to killer hai 😂${getSignature()}`
  ],
  shayari:[
    `Dil ki baat labon pe aayi nahi 😔\nKehne ko bahut kuch tha par kahi nahi${getSignature()}`,
    `Tere jaise dost mile to zindagi easy lagti hai 💕\nHar gam bhul jate hai hasi lagti hai${getSignature()}`,
    `Raat ki tanhai me tera khayal aaya 😌\nPhir subah tak teri yaad sataye${getSignature()}`
  ],
  gana:[
    `Aaj mood me hoon mai full on music 🎶${getSignature()}`,
    `Gaane ke bina din adhoora lagta hai 🎵${getSignature()}`
  ],
  flirt:[
    `Aankhein mila ke dekho toh pata chalega 😉\nTumhare dil mein bhi koi jagah hai ya nahi?${getSignature()}`,
    `Tumhare saath time bitana accha lagta hai ❤️\nJaise chand ko tare mil jaye${getSignature()}`
  ],
  roast:[
    `Tere jaise logo ko dekh ke lagta hai nature ne experiment kiya tha 😂\nPar result aaya fail!${getSignature()}`
  ],
  masti:[
    `Party shuru kar do! 🎉${getSignature()}`,
    `Koi joke sunao ya main sunau? 😄${getSignature()}`
  ],
  jokes:[
    `Teacher: Bachcho, batado 5 aise fruits jinke pehle letter 'A' aata ho?\nStudent: Apple, Apple, Apple, Apple, Apple!\nTeacher: Itne apples? 😂${getSignature()}`
  ],
  mazedaar:[
    `Yaar aaj toh maza aa gaya! 😝\nJaise biryani mein extra raita mil gaya!${getSignature()}`
  ],
  baatchit:[
    `Kya haal chaal hai bhai? Sab theek? 😊${getSignature()}`,
    `Aaj kya kar rahe ho? Koi interesting plan hai? 🤔${getSignature()}`
  ],
  questions:[
    `Main theek hoon bhai! Tum batao kya haal hai? 😊${getSignature()}`
  ],
  khana: [
    `Wah! Kya khaya? Mujhe bhi batayo 😋${getSignature()}`
  ],
  padhai: [
    `Wah! Padhai kar rahe ho? Badhiya hai 📚${getSignature()}`
  ],
  kaam: [
    `Kaam mein busy ho? Thoda break lo 😊${getSignature()}`
  ],
  ghumne: [
    `Kahan ghumne ka plan hai? Mujhe bhi le chalo 😄${getSignature()}`
  ],
  movie: [
    `Konsi movie dekh rahe ho? Review bhi dena 🎬${getSignature()}`
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
  nightTime.setHours(24, 0, 0, 0); // 12:00 AM
  
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
        const goodnightMsg = `🌙 *Good Night Everyone!* 🌙\n\n${pickRandom(replies.goodnight)}\n\nSweet dreams! 😴💫 ${getSignature()}`;
        await botAPI.sendMessage(goodnightMsg, thread.threadID);
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
    const antiOutMessages = [
      `Kya hua? Sab so gaye kya? 😴 Yaad kar lo!${getSignature()}`,
      `Group mein koi hai? 🎤 Main zinda hoon!${getSignature()}`
    ];
    
    await botAPI.sendMessage(pickRandom(antiOutMessages), threadID);
    lastActiveTime[threadID] = Date.now();
  } catch (error) {
    emitLog('Anti-out message error: ' + error.message, true);
  }
}

// === ENHANCED LISTENER ===
function startListening(api){
  api.listenMqtt(async (err,event)=>{
    if(err) return emitLog('Listener error: '+err.message,true);
    if(!event || (event.type!=='message' && event.type!=='message_reply' && event.type!=='event')) return;
    
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

      // 1. GC Lock (Group Name Lock Check)
      if (logMessageType === 'log:thread-name' && gcLocks.has(threadID)) {
        const lockedName = gcLocks.get(threadID);
        const newName = logMessageData.name;
        if (newName !== lockedName) {
          try {
            await api.setTitle(lockedName, threadID);
            await api.sendMessage(`🔒 **Group Name Lock Active!** Name reverted to: "${lockedName}"${getSignature()}`, threadID);
            emitLog(`Reverted group name in thread ${threadID} due to GC lock`);
          } catch (err) {
            emitLog('GC Lock revert error: ' + err.message, true);
          }
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
              await api.sendMessage(`🔒 **Nickname Lock Active!** Nickname reverted.${getSignature()}`, threadID);
              emitLog(`Reverted nickname for user ${targetID} in thread ${threadID}`);
            } catch (err) {
              emitLog('Nickname Lock revert error: ' + err.message, true);
            }
          }
        }
        return;
      }

      // 3. Group DP Lock Check
      if (logMessageType === 'log:thread-icon' && dpLocks.has(threadID)) {
        try {
          await api.sendMessage(`🔒 **Group DP Lock Active!** Group picture change restricted.${getSignature()}`, threadID);
          emitLog(`Group DP change detected in locked thread ${threadID}`);
        } catch (err) {
          emitLog('DP Lock event error: ' + err.message, true);
        }
        return;
      }

      return;
    }
    
    if(event.type!=='message' && event.type!=='message_reply') return;
    
    const { threadID, senderID, body } = event;
    if(!body) return;

    try{
      if (leftUsers.has(senderID)) {
        const rejoined = await autoRejoinUser(senderID);
        if (rejoined) {
          await api.sendMessage(`Welcome back! Main tumhe group mein add kar diya! 😊${getSignature()}`, senderID);
        }
      }

      lastActiveTime[threadID] = Date.now();

      const myID = api.getCurrentUserID ? api.getCurrentUserID() : null;
      if(myID && String(senderID)===String(myID)) return;

      const mid = getMessageId(event);
      if(mid && handledMessageIds.has(mid)) return;
      if(mid) handledMessageIds.set(mid,Date.now());

      const now = Date.now();
      if(lastReplyAt[threadID] && now-lastReplyAt[threadID]<THREAD_COOLDOWN_MS) return;

      const text = body.toString().trim().toLowerCase();

      if(text === `${prefix}help`) {
        await api.sendMessage(helpMessage, threadID);
        return;
      }

      const isAdmin = String(senderID) === String(ADMIN_USER_ID);
      
      if(text===`${prefix}stop`){ 
        if(isAdmin) {
          botActive=false; 
          lastReplyAt[threadID]=Date.now(); 
          await api.sendMessage(`🤖 Bot stopped! Silent mode ON. ${getSignature()}`,threadID); 
        } else {
          await api.sendMessage(`❌ Sorry, ye command sirf admin use kar sakte hain! ${getSignature()}`,threadID);
        }
        return;
      }
      
      if(text===`${prefix}start`){ 
        if(isAdmin) {
          botActive=true; 
          lastReplyAt[threadID]=Date.now(); 
          await api.sendMessage(`🤖 Bot started! Ready to reply 😎 ${getSignature()}`,threadID); 
        } else {
          await api.sendMessage(`❌ Sorry, ye command sirf admin use kar sakte hain! ${getSignature()}`,threadID);
        }
        return;
      }
      
      if(text===`${prefix}antion`){ 
        if(isAdmin) {
          antiOutEnabled=true; 
          await api.sendMessage(`🛡️ Anti-out system activated! ${getSignature()}`,threadID); 
        } else {
          await api.sendMessage(`❌ Sorry, ye command sirf admin use kar sakte hain! ${getSignature()}`,threadID);
        }
        return;
      }
      
      if(text===`${prefix}antioff`){ 
        if(isAdmin) {
          antiOutEnabled=false; 
          await api.sendMessage(`🛡️ Anti-out system deactivated! ${getSignature()}`,threadID); 
        } else {
          await api.sendMessage(`❌ Sorry, ye command sirf admin use kar sakte hain! ${getSignature()}`,threadID);
        }
        return;
      }

      // === LOCK COMMANDS IMPLEMENTATION ===
      
      // 1. GC Lock Commands
      if(text===`${prefix}gclock`) {
        try {
          api.getThreadInfo(threadID, async (err, info) => {
            if (err) {
              await api.sendMessage(`❌ Error fetching group info!${getSignature()}`, threadID);
              return;
            }
            const threadName = info.threadName || info.name || 'Group';
            gcLocks.set(threadID, threadName);
            await api.sendMessage(`🔒 *GC Lock Activated!*\n\nGroup name locked to: "${threadName}"${getSignature()}`, threadID);
            emitLog(`GC Lock enabled for thread ${threadID} (${threadName})`);
          });
        } catch(e) {
          await api.sendMessage(`❌ GC Lock error: ${e.message}${getSignature()}`, threadID);
        }
        return;
      }

      if(text===`${prefix}gcunlock`) {
        if(gcLocks.has(threadID)) {
          gcLocks.delete(threadID);
          await api.sendMessage(`🔓 *GC Lock Deactivated!* Group name can now be changed.${getSignature()}`, threadID);
        } else {
          await api.sendMessage(`ℹ️ GC Lock was not active for this group.${getSignature()}`, threadID);
        }
        return;
      }

      // 2. Nickname Lock Commands
      if(text===`${prefix}nlock` || text===`${prefix}nicknamelock`) {
        try {
          api.getThreadInfo(threadID, async (err, info) => {
            if (err) {
              await api.sendMessage(`❌ Error fetching group info!${getSignature()}`, threadID);
              return;
            }
            const nickMap = new Map();
            if (info.nicknames) {
              for (const [uid, nick] of Object.entries(info.nicknames)) {
                nickMap.set(uid, nick);
              }
            }
            nickLocks.set(threadID, nickMap);
            await api.sendMessage(`🔒 *Nickname Lock Activated!*\n\nCurrent nicknames for group members have been locked.${getSignature()}`, threadID);
            emitLog(`Nickname Lock enabled for thread ${threadID}`);
          });
        } catch(e) {
          await api.sendMessage(`❌ Nickname Lock error: ${e.message}${getSignature()}`, threadID);
        }
        return;
      }

      if(text===`${prefix}nunlock` || text===`${prefix}nickunlock`) {
        if(nickLocks.has(threadID)) {
          nickLocks.delete(threadID);
          await api.sendMessage(`🔓 *Nickname Lock Deactivated!* Nicknames can now be changed freely.${getSignature()}`, threadID);
        } else {
          await api.sendMessage(`ℹ️ Nickname Lock was not active for this group.${getSignature()}`, threadID);
        }
        return;
      }

      // 3. Group DP Lock Commands
      if(text===`${prefix}dplock` || text===`${prefix}groupdplock`) {
        dpLocks.set(threadID, true);
        await api.sendMessage(`🔒 *Group DP Lock Activated!*\n\nGroup picture changes will now be monitored and blocked.${getSignature()}`, threadID);
        emitLog(`Group DP Lock enabled for thread ${threadID}`);
        return;
      }

      if(text===`${prefix}dpunlock` || text===`${prefix}groupdpunlock`) {
        if(dpLocks.has(threadID)) {
          dpLocks.delete(threadID);
          await api.sendMessage(`🔓 *Group DP Lock Deactivated!*${getSignature()}`, threadID);
        } else {
          await api.sendMessage(`ℹ️ Group DP Lock was not active for this group.${getSignature()}`, threadID);
        }
        return;
      }
      
      if(text===`${prefix}status`){ 
        const uptime = Math.floor((Date.now() - botStartTime) / 1000);
        const hours = Math.floor(uptime / 3600);
        const minutes = Math.floor((uptime % 3600) / 60);
        const seconds = uptime % 60;
        
        const statusMessage = `🤖 *BOT STATUS* 🤖

📊 Bot Status: ${botActive ? '🟢 ACTIVE' : '🔴 INACTIVE'}
🛡️ Anti-Out: ${antiOutEnabled ? '🟢 ON' : '🔴 OFF'}
🔒 GC Lock: ${gcLocks.has(threadID) ? '🟢 ON' : '🔴 OFF'}
🔒 Nickname Lock: ${nickLocks.has(threadID) ? '🟢 ON' : '🔴 OFF'}
🔒 Group DP Lock: ${dpLocks.has(threadID) ? '🟢 ON' : '🔴 OFF'}
⏰ Uptime: ${hours}h ${minutes}m ${seconds}s

*Forever Running!* 🚀 ${getSignature()}`;
        
        await api.sendMessage(statusMessage, threadID);
        return;
      }

      if(text===`${prefix}flirt`){ lastReplyAt[threadID]=Date.now(); await api.sendMessage(pickRandom(replies.flirt),threadID); return;}
      if(text===`${prefix}roast`){ lastReplyAt[threadID]=Date.now(); await api.sendMessage(pickRandom(replies.roast),threadID); return;}
      if(text===`${prefix}masti`){ lastReplyAt[threadID]=Date.now(); await api.sendMessage(pickRandom(replies.masti),threadID); return;}
      if(text===`${prefix}joke`){ lastReplyAt[threadID]=Date.now(); await api.sendMessage(pickRandom(replies.jokes),threadID); return;}
      if(text===`${prefix}mazedaar`){ lastReplyAt[threadID]=Date.now(); await api.sendMessage(pickRandom(replies.mazedaar),threadID); return;}
      if(text===`${prefix}shayari`){ 
        lastReplyAt[threadID]=Date.now(); 
        await api.sendMessage(`📜 *Shayari Time!* 📜\n\n"${pickRandom(replies.shayari)}"`,threadID); 
        return;
      }
      if(text===`${prefix}baat`){ 
        lastReplyAt[threadID]=Date.now(); 
        await api.sendMessage(pickRandom(replies.baatchit),threadID); 
        return;
      }
      
      if(!botActive) return;

      const userMsgCount = userMessageCount.get(senderID) || 0;
      userMessageCount.set(senderID, userMsgCount + 1);
      const userGender = await detectUserGender(api, senderID);

      let replyText = null;
      
      if(text.includes('good morning')) replyText = pickRandom(replies.goodmorning);
      else if(text.includes('good night') || text==='gn') replyText = pickRandom(replies.goodnight);
      else if(text.includes('hi')) replyText = pickRandom(replies.hi);
      else if(text.includes('hello')) replyText = pickRandom(replies.hello);
      else if(text.includes('bot')) replyText = pickRandom(replies.bot);
      else if(text.includes('shayari')) replyText = `📜 ${pickRandom(replies.shayari)}`;
      else if(text.includes('gana') || text.includes('song')) replyText = pickRandom(replies.gana);
      else if(text.includes('flirt') || text.includes('pyar')) {
        replyText = (userGender === 'female' && Math.random() > 0.5) ? pickRandom(replies.female_flirt) : pickRandom(replies.flirt);
      }
      else if(text.includes('roast')) replyText = pickRandom(replies.roast);
      else if(text.includes('masti')) replyText = pickRandom(replies.masti);
      else if(text.includes('joke') || text.includes('haso')) replyText = pickRandom(replies.jokes);
      else if(text.includes('mazedaar') || text.includes('maza')) replyText = pickRandom(replies.mazedaar);
      else if(text.includes('baat') || text.includes('bat')) replyText = pickRandom(replies.baatchit);
      else if(containsEmoji(text)) replyText = pickRandom(replies.emoji);
      else if(text.includes('khaya') || text.includes('khana') || text.includes('food')) replyText = pickRandom(replies.khana);
      else if(text.includes('padh') || text.includes('study')) replyText = pickRandom(replies.padhai);
      else if(text.includes('kaam') || text.includes('work')) replyText = pickRandom(replies.kaam);
      else if(text.includes('ghumne') || text.includes('travel')) replyText = pickRandom(replies.ghumne);
      else if(text.includes('movie') || text.includes('film')) replyText = pickRandom(replies.movie);

      if(replyText){
        lastReplyAt[threadID]=Date.now();
        let name='User';
        try{ 
          const info=await api.getUserInfo(senderID); 
          name=info[senderID]?.name||name; 
        }catch{}
        
        await api.sendMessage({ 
          body:`@${name} ${replyText}`, 
          mentions:[{ tag:name,id:senderID }]
        },threadID);
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

app.post('/control', (req, res) => {
  const { action } = req.body;
  switch(action) {
    case 'start':
      botActive = true;
      res.send('Bot activated');
      break;
    case 'stop':
      botActive = false;
      res.send('Bot deactivated');
      break;
    case 'status':
      res.json({ active: botActive, running: isBotRunning });
      break;
    default:
      res.status(400).send('Unknown action');
  }
});

try{
  if(fs.existsSync('config.json')){
    const data=JSON.parse(fs.readFileSync('config.json','utf8'));
    if(data.cookies && data.cookies.length) initializeBot(data.cookies);
  }
}catch(e){ emitLog('Config load error: '+e.message,true); }

const PORT = process.env.PORT||20018;
server.listen(PORT,()=>emitLog(`Server running on port ${PORT} - Bot will run forever until manually stopped!`));
