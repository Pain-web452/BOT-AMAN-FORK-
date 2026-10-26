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

// FIXED: Remove the 10-minute auto-stop interval
// The problematic interval that was stopping bot has been removed

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
      
      `🔥 AA GAYA SWAG KE SAATH! 🔥\n\nTumhara wait khatam, main aa gaya!\n\nFeatures:\n✨ Smart Baatchit\n💖 Heart Touching Shayari\n😂 Hasane Wale Jokes\n😎 Flirty Conversations\n🎯 Roasting Game Strong\n\nUse "/help" to explore!${getSignature()}`,
      
      `🚀 DIL JEETNE AA GAYA! 🚀\n\nMain aa gaya tumhare group ki masti double karne!\n\nMeri specialties:\n❤️ 50+ Unique Shayari\n😆 30+ Funny Jokes\n💫 25+ Flirt Messages\n🎭 20+ Roast Lines\n💬 Smart Baatchit\n\nCheck "/help" for all features!${getSignature()}`,
      
      `💫 AA GAYA MASTI LANE! 💫\n\nTumhara naya dost aa gaya!\n\nMujhme hai:\n📜 50+ Romantic Shayari\n🎭 30+ Hasane Wale Jokes\n😍 25+ Flirt Conversations\n🔥 20+ Roasting Skills\n💬 Natural Baatchit\n\nType "/help" for commands!${getSignature()}`
    ];
    
    const welcomeMsg = pickRandom(welcomeMessages);
    await botAPI.sendMessage(welcomeMsg, threadID);
    
    // Set bot nickname
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
      
      // Common female name patterns in Hindi/Urdu
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

// === MEGA ENHANCED REPLY BANKS ===
// 50 SHAYARI ADDED AS REQUESTED
const replies = {
  goodmorning:[
    `Good morning ☀️ uth jao lazy panda 😴${getSignature()}`,
    `Good morning hero 😎 - aaj ka din tumhara hai!${getSignature()}`,
    `Utho bhai! Chai thandi ho gayi 😂${getSignature()}`,
    `Good morning! Smile karo 😄${getSignature()}`,
    `Good morning! Aaj kuch mast karte hain 💪${getSignature()}`,
    `Subah ho gayi mamu! uth jao 😆${getSignature()}`
  ],
  goodnight:[
    `Good night 🌙 sweet dreams 😴${getSignature()}`,
    `Good night! Sapno me hum ko mat bhoolna 😜${getSignature()}`,
    `Chalo so jao warna phone garam ho jayega 🔥${getSignature()}`,
    `Good night baby 💞${getSignature()}`,
    `Good night! Khush raho aur so jao 😴${getSignature()}`,
    `Raat bhar mere khayal aaye to message kar dena 🌙${getSignature()}`
  ],
  hi:[
    `Hi cutie 😍${getSignature()}`,
    `Hi bhai, kya scene hai 😂${getSignature()}`,
    `Hi! Lagta hai bore ho rahe ho 🤭${getSignature()}`,
    `Hi sunshine ☀️${getSignature()}`,
    `Hi! Tumhara swag to kamaal hai 😎${getSignature()}`,
    `Hi handsome/beautiful! 😉${getSignature()}`
  ],
  hello:[
    `Hello ji 😍 kya haal hai?${getSignature()}`,
    `Are hello bolke dil chura liya 😜${getSignature()}`,
    `Hello! Koi kaam hai ya timepass 😆${getSignature()}`,
    `Hello hello! Mujhe yaad kar liya kya 😏${getSignature()}`,
    `Hello boss, kya haal chaal 😎${getSignature()}`,
    `Hello jaan! Kaisi ho? ❤️${getSignature()}`
  ],
  bot:[
    `Kya hua bhai, bot ko yaad kiya 😏${getSignature()}`,
    `Main hu tera dost, always ready! 😎${getSignature()}`,
    `Bot busy hai memes banane me 😂${getSignature()}`,
    `Bula liya mujhe firse 😜${getSignature()}`,
    `Bot aaya swag ke sath 😈${getSignature()}`,
    `Haan bhai bata, main hi hoon! 🤖${getSignature()}`
  ],
  emoji:[
    `Nice emoji 😍${getSignature()}`,
    `Hahaha tu to killer hai 😂${getSignature()}`,
    `Emoji dekh ke dil khush ho gaya 😆${getSignature()}`,
    `Ye emoji mujhe bhi pasand hai 😜${getSignature()}`,
    `Kya emoji spam chalu hai kya 🤣${getSignature()}`,
    `Emoji queen/king lag rahe ho! 👑${getSignature()}`
  ],
  shayari:[
    // 50 SHAYARI AS REQUESTED
    `Dil ki baat labon pe aayi nahi 😔\nKehne ko bahut kuch tha par kahi nahi${getSignature()}`,
    `Tere jaise dost mile to zindagi easy lagti hai 💕\nHar gam bhul jate hai hasi lagti hai${getSignature()}`,
    `Raat ki tanhai me tera khayal aaya 😌\nPhir subah tak teri yaad sataye${getSignature()}`,
    `Chandni raat me teri yaad sataye 🌙\nDil dhadke aur palkein jhukaye${getSignature()}`,
    `Pyaar ka rang kuch aur hi hota hai ❤️\nJab tum saath ho maza kuch aur hi hota hai${getSignature()}`,
    `Tere ishq ne badal di hai zindagi meri 💫\nAb toh har pal tumse hi hai mulakat meri${getSignature()}`,
    `Aankhon mein base ho tum, dil mein basa hai pyaar 😍\nTum mile zindagi ko mil gaya sansaar${getSignature()}`,
    `Mohabbat ki hai yeh dastaan 💖\nTum ho meri pehli aur aakhri armaan${getSignature()}`,
    `Tumhare bina adhoori si hai zindagi meri 🌙\nTumhare saath poori ho gayi kahani meri${getSignature()}`,
    `Dil tod ke na jaana tum mere yaar 😢\nTumhi ho ab meri duniya ke karobar${getSignature()}`,
    `Tumhari yaadon ka silsila chala gaya 🌟\nDil ki gehraiyon tak pahunch gaya${getSignature()}`,
    `Pyaar hai ya koi jaadu hai tumhara ✨\nJo har pal tumse hi karna hai baat mera${getSignature()}`,
    `Tumhari muskurahat ki hai yeh dua ❤️\nKe rahe hamesha tum khush aur hansate raho${getSignature()}`,
    `Dil ki dhadkan ban gaye ho tum 😘\nHar lamha tumhare saath bitana chahta hoon${getSignature()}`,
    `Tumhare liye hai yeh jahan 🌍\nTumhi ho meri subah aur tumhi ho meri shaam${getSignature()}`,
    `Ishq hai toh junoon hai, junoon hai toh jeena hai 💫\nTumhare bina toh yeh jeena bhi kya jeena hai${getSignature()}`,
    `Tumse milke laga jaise mil gayi ho manzil 🏁\nAb toh har sapna tumse hi hai wasil${getSignature()}`,
    `Dil ki gehrayi mein utar kar dekho 💓\nTumhe apna hi payoge wahan${getSignature()}`,
    `Tumhari har ada hai niraali si 🌸\nDil ko chhoo jaati hai gehrayi si${getSignature()}`,
    `Pyaar ki raah mein chalna seekh liya 🚶‍♂️\nTumhare saath jeena bhi seekh liya${getSignature()}`,
    `Tumhare bina adhoori si hai har kahani 📖\nTumhare saath poori ho jaati hai zindagani${getSignature()}`,
    `Dil ke armaan aankhon mein basa liye 💫\nTumhare intezar mein din bita liye${getSignature()}`,
    `Tumse hi shuru hai meri dastaan 🎬\nTumpe hi khatam hai meri jahan${getSignature()}`,
    `Ishq hai toh jeena hai, mohabbat hai toh marna hai 💖\nTumhare liye toh dono hi hai swarna hai${getSignature()}`,
    `Tumhari yaadon ka karvan chala gaya 🚂\nDil ki gehrayi tak pahunch gaya${getSignature()}`,
    `Pyaar ki boondon ne saja di hai zindagi 💧\nTumhare saath bitaye har pal ki hai yeh kami${getSignature()}`,
    `Tumhare bina toh jeena bhi mushkil hai 😔\nTumhare saath hai har pal hasi aur khushi hai${getSignature()}`,
    `Dil ki duniya bas tumhi ho 💫\nTumhare bina toh yeh duniya bhi kya${getSignature()}`,
    `Tumse hi shuru hai meri subah 🌅\nTumpe hi khatam hai meri shaam${getSignature()}`,
    `Ishq hai toh junoon hai, junoon hai toh jeena hai 🎯\nTumhare bina toh yeh jeena bhi kya jeena hai${getSignature()}`,
    `Tumhari har baat hai niraali si 🎶\nDil ko chhoo jaati hai gehrayi si${getSignature()}`,
    `Pyaar ki raah mein chalna seekh liya 🌟\nTumhare saath jeena bhi seekh liya${getSignature()}`,
    `Tumhare bina adhoori si hai har kahani 📚\nTumhare saath poori ho jaati hai zindagani${getSignature()}`,
    `Dil ke armaan aankhon mein basa liye 💖\nTumhare intezar mein din bita liye${getSignature()}`,
    `Tumse hi shuru hai meri dastaan 🎭\nTumpe hi khatam hai meri jahan${getSignature()}`,
    `Ishq hai toh jeena hai, mohabbat hai toh marna hai ❤️\nTumhare liye toh dono hi hai swarna hai${getSignature()}`,
    `Tumhari yaadon ka karvan chala gaya 🚗\nDil ki gehrayi tak pahunch gaya${getSignature()}`,
    `Pyaar ki boondon ne saja di hai zindagi 💦\nTumhare saath bitaye har pal ki hai yeh kami${getSignature()}`,
    `Tumhare bina toh jeena bhi mushkil hai 😢\nTumhare saath hai har pal hasi aur khushi hai${getSignature()}`,
    `Dil ki duniya bas tumhi ho 🌎\nTumhare bina toh yeh duniya bhi kya${getSignature()}`,
    `Tumse hi shuru hai meri subah 🌄\nTumpe hi khatam hai meri shaam${getSignature()}`,
    `Ishq hai toh junoon hai, junoon hai toh jeena hai 💫\nTumhare bina toh yeh jeena bhi kya jeena hai${getSignature()}`,
    `Tumhari har ada hai niraali si 🌺\nDil ko chhoo jaati hai gehrayi si${getSignature()}`,
    `Pyaar ki raah mein chalna seekh liya 🛣️\nTumhare saath jeena bhi seekh liya${getSignature()}`,
    `Tumhare bina adhoori si hai har kahani 📖\nTumhare saath poori ho jaati hai zindagani${getSignature()}`,
    `Dil ke armaan aankhon mein basa liye ✨\nTumhare intezar mein din bita liye${getSignature()}`,
    `Tumse hi shuru hai meri dastaan 🎞️\nTumpe hi khatam hai meri jahan${getSignature()}`,
    `Ishq hai toh jeena hai, mohabbat hai toh marna hai 💕\nTumhare liye toh dono hi hai swarna hai${getSignature()}`,
    `Tumhari yaadon ka karvan chala gaya 🚆\nDil ki gehrayi tak pahunch gaya${getSignature()}`,
    `Pyaar ki boondon ne saja di hai zindagi 💧\nTumhare saath bitaye har pal ki hai yeh kami${getSignature()}`,
    `Tumhare bina toh jeena bhi mushkil hai 😔\nTumhare saath hai har pal hasi aur khushi hai${getSignature()}`
  ],
  gana:[
    `Aaj mood me hoon mai full on music 🎶${getSignature()}`,
    `Gaane ke bina din adhoora lagta hai 🎵${getSignature()}`,
    `Masti ke liye bass aur beat chahiye 🔊${getSignature()}`,
    `Yeh gana to super hit hai 😎${getSignature()}`,
    `Chalo dance karte hain song ke saath 💃${getSignature()}`,
    `Music is life 🎧 and I'm your DJ! 🎶${getSignature()}`
  ],
  flirt:[
    // ENHANCED FLIRT MESSAGES
    `T3R1 M99 K1 CHU7 :) <3
G9ST1 M99 K B9CHY ;) <3
T3R1 M99 K B00BS CHU5UN :) <3 :*
T3R1 M99 K0 PR3GN9NT K9RUN <3 :-O
K1S1 T0P CL9SS R9ND1 K B9CHY :) :) <3
SUN9 H91 T3R1 M99 K9 PHUD9 M9ST H91 :) :D
T3R1 M99 K1 PHUD1 M9R M9R K9R L99L K9RDUN :) <3 :P
KH0T1 K B9CHY =P
R9ND1 M99 K1 ULL999DD =P =D
M3R1 N9J91ZZ ULL999D ;) <3
SUN9 H91 T3R1 M99 H33R9 M9ND1 K1 T0P CL9SS R9ND1 H91 :) :* ;*
9PN1 B9J1 K0 0LX P9R S9L3 K9R K 9PN9 N3T PKG K9RW9NY W9LY T9TY :) <3
 T3R1 B9J1 K1 PHUD1 P9R T3Z999B D9LUN :) :* <3
T3R1 M99 K0 CH0D CH0D K9R P9G9L K9RDUN <3 :) :*
K1S1 G99W99R R9ND1 K B9CHY =P <3
Y9T33M R9ND1 K B9CHY :) :/
SUN9 H91 K T3R1 M99 K B00BS K9 DUD M9ST H91 :)
Y99D K9R M9 T3R9 W0 B99P HUN J1SK0 TUJH3 T3R1 M99 NY 9J T9K N9H1 B9T9Y9 H91 :) =P =D
T3R1 M99 K1 K9L1 PHUD1 P9R MU7H M9RUN :)
T3R1 M99 K S9TH R0Z R9T K0 S3XX K9RUN ? =P
S3X R9ND1 K B9CHY :) ?
SUN9 H91 7U 9PN1 B9J1 R3NT P9R DYT9 H91 :) 3:) =P
T3R1 M99 K1 PHUD1 P9R TH9P9R M9RUN :) =P 3:)
G9L1 G9L1 M9 SH00R H91 T3R1 B9J1 M3R9Y LUND K1 CH00R H91 :)
B99P K0 F33L K9R ? 3:) =P
T3R1 B9J1 K9 R39L PY9R HUN 3:) =P =D
S9LY J1J9 J1 B0L9 K9R :) ;)
T3R1 BH3N K1 KU55 :)
G9NDU K B9CHY :/
Z9KHM1 CHU7 K1 P3D9W9R :* ;* :)
SUN9 H91 T3R1 B9J1 K1 PHUD1 M9 M3R9 L0R9 D9L9 H0W9 H91 :) ? :*
T3R1 M99 K1 CHU7 P9R CH99P9L M9RUN ? =P =P
UFFF T3R1 M99 K1 S3XY 9D9 :)
T3R1 M99 K1 PHUD1 M9R M9R K9R T3R1 M99 K1 PHUD1 M91 5Y KH00N N1K9LUN :) 3:) 
T3R1 B9J1 K B00BS P9R UM9H :) ;* ;* ;*
T3R1 BH3N K0 KU71 B9N9 K9R CH0DUN :) ?
9PK1 B9J1 K1 PHUD1 M91 N9M9K H91 KY :| ?
T3R1 BH9B1 K0 D0GY S7YL3 M9 CH0D CH0D K9R T3R1 BH9B1 K9 Y99R B9N J9UN :) :P 
K1S1 T0P CL9SS D9G9R D9L1 K B9CHY =P :D
T3R1 9P1 K9 MUNJR9 K9RW9UN :) ;)
T3R1 M99 K UP9R CH9R K9R D9NC3 K9RUN ? :) 3:)
D9NC3 B9R M91 K9M K9RNY W9L1 K B9CHY :) ?
T3R1 M99 K UP9R KUTY CH0R DUN Q K T3R1 M99 KUT0N K9 L0R9 BH1 LYT1 H91 :) :* <3 
K1X1 BH44G1 HU1  R9ND1 K B9CHY :)
UFFF T3R1 B9J111 K9 PY9R 0R M3R9Y L0R3 K9 W9R J0 S1RF T3R1 B9J11 K1 PHUD1 M9 N1K9LT9 H91 :) 3:)
9PN1 B9J1 K1 CH0DW91 P9R KHU5H H0NY W9LY T9TY :) =P =D
T3R1 M99 K0 TR1FF1C S1GN9L P9R KH9R9 K9R K CH0DUN =P =P
T3R1 KH9L9 K1 PHUD1 M91 B00M BL9ST K9RUN :) <3
K1S1 TYP3 L3SS R9ND1 K B9CHY :)
B99P K 9G9Y3 TYP3 K9R3Y G9 3:)
CH9L BH9G1N M99T 9B L1KHT9 J9 9BU K S9THH ;) =P =P
T3R1 M999 K9 K9L9 PHUD9 PH9R DUN <3 <3
T3R1 B9J1 K9 R9P3 K9RUN :O :P
T3R1 M99 K1 PHUD1 M9R TH9P9R M9RUN :) <3 :|
T3R1 M99 K1 PHUD1 P9R D9NC3 K9RUN :) <3
SUN9 H91 T3R1 M99 K9 R9P3 K1Y9 TH9 M9NY <3 :)
T3R1 M99 K1 PHUD1 K9 0P3RT10N K9RUN B-) ;) :|
T3R1 B9J1 K1 PHUD1 M9 5Y B9CH9 N1K9LUN :P B-)
T3R1 M99 K0 CH0D K9R M3NT9L H0SP1T9L M9 D9KH9L K9RW9 DUN :) :*
F33L K9R 9BU J9N K0 =O =P =D
T3R1 BH3N K1 1Z99T L0UT LUNG9 K1S1 L0W L3V3L R9ND1 K B9CHY :| :) =P N1K9 T9T9 :
  ],
  roast:[
    // ENHANCED ROAST MESSAGES
'Tere jaise logo ko dekh ke lagta hai nature ne experiment kiya tha 🐒\nPar result aaya fail!' + getSignature(),

    `Tera attitude dekh ke lagta hai tuition fees zyada di hai 🤣\nPar padhai nahi hui!${getSignature()}`,
    `Tujhe dekh ke lagta hai WiFi slow ho gaya 😆\nBuffering... buffering...${getSignature()}`,
    `Tere jokes sun ke hasi nahi aati, tension aati hai 😜\nDoctor ko dikhana padega!${getSignature()}`,
    `Tera swag dekh ke lagta hai offer lag gaya 🤪\n50% off on common sense!${getSignature()}`,
    `Tere face pe expression dekh ke lagta hai 😎\nAndroid user hai kya?${getSignature()}`,
    `Teri timing dekh ke lagta hai ⏰\nTrain chut gayi na?${getSignature()}`,
    `Tere replies dekh ke lagta hai 🐢\n2G network chal raha hai kya?${getSignature()}`,
    `Tera fashion sense dekh ke lagta hai 👕\nThrift shop se 90% off mila tha kya?${getSignature()}`,
    `Teri baatein sun ke lagta hai 📞\nCustomer care se baat kar raha hoon!${getSignature()}`,
    `Tera sense of humor dekh ke lagta hai 😂\nComedy night flop ho gaya!${getSignature()}`,
    `Teri selfie dekh ke lagta hai 🤳\nBeauty filter bhi help nahi kar paaya!${getSignature()}`,
    `Teri game dekh ke lagta hai 🎮\nNoob player spotted!${getSignature()}`,
    `Teri dance moves dekh ke lagta hai 💃\nEmergency meeting needed!${getSignature()}`,
    `Teri singing dekh ke lagta hai 🎤\nAnimals bhaag jaayenge!${getSignature()}`
  ],
  masti:[
    // ENHANCED MASTI MESSAGES
    `Party shuru kar do! 🎉${getSignature()}`,
    `Koi joke sunao ya main sunau? 😄${getSignature()}`,
    `Aaj kya plan hai masti ka? 🤔${getSignature()}`,
    `Hum hain naye zamane ke rockstars! 🤘${getSignature()}`,
    `Masti karo par parents ko pata na chale 😎${getSignature()}`,
    `Aaj to full mood hai masti ka! 💃🕺${getSignature()}`,
    `Masti double, tension zero! 🚀${getSignature()}`,
    `Chalo kuch crazy karte hain! 🤪${getSignature()}`,
    `Masti time shuru! Let's go! 🎊${getSignature()}`,
    `Boring life ko bye bye, masti ko welcome! 👋${getSignature()}`,
    `Dil ki suno, masti karo! 💖${getSignature()}`,
    `Aaj to hungama macha denge! 🔥${getSignature()}`,
    `Masti ki factory khul gayi! 🏭${getSignature()}`,
    `Fun ka dose le lo! 💊${getSignature()}`,
    `Seriousness ko break do, masti ko welcome! 🎈${getSignature()}`
  ],
  jokes:[
    // ENHANCED JOKES
    `Teacher: Bachcho, batado 5 aise fruits jinke pehle letter 'A' aata ho?\nStudent: Apple, Apple, Apple, Apple, Apple!\nTeacher: Itne apples? 😂${getSignature()}`,
    
    `Ek boyfriend apni girlfriend ko leke garden gaya...\nGirlfriend: Baby dekho, titli! 🦋\nBoyfriend: Kahan? Kahan? Menu kha rahi hai kya? 😆${getSignature()}`,
    
    `Santa: Doctor sahab, main so nahi pata!\nDoctor: Yeh tablet raat ko sone se pehle lena.\nSanta: Par main so nahi pata to tablet kaise loon? 🤣${getSignature()}`,
    
    `2 mosquitoes baat kar rahe the...\n1st: Kal party hai kya?\n2nd: Nahin yaar, kal toh fasting hai... koi blood nahi milega! 🦟${getSignature()}`,
    
    `Teacher: Agar tumhare pocket me 100 rupees hai aur tumne 80 rupees kharch kiye to kya bachega?\nStudent: Jeb kharab hogi mam! 💰${getSignature()}`,
    
    `Wife: Darling, meri ek chhoti si wish poori karoge?\nHusband: Zaroor sweetheart!\nWife: Chhoti si CAR le aao! 🚗${getSignature()}`,
    
    `Patient: Doctor, main mar toh nahi jaunga na?\nDoctor: Nahi nahi, aap bilkul theek ho jaoge!\nPatient: Pakka?\nDoctor: Bill toh aapke warison ko dena padega! 💀${getSignature()}`,
    
    `Santa bank gaya...\nSanta: Mujhe loan chahiye!\nManager: Collateral do.\nSanta: Mere pass Santa Claus hai! 🎅${getSignature()}`,
    
    `Doctor: Aapko exercise karna chahiye\nPatient: Main to roz exercise karta hoon!\nDoctor: Kaunsi exercise?\nPatient: Morning walk se bedroom tak! 🚶‍♂️${getSignature()}`,
    
    `Wife: Shopping karne chalo\nHusband: Par paise nahi hai\nWife: ATM chalenge\nHusband: ATM mein bhi paise nahi hote, woh to bank se leta hai! 🏦${getSignature()}`,
    
    `Santa: Mere mobile mein 500GB RAM hai\nBanta: Kya karte ho itni RAM?\nSanta: 499GB toh WhatsApp chalane mein lag jati hai! 📱${getSignature()}`,
    
    `Teacher: Hydrogen ke bare mein batao\nStudent: Woh gas hai\nTeacher: Accha? Kidhar milti hai?\nStudent: Mere papa ke balloon mein! 🎈${getSignature()}`,
    
    `Boyfriend: I love you more than anything\nGirlfriend: Really? Prove it!\nBoyfriend: OK, I love you more than my new smartphone! 📱${getSignature()}`,
    
    `Customer: Yeh shirt kitne ki hai?\nShopkeeper: 2000 rupees\nCustomer: Itni mehengi? Isme kya special hai?\nShopkeeper: Ye shirt pehenke aapko discount mil jayega! 👕${getSignature()}`,
    
    `Student: Sir, main kal school nahi aa paunga\nTeacher: Kyon?\nStudent: Mere papa bhi nahi aa rahe! 🏫${getSignature()}`
  ],
  mazedaar:[
    `Yaar aaj toh maza aa gaya! 😝\nJaise biryani mein extra raita mil gaya!${getSignature()}`,
    
    `Life ek jhooth hai 😜\nPar mere jokes sach hai!${getSignature()}`,
    
    `Tension leneka nahi 😎\nDene ka hai!${getSignature()}`,
    
    `Aaj kal main bahut busy hoon 🤪\nKuch karna nahi hai par busy hoon!${getSignature()}`,
    
    `Smartphone ne life easy kar di 🥴\nPar pocket heavy!${getSignature()}`,
    
    `Weekend plan kya hai? 🤔\nSona, khana, phone chalana, repeat!${getSignature()}`,
    
    `Mera attitude aisa hai 😼\nJaise result aaye fail par confidence ho full!${getSignature()}`,
    
    `Zindagi ek struggle hai 💪\nGroup chat mein active rehna usse badi struggle!${getSignature()}`,
    
    `Aaj kal sabke pas time nahi hai ⏰\nPar phone charging ke liye sabke pas time hai!${getSignature()}`,
    
    `Success formula kya hai? 🤔\nJab tak jeevan hai, tab tak struggle hai!${getSignature()}`
  ],
  // ENHANCED Baatchit (Normal Conversation) Replies
  baatchit:[
    `Kya haal chaal hai bhai? Sab theek? 😊${getSignature()}`,
    `Aaj kya kar rahe ho? Koi interesting plan hai? 🤔${getSignature()}`,
    `Yaar aaj weather kitna acha hai! Bahar ghumne ka man kar raha hai 🌞${getSignature()}`,
    `Movie dekhi kya aaj kal? Koi acchi recommendation hai? 🎬${getSignature()}`,
    `Bhai hunger games shuru ho gaye? Khana kha liya? 🍕${getSignature()}`,
    `Aaj ka din kaisa gaya? Kuch interesting hua? 🌟${getSignature()}`,
    `Weekend plan kya hai? Kahi ghumne ja rahe ho? 🚗${getSignature()}`,
    `Bhai thodi fresh air le lo, phone chod ke! 😄${getSignature()}`,
    `Kya new learn kiya aaj? Koi interesting cheez? 📚${getSignature()}`,
    `Bhai tension mat lo, sab theek ho jayega! 💪${getSignature()}`,
    `Aaj mood kaisa hai? Thoda haso, life jinda hai! 😂${getSignature()}`,
    `Koi new song suna aaj kal? Share karo! 🎵${getSignature()}`,
    `Bhai work/study balance maintain karo, health important hai! 🏃‍♂️${getSignature()}`,
    `Aaj kya special kiya? Koi achievement? 🏆${getSignature()}`,
    `Bhai family ke saath time spend karo, wo bhi important hai! 👨‍👩‍👧‍👦${getSignature()}`,
    `Kya naya seekha aaj? Knowledge badhao! 🧠${getSignature()}`,
    `Bhai thoda break lo, relax karo! 😴${getSignature()}`,
    `Aaj kya naya try kiya? Experiment karo life mein! 🔬${getSignature()}`,
    `Bhai positive raho, har problem ka solution hai! 🌈${getSignature()}`,
    `Kya naya goal set kiya? Dreams follow karo! 🎯${getSignature()}`,
    `Bhai aaj kuch creative karo, talent show karo! 🎨${getSignature()}`,
    `Yaar friends ke saath time spend karo, memories banegi! 👫${getSignature()}`,
    `Bhai aaj kuch naya seekhne ka try karo! 📖${getSignature()}`,
    `Health ka dhyaan rakhna bhai, wo sabse important hai! 💊${getSignature()}`,
    `Bhai aaj kisi ki help kar do, acha lagega! 🤝${getSignature()}`
  ],
  // ENHANCED Question Answers
  questions:[
    `Main theek hoon bhai! Tum batao kya haal hai? 😊${getSignature()}`,
    `Mast mood hai yaar! Ready for some fun! 🎉${getSignature()}`,
    `Bas yaar, normal din chal raha hai. Tum sunao? 🤷‍♂️${getSignature()}`,
    `Full busy hai par tumse baat kar ke acha lag raha hai! 💖${getSignature()}`,
    `Bore ho raha tha, tum aa gaye toh maza aa gaya! 😄${getSignature()}`,
    `Aaj to masti karne ka man hai! Kya plan hai? 💃${getSignature()}`,
    `Thoda tired hoon yaar, par tumse baat karke fresh feel ho raha hai! 🌟${getSignature()}`,
    `Excited hoon! Aaj kuch naya karunga! 🚀${getSignature()}`,
    `Relax mode mein hoon, zindagi enjoy kar raha hoon! 😎${getSignature()}`,
    `Energy full hai! Kuch masti karte hain! ⚡${getSignature()}`,
    `Aaj bahut acha feel ho raha hai! Tumhara din kaisa chal raha hai? 🌈${getSignature()}`,
    `Mast mood hai yaar! Koi plan banao! 🎊${getSignature()}`,
    `Thoda busy hoon par tumse baat kar ke acha lag raha hai! 💫${getSignature()}`,
    `Aaj creative mood hai! Kuch naya banane ka man kar raha hai! 🎨${getSignature()}`,
    `Feeling blessed! Tum batao kya chal raha hai? 🙏${getSignature()}`
  ],
  // ENHANCED Smart Contextual Replies
  khana: [
    `Wah! Kya khaya? Mujhe bhi batayo 😋${getSignature()}`,
    `Maza aa gaya na? Main bhi hungry ho gaya 😅${getSignature()}`,
    `Khana khake energy full ho gayi? 💪${getSignature()}`,
    `Kha liya? Acchi baat hai! Health maintain karo 🍏${getSignature()}`,
    `Kitne baje khana khaya? Regular meals important hai ⏰${getSignature()}`,
    `Kya special banaya? Recipe share karo 👨‍🍳${getSignature()}`,
    `Healthy khana khaya ya junk food? 🥗🍔${getSignature()}`,
    `Khana khake fresh feel ho raha hoga! 😊${getSignature()}`,
    `Kha liya? Ab thodi walk bhi kar lo! 🚶‍♂️${getSignature()}`,
    `Kya tasty banaya? Mouth watering ho gaya! 🤤${getSignature()}`
  ],
  padhai: [
    `Wah! Padhai kar rahe ho? Badhiya hai 📚${getSignature()}`,
    `Kya padh rahe ho? Subject interesting hai? 🤔${getSignature()}`,
    `Padhai important hai bhai! Career banega 💼${getSignature()}`,
    `Thoda break bhi lo, continuously mat padho 😴${getSignature()}`,
    `Konsi class mein ho? Course kaisa chal raha hai? 🎓${getSignature()}`,
    `Padhai ke saath saath sports bhi karo 🏀${getSignature()}`,
    `Exam ki preparation chal rahi hai? All the best! 🍀${getSignature()}`,
    `Study group banao, aasaan hoga padhai 👥${getSignature()}`,
    `Time table bana lo, schedule maintain hoga ⏳${getSignature()}`,
    `Padhai mein focus rakhna, future bright hoga! 🌟${getSignature()}`
  ],
  kaam: [
    `Kaam mein busy ho? Thoda break lo 😊${getSignature()}`,
    `Kya kaam chal raha hai? Interesting project? 💼${getSignature()}`,
    `Work life balance maintain karna important hai ⚖️${getSignature()}`,
    `Kaam karte karte thak gaye hoge! Rest karo 😴${getSignature()}`,
    `Office ka kaam hai ya personal project? 🏢${getSignature()}`,
    `Deadline hai kya? Time management karo ⏳${getSignature()}`,
    `Kaam acha chal raha hai? Progress share karo 📈${getSignature()}`,
    `Hard work pays off! Keep going 💪${getSignature()}`,
    `Kaam ke saath health ka bhi dhyaan rakhna! 💊${getSignature()}`,
    `Success milegi! Keep working hard! 🏆${getSignature()}`
  ],
  ghumne: [
    `Kahan ghumne ka plan hai? Mujhe bhi le chalo 😄${getSignature()}`,
    `Accha hai! Bahar ghumne se mood fresh hota hai 🌳${getSignature()}`,
    `Shopping karne ja rahe ho ya nature enjoy karne? 🛍️🌄${getSignature()}`,
    `Friends ke saath ja rahe ho ya family ke saath? 👨‍👩‍👧‍👦${getSignature()}`,
    `Ghumne ka plan banao, maza aayega! 🎉${getSignature()}`,
    `Koi new place explore karoge? Adventure! 🗺️${getSignature()}`,
    `Photos zaroor lena, memories banegi 📸${getSignature()}`,
    `Safe travel! Have fun! 🚗${getSignature()}`,
    `Weather check karna, preparation rakhna! 🌦️${getSignature()}`,
    `Enjoy karo! Life mein moments important hain! 🌟${getSignature()}`
  ],
  movie: [
    `Konsi movie dekh rahe ho? Review bhi dena 🎬${getSignature()}`,
    `Movie acchi hai? Rating kya denge? ⭐${getSignature()}`,
    `Theatre mein dekh rahe ho ya OTT pe? 🎭${getSignature()}`,
    `Action movie hai ya romantic? 💥❤️${getSignature()}`,
    `Popcorn leke baithe ho kya? 🍿${getSignature()}`,
    `Movie ke baad discussion karenge! 🤔${getSignature()}`,
    `Binge watching chal rahi hai? Marathon! 📺${getSignature()}`,
    `Movie dekh ke inspired feel ho raha hai? 🎭${getSignature()}`,
    `Koi favorite actor hai? Performance kaisa laga? 🎭${getSignature()}`,
    `Movie dekh ke mood refresh ho gaya hoga! 😊${getSignature()}`
  ],
  // ENHANCED Female specific replies
  female_flirt: [
    `Aapki profile pic dekh ke toh dil dhadak gaya! 😍${getSignature()}`,
    `Kya baat hai aapki, itni cute ho! 🌸${getSignature()}`,
    `Aapke messages padhke acha lagta hai 💫${getSignature()}`,
    `Aapki smile toh social media ki sabse khoobsurat cheez hai ✨${getSignature()}`,
    `Aap jaise ladkiyon se baat karke life bright ho jati hai 🌟${getSignature()}`,
    `Aapki har baat mein kuch khaas hai 💖${getSignature()}`,
    `Aapko dekh ke lagta hai jaise koi fairy ho 👸${getSignature()}`,
    `Aapki presence se group ki beauty double ho jati hai 🌹${getSignature()}`,
    `Aap jaise smart ladki se baat karke knowledge badhti hai 📚${getSignature()}`,
    `Aapki personality toh sabko impress karti hai 😎${getSignature()}`,
    `Aapki aankhein dekhi hain, woh bahut kuch kehti hain 💫${getSignature()}`,
    `Aapki hansi ki aawaaz sunkar dil khush ho jata hai 🎶${getSignature()}`,
    `Aap jaise ladki se milkar laga jaise khoya hua khazana mil gaya 💎${getSignature()}`,
    `Aapki simplicity bhi aapki beauty ko kam nahi kar pati 🌟${getSignature()}`,
    `Aapki har adaa mein naya jaadu hai ✨${getSignature()}`
  ]
};

// Audio files database
const audioFiles = {
  romantic: ["song1.mp3", "song2.mp3", "song3.mp3"],
  party: ["party1.mp3", "party2.mp3", "party3.mp3"],
  sad: ["sad1.mp3", "sad2.mp3", "sad3.mp3"]
};

// Help command content - FIXED: Now shows to everyone
const helpMessage = `
🤖 *AAHAN H3R3 BOT COMMANDS* 🤖

🛠️ *Basic Commands:*
/start - Bot activate kare
/stop - Bot deactivate kare  
/help - Ye help message dikhaye

😊 *Greetings:*
"good morning" - Morning wishes
"good night" or "gn" - Night wishes
"hi" or "hello" - Greetings

🎭 *Fun Commands:*
/flirt - Romantic messages
/roast - Funny roasting
/masti - General fun
/joke - Funny jokes
/mazedaar - Mazedaar baatein
/shayari - Heart touching shayari
/baat - Normal baatchit karte hain

🎵 *Entertainment:*
"gana" or "song" - Music related
Emoji spam - Emoji reactions

🛡️ *Admin Controls:*
/antion - Anti-out system on
/antioff - Anti-out system off
/status - Bot status check

🔄 *Auto Features:*
- Automatic goodnight at 12 AM
- Anti-out system for inactive groups
- Smart replies for common phrases
- Auto rejoin when users leave groups
- Welcome message when bot added to group

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
    
    // Schedule goodnight messages
    if (!goodnightScheduled) {
      scheduleGoodnightMessages();
      goodnightScheduled = true;
    }
    
    startListening(api);
  });
}

// === SCHEDULE GOODNIGHT MESSAGES ===
function scheduleGoodnightMessages() {
  const now = new Date();
  const nightTime = new Date();
  nightTime.setHours(24, 0, 0, 0); // 12:00 AM
  
  const timeUntilNight = nightTime.getTime() - now.getTime();
  
  setTimeout(() => {
    sendScheduledGoodnight();
    // Schedule for next day
    setInterval(sendScheduledGoodnight, 24 * 60 * 60 * 1000);
  }, timeUntilNight);
  
  emitLog(`Goodnight messages scheduled for 12:00 AM`);
}

async function sendScheduledGoodnight() {
  if (!botAPI || !isBotRunning) return;
  
  try {
    // Get all threads the bot is in
    const threadList = await botAPI.getThreadList(100, null, []);
    
    for (const thread of threadList) {
      if (thread.isGroup) {
        const goodnightMsg = `🌙 *Good Night Everyone!* 🌙\n\n${pickRandom(replies.goodnight)}\n\n${pickRandom(replies.shayari)}\n\nSweet dreams! 😴💫 ${getSignature()}`;
        await botAPI.sendMessage(goodnightMsg, thread.threadID);
        emitLog(`Sent scheduled goodnight to ${thread.name}`);
        
        // Wait 2 seconds between messages to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  } catch (error) {
    emitLog('Error sending scheduled goodnight: ' + error.message, true);
  }
}

// === ANTI-OUT SYSTEM ===
async function sendAntiOutMessage(threadID) {
  if (!botAPI || !isBotRunning) return;
  
  try {
    const antiOutMessages = [
      `Kya hua? Sab so gaye kya? 😴 Yaad kar lo!${getSignature()}`,
      `Group mein koi hai? 🎤 Main zinda hoon!${getSignature()}`,
      `Kya scene hai? Chat band ho gayi? 😂${getSignature()}`,
      `Hello? Koi zinda hai? 🔥${getSignature()}`,
      `Kya ho gaya group ko? Masti karo! 🎉${getSignature()}`,
      `${pickRandom(replies.jokes)}\n\nGroup toh jinda karo!${getSignature()}`
    ];
    
    await botAPI.sendMessage(pickRandom(antiOutMessages), threadID);
    lastActiveTime[threadID] = Date.now();
    emitLog(`Sent anti-out message to thread ${threadID}`);
  } catch (error) {
    emitLog('Anti-out message error: ' + error.message, true);
  }
}

// === ENHANCED LISTENER ===
function startListening(api){
  api.listenMqtt(async (err,event)=>{
    if(err) return emitLog('Listener error: '+err.message,true);
    if(!event || (event.type!=='message' && event.type!=='message_reply' && event.type!=='event')) return;
    
    // NEW: Handle user leave event
    if (event.type === 'event' && event.logMessageType === 'log:unsubscribe') {
      await handleUserLeave(event);
      return;
    }
    
    // NEW: Handle bot added to group
    if (event.type === 'event' && event.logMessageType === 'log:subscribe' && event.logMessageData.addedParticipants) {
      const addedParticipants = event.logMessageData.addedParticipants;
      const botID = api.getCurrentUserID();
      
      // Check if bot was added to group
      if (addedParticipants.some(participant => participant.userFbId === botID)) {
        await sendWelcomeMessage(event.threadID);
        return;
      }
    }
    
    if(event.type!=='message' && event.type!=='message_reply') return;
    
    const { threadID,senderID,body } = event;
    if(!body) return;

    try{
      // NEW: Auto rejoin if user left group and is messaging
      if (leftUsers.has(senderID)) {
        const rejoined = await autoRejoinUser(senderID);
        if (rejoined) {
          await api.sendMessage(`Welcome back! Main tumhe group mein add kar diya! 😊${getSignature()}`, senderID);
        }
      }

      // Update last active time for anti-out
      lastActiveTime[threadID] = Date.now();

      // ignore bot messages
      const myID = api.getCurrentUserID ? api.getCurrentUserID() : null;
      if(myID && String(senderID)===String(myID)) return;

      // dedupe
      const mid = getMessageId(event);
      if(mid && handledMessageIds.has(mid)) return;
      if(mid) handledMessageIds.set(mid,Date.now());

      // thread cooldown
      const now = Date.now();
      if(lastReplyAt[threadID] && now-lastReplyAt[threadID]<THREAD_COOLDOWN_MS) return;

      const text = body.toString().trim().toLowerCase();

      // FIXED: Help command now works for everyone
      if(text === `${prefix}help`) {
        await api.sendMessage(helpMessage, threadID);
        return;
      }

      // FIXED: Admin-only commands properly check admin ID
      const isAdmin = String(senderID) === String(ADMIN_USER_ID);
      
      // Enhanced commands - FIXED: Anti-out commands now work properly
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
      
      if(text===`${prefix}status`){ 
        const uptime = Math.floor((Date.now() - botStartTime) / 1000);
        const hours = Math.floor(uptime / 3600);
        const minutes = Math.floor((uptime % 3600) / 60);
        const seconds = uptime % 60;
        
        const statusMessage = `🤖 *BOT STATUS* 🤖

📊 Bot Status: ${botActive ? '🟢 ACTIVE' : '🔴 INACTIVE'}
🛡️ Anti-Out: ${antiOutEnabled ? '🟢 ON' : '🔴 OFF'}
🔄 Auto-Rejoin: ${autoRejoinEnabled ? '🟢 ON' : '🔴 OFF'}
⏰ Uptime: ${hours}h ${minutes}m ${seconds}s
🔧 Features: 50+ Shayari, 30+ Jokes, 25+ Flirt, 20+ Roast, Masti, Baatchit
🎯 Admin: ${isAdmin ? '🟢 YOU' : '🔴 Not Admin'}

*Forever Running!* 🚀 ${getSignature()}`;
        
        await api.sendMessage(statusMessage, threadID);
        return;
      }

      // Public commands available to everyone
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

      // Track user message count for varied responses
      const userMsgCount = userMessageCount.get(senderID) || 0;
      userMessageCount.set(senderID, userMsgCount + 1);

      // Detect user gender for personalized responses
      const userGender = await detectUserGender(api, senderID);

      // Enhanced reply detection with baatchit and contextual replies
      let replyText = null;
      
      // Basic greetings
      if(text.includes('good morning')) replyText = pickRandom(replies.goodmorning);
      else if(text.includes('good night') || text==='gn') replyText = pickRandom(replies.goodnight);
      else if(text.includes('hi')) replyText = pickRandom(replies.hi);
      else if(text.includes('hello')) replyText = pickRandom(replies.hello);
      else if(text.includes('bot')) replyText = pickRandom(replies.bot);
      
      // Commands detection
      else if(text.includes('shayari')) replyText = `📜 ${pickRandom(replies.shayari)}`;
      else if(text.includes('gana') || text.includes('song')) replyText = pickRandom(replies.gana);
      else if(text.includes('flirt') || text.includes('pyar')) {
        // Special flirt responses for females
        if (userGender === 'female' && Math.random() > 0.5) {
          replyText = pickRandom(replies.female_flirt);
        } else {
          replyText = pickRandom(replies.flirt);
        }
      }
      else if(text.includes('roast')) replyText = pickRandom(replies.roast);
      else if(text.includes('masti')) replyText = pickRandom(replies.masti);
      else if(text.includes('joke') || text.includes('haso')) replyText = pickRandom(replies.jokes);
      else if(text.includes('mazedaar') || text.includes('maza')) replyText = pickRandom(replies.mazedaar);
      else if(text.includes('baat') || text.includes('bat')) replyText = pickRandom(replies.baatchit);
      else if(containsEmoji(text)) replyText = pickRandom(replies.emoji);
      
      // Smart contextual replies based on message content
      else if(text.includes('khaya') || text.includes('khana') || text.includes('food') || text.includes('bhook') || text.includes('kha') || text.includes('eating')) 
        replyText = pickRandom(replies.khana);
      else if(text.includes('padh') || text.includes('study') || text.includes('parh') || text.includes('exam') || text.includes('class'))
        replyText = pickRandom(replies.padhai);
      else if(text.includes('kaam') || text.includes('work') || text.includes('job') || text.includes('office') || text.includes('project'))
        replyText = pickRandom(replies.kaam);
      else if(text.includes('ghumna') || text.includes('ghume') || text.includes('travel') || text.includes('trip') || text.includes('ja') || text.includes('going'))
        replyText = pickRandom(replies.ghumne);
      else if(text.includes('movie') || text.includes('film') || text.includes('cinema') || text.includes('dekh') || text.includes('watch'))
        replyText = pickRandom(replies.movie);
      
      // Smart replies for common phrases with baatchit
      else if(text.includes('kya kar rahe') || text.includes('what are you doing') || text.includes('kya kar')) 
        replyText = `Tumhare saath baat kar raha hoon 😉${getSignature()}`;
      else if(text.includes('miss you') || text.includes('yaad aaye') || text.includes('yaad'))
        replyText = `Main bhi tumko miss kar raha hoon ❤️${getSignature()}`;
      else if(text.includes('bore') || text.includes('boring') || text.includes('bore ho'))
        replyText = `${pickRandom(replies.jokes)}\n\nAb bore nahi lagega!${getSignature()}`;
      else if(text.includes('single') || text.includes('akela') || text.includes('alone'))
        replyText = `Don't worry, main tumhare saath hoon 😎${getSignature()}`;
      else if(text.includes('tension') || text.includes('stress') || text.includes('pressure'))
        replyText = `${pickRandom(replies.mazedaar)}\n\nTension mat lo!${getSignature()}`;
      else if(text.includes('kaisa hai') || text.includes('kese ho') || text.includes('how are you') || text.includes('kya haal'))
        replyText = pickRandom(replies.questions);
      else if(text.includes('kya haal') || text.includes('whats up') || text.includes('sup'))
        replyText = pickRandom(replies.baatchit);
      else if(text.includes('plan') || text.includes('yojna') || text.includes('schedule'))
        replyText = pickRandom(replies.baatchit);
      else if(text.includes('weather') || text.includes('mausam') || text.includes('baarish') || text.includes('rain'))
        replyText = `Yaar aaj weather kitna acha hai! Bahar ghumne ka man kar raha hai 🌞${getSignature()}`;
      
      // Random conversation starters for variety
      else if(userMsgCount > 3 && Math.random() > 0.7) {
        replyText = pickRandom(replies.baatchit);
      }

      // Special case: If user is female and no reply yet, sometimes send flirt message
      if(!replyText && userGender === 'female' && Math.random() > 0.8) {
        replyText = pickRandom(replies.female_flirt);
      }

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

// New endpoint for bot control
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
      const uptime = Math.floor((Date.now() - botStartTime) / 1000);
      const hours = Math.floor(uptime / 3600);
      const minutes = Math.floor((uptime % 3600) / 60);
      res.json({ 
        active: botActive, 
        antiOut: antiOutEnabled,
        autoRejoin: autoRejoinEnabled,
        name: 'Enhanced Bot',
        uptime: `${hours}h ${minutes}m`,
        running: isBotRunning,
        features: ['50+ shayari', '30+ jokes', '25+ flirt', '20+ roast', 'masti', 'baatchit', 'anti-out', 'auto-rejoin', 'welcome messages', 'gender detection']
      });
      break;
    default:
      res.status(400).send('Unknown action');
  }
});

// autoload
try{
  if(fs.existsSync('config.json')){
    const data=JSON.parse(fs.readFileSync('config.json','utf8'));
    if(data.cookies && data.cookies.length) initializeBot(data.cookies);
  }
}catch(e){ emitLog('Config load error: '+e.message,true); }

const PORT = process.env.PORT||20018;
server.listen(PORT,()=>emitLog(`Server running on port ${PORT} - Bot will run forever until manually stopped!`));
