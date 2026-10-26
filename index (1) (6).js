í// super_masti_bot_v8_complete.js
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
  Fyt:[
    // 50 SHAYARI AS REQUESTED
    `T3RI MA KI KALI GAAND M3 LUND MARU B3H3N K3 L0WD3 SUWR K3 BACH3 T3RI MA KA BH0SDA :D

B3H3NCH0UD K3 BACH3 RANDII K3 DIN3 B3TICH0UD KI AUALD SADI GAAND VAL3 KUT3 K3 BACH3 :D

B3H3NCH0UD K3 DIN3 T3RI MA KI SADI CH00T M3 LUND MAR K3 USKA BH0SDA FADU CH00T MARI K3  :D

GAANDV3 K3 BADCH3 B3H3NCH0UD K3 BACH3 B3TICH0UD KI AUALD T3RI MA KI KALI CH00T

T3RI MA K3 BH0SD3 M3 THPAD DUNGA SAL3 GHANDV3 K3 BADCH3 B3H3NCH0UD K3 DIN3 

T3RI MA KI SADI CH00T MAI GATR M3 DUB0 DUB0 K3 MARUNGA KANJR K3 DIN3 B3H3NCH0UD

MA K3 LUND B3TICH0UD K3 BACH3 T3RI MA K3 BH0SD3 K0 CH33R K3 RKH DU SAL3 GAANDv3  :D

T3RI MA KI GAAND M3 SAND KA LULLA FASA DU BH0SDI K3 DAL33T K3 BACH3

T3RI MA K3 BH0SD3 M3 CURRNT LAGA K3 USK3 BHS0D3 M3 S3 BACH3 PAIDA KAR DUNGA

MA K3 LUND  T3RI B3H3N KI CH0TI CH00T M3 APN3 L0WD3 K0 DAL K3 USKI CH00T KH0LU

MATHRCHD K3 BACH3 CHUD3 HU3 TATT3 YHA APNI MA K0 CHUDAN3 AYA THA MA K3 LUND

T3RI MA K3 BH0SD3 M3 APN3 LUND S3 USK3 BH0SD3 K0 KHULA KAR DUNGA SAL3 CHAMR

CHINAL K3 PIL3  K0TH3 VALI RANDI K3 IKL0T3 KUTIYA K3 BACH3 B3H3NCH0UD K3 DIN3

T3RI MA K3 KAL3 BH00SD3 M3 B0MB F0D K3 BLAST KRVA DUNGA MATHRCHD K3 BACH3 

CH00T MARI K3 DIN3  T3RI B3H3N KA RAP3 KARUNGA BHARI M3TR0 M3 L3 JA K3 MA K3 LUND

SAL3 CHTIY3 K3 BACH3 CHUDAKAD KH0R KI AUALD  HRAM K3 PIL3  M3RA L0WDA CHOOS3GA

T3RI MA KI GAAND M3 ITN3 L0WD3 MARUNGA USKI GAAND L0D0 KI KHAN LAG3N3 LG3GI B3H3NCH0UD

MATHRCHD K3 BACH3 SUWR K3 BACH3 T3RI MA KI GAAND M3 MUKK3 MAR K USKI GAAND SUJA DU

B3H3NCH0UD K3 DIN3 CH00TIY3 K3 BACH3 GAANDV3 K3 DIN3  APNI MA K0 CHUDAN3 VAL3 PIL3 

SAL3 T3RI MAA KI CH00T MAI MIRCHI AUR T3L GARAM KARK3 TADKA LAGA DUNGA :D 8-)

T3RI MAA N3 TUJH3 PAIDA KARN3 S3 P3HL3 T3R3 BAAP KA 1 INCH KA L0WDA L3N3 S3 USK0 CH00T KA CANC3R H0 GYA AB MAI D0CT0R BAN K3 T3RI MAA KI CH00T KA ILAAJ KARUNGA :] :P

T3RI MAA KI CH00T MAI AATANKWADI0 S3 NISHAAN3 LAGWAUNGA B3 BH0SDIK3 :D :P

T3RI MAA KI CH00T MAI GARRAM L0HA DAAL K3 JAMA DUNGA H3H33H3H3H3H3H3H3HH T3RI MAA KI CH00T BL0CK H0 JAYGI :D 8-)

T3RI B3H3N KI CH00T K0 CHAAQU S3 KAAT KAR FIR TAANK3 LAGA KAR WAPIS P3HL3 JAISA KAR DUNGA

T3RI MAA K3 BH0SD3 MAI TUJH3 WAAPIS GHUSS3D DUNGA BAAP S3 FADDA KAR3 GA TU H3IN

T3RI MAA KI CH00T MAI GHUSS KAR KHUJLI KARUNGA MAI USS S3 T3RI MAA K0 ACHA LAG3GA

AB3 BH0SDIK3 T3RI MAA KI CH00T MAI M3THAN3 KI PIP3 DAL K3 AAG LAGA DUNGA T3RI MAA R0CK3T KI TARA UD3GI HAHAAHAHAH :) :D

SUNA HAI T3RA BAAP CIGRATT3 APNI GAAND S3 P33TA HAY ? Y3 SACH HAI KYA ?

AB3 T3RI MAA KI CH00T D3KH JAA K3 ZUNG LAG GYA HAI SAAF T0H KAR LIYA KAR B3H3N K3 L0WD3 :/ :v :P :D

SUNA HAI T3RI MAA N3 KISSI AUR S3 CHUDWA K3 TUJH3 P3DA KIYA HAY KYUNK3 T3RA BAAP KHUSRA HAI ? Y3 SACH HAI KYA ?

AB3 T3RI MAA KI NAAK MAI 2 M3T3R LAMBI K33L GAAD DUNGA FIR T3RI MAA K0 MUHH S3 SAANS L3NA PAD3GA H33H3H3H3H3 :v :P :D

ACHA CHAL R00 MAT ACHA Y3 BATA T3RA BAAP BR3AK DANC3 K3R L3TA HAI KYA

SUNA HAI T3RA BAAP GALI0N MAI L0WDA CH00TA HAI ? Y3 SACH HAI KYA ?

SUNA HAI T3RA BAAP KACHRAA UTHAAN3 GALI GALI FIRTA HAI Y3 SACH HAI KYA ?

SUNA HAI T3RI BAAJI BH33K MANG MANG K3 APNI CH00T CHUDWATI HAI ?

SUNA HAI T3RI BAAJI CH00T MAI D00DH DAAL0 T0U PANI NIKALTA HAI Y3 SACH HAI KYA ?

SUNA HAI T3RI MAA KI CH00T BUHAT NAMK33N HAI Y3 SACH HAI KYA ?

SUNA HAI T3RI BAAJI SWIMMING K3RT3 K3RT3 SWIMMING P00L KA SAARA PAANI APNI CH00T MAI L3 GAYI THI Y3 SACH HAI KYA ?

SUNA HAI T3RI BAAJI KI CH00T S3 JAB PANI NIKALTA HAI T0U TUM SAB US S3 SUBAH FAC3 WASH K3RT3 H0 Y3 SACH HAI KYA ?

T3RI MAA KI CH00T MAI D3KH MAIN3 GARAM GARAM K0YL3 DAAL DIY3 TH3 D3KH CH00T KAALI H0WI K3 NAHI

SUNA HAY T0U SUAR KA D00DH P33TA HAI SACH SUNA HAI KYA?

DARU KI B0TTL3 R3H GAYI HAY T3RI BAAJI KI CH00T MAI JAA L3 K3 AA

ACHA SUN APNI B3H3N K3 B00BS KA M33THA M33THA RAS MALAI WAALA D00DH T0H PILA D3 MUJH3

T3RI B3H3N KI CH00T MAI HAM N3 AAJ BAHUT TUFANII MACHAAY3 JAA K3 D3KH K3 AA K0II NISHAAN HAI K3 NAHI JALDI :P :D

SUNA HAI T3RI MAA KA 1 CH0CHA FATA HUA HAI SAHI SUNA HAI KYA JALDI BATA BAKCH0UDIYAA MAT KAR :P :3

T3RI B3H3N K3 D0N0 CH0CH3 K3 B33CH 1 DAANA HAI USS DAAN3 KA SIZ3 BATA :v :P

T3RI MAA KI CH00T MAI AAJ MAI N3 S0DA KI B0TTLY HILA HILA K3 KH0L K3 GHUSSAAY3 THI JAA K3 D3KH KUCH S0DA BACHI HAI WAHA T0H P33 L3 NAHI T0H WAHI R3HN3 D3 :D :P :v

JAA APNI BAAJI KI CH00T K3 BAAL D3KH CH0T3 H0W3 HAIN K3 NAHI :v :P

T3RI MAA K3 NIPPL3 PAR J0 SABS3 CHH0RA BAAL HAI USKA SIZ3 BATA :v :P

SUNA HAI T3RI MAA 1 JUNGL3 MAI GAY3 THI WAHA W0 BHATAK GAY3 THI AUR KISI P0W3RFUL JANWAR N3 USKI GAAND MAI J0R S3 PANJA MAARA THA SAHI SUNA HAI KYA :P :v :v :P

T3RI MAA KI CH00T MAI NAMAK HAI KYA?

SUNA HAI T3RI MAA HARPIC P0W3R US3 KARTI HAI IS IY3 USKI CH00T T3RI B3H3N KI CH00T S3 PAANCH_GUNAAH JYADA B3HTAR SAAF HAI :P :D SAHI SUNA HAI KYA :P :v :P

T3RI MAA KI CH00T K3 SABS3 BAD3 BAAL KA SIZ3 BATA :/ :v

T3RI B3H3N KI CH00T K0 MAI CH33R DUNGA L0WD3 K3 BAAL T3RI B3H3N KI CH00T M3 MAI LUN DUNGA =] :D

B3H3N CH0UD K3 BACCH3W T3RI B3H3N KI CH00T K0 MAI MAAR MAAR K3 SULA DUNGA B3H3N CH0UD K3 BACCH3W :D :P

T3RI B3H3N KI B00R K0 MAI AISA CH0UDUNGA KI T3RI B3H3N KI B00R FATT JAAY3GI L0WD3 K3 BAAL :P =]]

T3RI BAJI KI CH00T M3 MAI SUN3HRI L0WDA DAAL K3 T3RI BAAJII KI CH00T K0 KALAPA DUNGA :D

T3RI MAA K3 KUSS K0 MAI CH33R DU SUAR K3 BACCH3W T3RI B3H3N K3 BH0SD3 MA MIA FIR3 KRU =]]

SUAR K3 BACCH3W KUTTII MAA K3 L0WD3 T3RI B3H3N K3 BH0SD3 K0 D3KH MAI KAIS3 CH0UDTA HUN :D

RAAND K3 BACCH3W T3RI B3H3N KI GAAND K0 T0 MAI MAAR MAAR K3 SULA DUNGA B3H3N CH0UD K3 BACCH3W :D

T3RI B3H3N KI CH00T K0 MAI AISA CH0UDUNGA KI T3RI B3H3N KI CH00T AAJ KALAP3GI L0WD3 K3 BAAL :D

HH3H3H3H33H3HHH3H3H3 CH00T MAARANII K3 BACCH3W H3H3H3H3H BURMAARII T3RI B3H3N D3KH =]] KALAP KALAP K3 KAISA L0WDA L3TI HAI :D :D

B3H3N CH0UD K3 DIIN33 T3RI B3H3N KI CH00T K0 =]] MAI HIR3 KRUNGA SUAR K3 NASHAL B3H3N CH0UD K3 DINN3 :D :D

B3H3N CH0UD K3 DINN3 KI T3RI B3H3N KI CH00T FIR KISI S3 CHUDN3 K3 LAYAK3 NAW =]]RAH3GI H3H3H33H3H3H :D :D

MATH3RCH0UD BH0SD CH0UD K3 AULAAD HA HAA AH KALAP B3H3N CH0UD K3 BACCH3W T3RI B3H3N KI CH00T KALAP3GI =]]

T3RI MAA K0 MAI AISA CH0UDUNGA KI T3RI BAAJII KI RUH KAANP UTH3GI B3H3N CH0UD K3 DINNN3 =]]

T3RI B3H3N KI GAAND M3 MAI L0WDA DUNGA B3H3N CH0UD K3 DINN3 T3RI B3H3N KI CH00T K0 MAI SULA DU =]]]

T3RI MAA K3 BH0SD3 MA MAI LAAT MAAR KAR T3RI B3H3N K3 BH0SD3 K0 MAI CH33R DUNGA :D =]

:* T3RI B3H3N KI GAAND KA MAI W0 HAAL KRUNAG B3NCH0UD K3 DIINN3 KI T3RI B3H3N KI GAAND =DFATI KI FATI R3H JAAY3GI =]]

T3RI BAJI KI CH00T M3 MAI SUN3HRI L0WDA DAAL K3 T3RI BAAJII KI CH00T K0 KALAPA DUNGA :D

H3H3H3H3H3H3H3 KAISA CHUD RHA HAI B3H3N CH0UD K3 BACCH3W JAISA K0I BACCH3W CHUD RH3 H0 MA K3 DINN3 =]]

T3RI T3RI B3H3N KI CH00T T0 KALAP KALAP K3 L0WDA CH00S3 JAA RHI HAI H3N H3N B3H3N CH0UD K3 DINN3 =]]

AISA CHUD3GA TU HAWN T3RI B3H3N KI CH00T T0 AAJ KALAP3 JAA RHI HAI SUAR K3 RANDII BACCH3W =]]

[[AB3Y LUN K3 BAAL H3H3H3H3H3H3 H3H3H3H3 MAI T3RA BAAP HUN B3H3N CH0UD K3 L0WD3 T3RI B3H3N KI CH00T K0 MAI CH33R DUNGA =]]

T3RI B3H3N KI CH00T FATI KI FATI R3H JAAY3GI LW0D3 K3 BACCH3W =]] SAR3 HUY3 KID3 K3 BACCH3W :D :D

T3RI B3H3N KI CH00T KA KYAA HAAL H0TA HAI M3R3 MUUNN3 T3RI B3NN T0 M3R3 L0WD3 P3 AAK3 =]] R0T3 FIR3GI

RAAND K3 BACCH3W T3RI B3H3N KI CH00T K0 MAI MAAR MAAR K3 SULA DUNGA B3H3N CH0UD K3 DINN3 H3H3H3H3 :D

SALA TU KR3GA BAAP S3 FADA HAWN B3H3N CH0UD K3 LW0D3 T3RI B3H3N KI GAAND K0 MAI RULA RULA K3 RAKH DU =]]

T3RI B3H3N KI CH00T MAI 3IFF3L T0W3R GHUSSA KAR T3RI B3H3N KI CH00T K0 500 M3TR3 LAMBI KAR DUNGA H3H33H3H3H3 =]]

T3RI B3H3N K3 BH0SD3 MAI JAA K3 S0 JAUNGA MAI LW0D3 K3 BAAL :D RANDII K3 BACCH3W

T3RI MAA KI CH00T MAI T3RI B3H3N KA LULLA GHUSSA DUNGA MAI GAANDV3 K3 DINN3 H3H3H3H3H33H3H3 =]]

NAW T0 MAI ITNA KALAPAA DUNGA KI T3RI B3H3N KI CH00T R0 R0 K3 M3R3 L0WD3 K0 CH00ST3 JAAY3GI =]]]

T3RI B3H3N KI CH00T K0 MUJH3 CH0UDN3 M3 BADA MAZA ARHA HAI B3H3N CH0UD K3 DINN3 KINAR KI AULAAD H3H3H3H3H :D

T3RI B3H3N KI CH00T =]]FATI JAA RHI HAI BH0SD K3 :P T3RI B3H3N KI CH00T ITNA KALAP KIY0 RHI HAI R333 RANDII K3 BACCH3W =]]

T3RI B3H3N KI GAAND M3 MAI LAAT MAAR MAAR K3 T3RI B3H3N KI CH0CH3 K0 MAI FULA DUNGA B3H3N CH0UD K3 L0WD3 :D

T3RI B3H3N KI CH00T K0 MAI D0GYY STYL3 M3 GAB CH0UDUNGA NAW KI T3RI B3H3N KI CH00T FATI KI FATI R3H JAAY3GI :D

MATH3RCH0UD K3 PILL3Y T3RI B3H3N KI CH00T K0 MAI CH33R D3NA HAI AAJ B3H3N CH0UD K3 L0WD3  :D LADTA HAI TU BAAP S3 HAWN :D

T3RI B3H3N KI CH00T T0 AAJ KAAP JAAY3GI B3H3N CH0UD K3 L0WD3 T3RI B3H3N KI CH00T D3KH KAIS3 LAD3GI M3R3 L0WD3 S3 :D

MATH3RCH0UD K3 BACCH3W  :P T3RI B3H3N K3 CH00T KA MAI TITIHARI JAAM KRUNAG BH0SD K3 BACCH3W H3H3H3H3H3H3H KALAP :D

T3RI MAA K0 MAI MC M3 JAB CH0UDUNGA NAW KI T3RI B3H3N KI CH00T BHI KAAPT3 JAAY3GI M3RA L0WDA L3N3 S3 B3H3N CH0UD :D

B3H3N CH0UD K3 L0WD3 T3RI B3H3N KI CH00T T0 KAAP3 JAATI HAI L0WD3 K3 BAAL T3RI NAANII KI CH00T K0 MAI MAAR K3 JAGA DUNGA :D :D

TU LAD3GA BAAP S3 AAJAA B3H3N CH0UD K3 BACCH3W T3RI B3H3N KI CH00T K0 MAI MAAR MAAR K3 MAI APNA L0WDA TUJH3 F3LL KRA DU :D

AAJ T0 TU M3RA AISA LW0DA CH00S3GA B3H3N CH0UD K3 L0WD3 KI T3RI B3H3N KI CH00T FATI KI FATI R3H JAAY3GI L0WD3 K3 BACCH3W :D

BAAP S3 AYA HAI TU LADN3 H3H3H3H3H3H3H3 T3R3 SAKAL P3 MAI MUTH MAAR MAAR K3 T3RI B3H3N KI CH00T K0 JJAIS3 CH0UDTA HUN :D

MAI T3RI MAA K0 KAIS3 CH0UDTA HUN AAJ TUJH3 YAAD DILA DUNGA RAAAND K3 BACCH3W  :v AAJ MAI TUJH3 RUL RULA K3 CH0UDUNGA B3HHNCH0UD K3 DINN3 :v

M3R3 BACCH3W  AAJA M3R3 L0WD3 _||_ P3 JH00M MATH3RCH0UD K3 GHASTI K3 BACCH3W  :D T3RI B3H3N KI CH00T M3 MAI BASTI BASA DU :v

T0 M3R3 BACCH3 M3RA L0WDA F3LL KR RHA HAI NAW ACH3W S3 HAWN B3H3N CH0UD K3 DINN3 T3RI B3H3N KI CH00T T0 R0T3 JAAY3GI L0WD3 :D

T3RI B3H3N KI CH00T K0 MAI AAJ RULA DIYA HUN H3H3H3H3H TU BAAP S3 LAD3GA H3H3H3H3H3 GHASTI K3 BACCH3W  :v AAJA MAA K3 L0WD3 :D

T3RI B3H3N KI CH00T K0 MAI MAAR3 JAAUNGA L0WD 3K3 BAAL T3RI B3H3N K3 BH0SD3 K0 MAI CH33R DUNGA B3H3N CH0UD K3 DINN3 :D :D :P

SALA 0KAAT L3SS SUAR KA BACHA Y3 KR3GA APN3 BAAP S3 FADA JIS B3H3N CH0UD K3 LW0D3 K0 GAALI NAW D3N3 ATA HAI B3H3N CH0UD K3 L0WD3 :D

T3RI B3H3N KI B00R K0 MAI GD0GYY STYL3 M3 HI CH0UDU YA AKIS 0R STYL3 M3 HAWN MATH3RCH0UD K3 DINN3 MUJH3 BATA JARA :D

T3RI B3H3N KI CH00T KAAP3 JAA RHI HAI AISA KIY0 M3R3 BACCH3W  :D AAB TU F3LL NAW KRNA M3R3 MUNN3 :D

TU F33L BAHUT JALD KRTA HAI BH0SD K3  :P T3RI MAA K3 BH0SD3 K0 MAI CH33R DUNGA L0WD3 K3 BAAL :D 

T3RI B3H3N KI GAAND M3 MAI L0WDA DALU MATH3RCH0UD K3 DINN3 T3RI B3H3N KI CH00T D3KH KAIS3 KAAPTI HAI B3H3N CH0UD K3 DINN3 :D :D :P

T3RI MAA KI CH00T KAIS3 KALAP RHI HAI JARA D3KH B3H3N CH0UD K3 BACCH3W TU T0 AB R0 DIYA HAI B3H3N CH0UD K3 L0WD3 MAA K3 DINN3 :D

T3RI B3H3N KI CH000T K0 MAI L0WD3 KA BAAN MARUNAG KI T3RI B3H3N KI CH00T CHIT H0 JAAYGI L0WD3 K3 BACCH3W  :D TU ITNA KALAPTA HAI :P

MATH3RCH0UD K3 DINN3 MUJH3 NAW PATA THA HAWN B3H3N CH0UD K3 DINN3 KI TU ITNA R0 D3GA :O B3H3N CH0UD K3 LW0D3 :v ITNA K0I R0TA HAX :O

CH00T K3 P33SU M3R3 BACCH3W T3RUI B3H3N KI CH00T K0 T0 MAI AAJ KILSA KILSAA K3 HI MAAR DUNGA RAAND K3 BACCH3W :P

KITNA KALAPTA HAI Y3 M3RA BACHA  :v ISKI MAA KI CH00T K0 T0 MAI CH33R MARUNGA RANDIII K3 BACCH3W  :v TU AAJ NAW M3RA L0WDA CH00S3GA :P

T3RI B3H3N APNI CH00T MUJH3 D3KR CHALTI BANGI R0T3 H3H3H3H3H3H CHUD3 HUY3 CHAMAR BACCH3 H3H3H3H3H T3RI B3H3N KI CH00T K0 MAI MARU :D

RANDII K3 AULAAD TU KR3GA BAAP S3 FADAA AJAA B3 L0WD3 T3RI B3H3N KI CH00T K0 T0 MAAR HI DIYA HUN =]]

AB T3RI BAAJII KI CH00T K0 JARA MAI MARU L0WD3 K3 BAAL :v :D =]]

BS TU KALAPNA NAHI M3R3 BACCH3W  :v TU KAPTA HAI T0 M3R3 L0WD3 K0 SHARM AJATA HAI H3H3H3H3H3H3H3  :D =]]

HIJR3 KI 0LAAAD  :P SALA T3RA BAAP HIJDA T0 TU BHI HIJDA :v

KISI GAANDI NAALI K3 KID3 T3RI B3H3N KI CH00T K0 MAI AISA MARUNGA KI T3RI B3H3N KI CH00T M3R3 L0WD3 P3 AAK3 DANC3 KR3GI B3H3N CH0UD :D

T3RI MAA KI CH00T K0 MAI MAAR MAR K3 ITH3 HI SULA DUNGA B3H3N CH0UD K3 BACCH3W T3RI BAAJI KI CH000T M3 MAI SUHANI L0WDA DAALU :D

T3RI MAA KI CH00T D3KH AAJ KAIS3 KAPTI HAI B3H3N CH0UD K3 BACCH3W TU R0 R0 K3 M3R3 L0WD3 KA AAJ BHIKH MAANG B3H3N CH0UD K3 BACCH3W =]]

T3RI MAA KI CH00T M3 MAI MITTI KA T3L DAAL K3 T3RI MAA KI CH00T K0 MAI MAAR DUNGA B3H3N CH0UD K3 BACCH3W T3RI B3H3N KI CH00T MARU :D

GAANDUXX K3 BACCH3W T3RI B3H3N KI CH00T M3 MAI SARS0 KAA T3L LAGA K3 T3RI B3H3N KI CH00T K0 MAI PAANI HI PAANI KR DUNGA H3H3H3H :D

SUAR K3 BACCH3W  :P SALA GAAND3 NAALI K3 KID3 :D H3H3H3H3H3H :v T3RI B3H3N KI CH00T M3 MAI AKR0TT DAAL DU B3 BH0XDK3  :P H3H3H3HH33HH3 :D

M3RA L0WDA AAAJ F3LL KR B3H3N CH0UD K3 BACCH3W D3KH T3RI MAA B3H3N KI CH00T KAIS3 FATI JAA RHI HAI BHIKHAARI K3 BACCH3W KILAS B3H3N CH0UD :D

TU KILST3 JAAY3GA M3RA L0WDA T3RI MAA KI CH00T M3 JAAT3 RAH3GA B3H3N CH0UD K3 DINN3 BAAP S3 LADTA HAI NAW T0 LIKHN3 BHI NAW ATA HAI=]]

T3RI MAA KI CH00T K0 MAI MAR MAAR K3 TUJH JAIS3 ANPADH GAAWAAAR K0 MAI LIKHNA SIKHA DUNGA L0WD3 K3 BAAL =]] 0KAAT L3SSS BACCH3W :P

T3RI BAAJI KI CH00T M3 MAI SUN3HARI L0WD3 K3 ATAKD33R LAGA DUNGA RAAND K3 BACCH3W  KI T3RI B3H3N KI B00R KAPT3 FIR3GI L0WD3 :D

T3RI MAA KI CH00T K0 D3KH MAAI MAAR MAAR K3 SULA DUNGA B3H3N CH0UD K3 DINN3 T3RI B3H3N KI B000R M3R3 L0WD3 P3 AAK3 JHUM3GI B3H3N CH0UD K3 BACCH3W =]]

T3RI MAA KI CH00T M3 MAI ACD DAAL DAAAL K3 T3RI MAA K3 BH0SD3 K0 MAI JALA DUNGA GAANDUXX K3 BACCH3W KI T3RI MAA KALAPT3 FIR3GI B3H3N CH0UD K3 DINN3 :D

T3RI DAAADII KI CH00T M3 MAI L3DI KAA T3L LAGA K3 MAI AISA MAAR MARUNGA KI T3RI DAADII KI CH00T KALAP UTH3GI B3H3N CH0UD K3 BACCH3W H3H3H3H3H :D

KALAPTA HAI ITNA NAW KALAP B3H3N CH0UD K3 BACCH3W NAW T0 MAI T3R3 GAAND M3 SARIYAA DAAL K3 T3RI MAA 0R T3RI B3H3N KI GAAND K0 MAI WH0L3 BANA DUNGA =]]

T3RI MAA CHUD3 JAA RHI HAI M3R3 L0WD3 P3 CHADH CHADH K3 B3H3N CH0UD K3 BACCH3W 0R TU R0Y3 JAA RHA HAI L0WD3 K3 BAAL T3RI B3H3N K3 BH0SD3 K0 MAI CHID DU :D

T3RI B3H3N KI CH00CH3 K0 AAJ MAI DABA DABA K3 BAD3 KR DUNGA B3H3N CH0UD K3 L0WD3 :D =]]

FIR TU M3RA L0WDA CH00SNA H3H3H3H3H3H :D T3RI B3H3N BHI AISA HI CH00STI HAI M3RA L0WDA =]]

T3RI MAA B3H3N K0 MAI BICH R0AD P3 LANGA KR KR K3 MAI DANC3 KRA DUNGA B3H3N CH0UD K3 L0WD3 FIR T3RI MAA B3H3N KA KYA HAAL H0GA H3N BHIKHARI K3 BACCH3W :D :D

SALA 0KAAT L3 BACCH3W TU AYA THA BAAP S3 LADN3 RAAND K3 BACCH3W T3RI B3H3N KI CH00T T0 R0Y3 JAA RHI HAI B3H3N CH0UD K3 DINN3 AISA R0TI HAI T3RI MAA  :D :P

T3RI MAA K0 MAI JAB NAGA KRK3 CH0UDUNGA NAW KI T3RI MAA M3RA L0WDA CH00ST3 JAAY3GI B3H3N CH0UD K3 DINN3  :P TU BS KALAPNA NAHI H3H3H3H3HH3H3H3H3H :D

APN3 L0WD3 P3 BITHA K3 JAB T3RI B3H3N KI CH00T K0 JUMP KRAUNGA NAW KI T3RI B3H3N KI CH00T FAT3 JAAY3GI SAMJHA L0WD3 :D

M3R3 BACCH3W T3RI MA KI KUSS M3 SUSU KAR DUNGA L0WDA DAAL K3 :D MADHARCH0UD 2 KIL0M3T3R DUR HAI BUS STATI0N L0LZZ =]]

T3RI MAA L0CAL PLAT3F0RM PAR PATAK3 PATAK3 K3 CH0UDUNGA MADHARCH0UD K3 BACCH3 HAHAHAHHAHAHAHAHAHAAHAHAH :v

T3RI B3H3N K3 BH0SD3 M3 MAI L0WDA DAAL KR T3RI B3H3N KI CH00T K0 MAI CH0UD JAUNGA L0WD3 K3 BACCH3W AAJA B3HC0D K3 L0WD3 =]]

T3RI B3H3N KI CH00T K0 MAI CH0UD JAUNGA L0WD3 K3 BAAL RANDII K3 DINN3 =]]

T3RI B3H3N KI GAAND M3 MAI L0WDA MARUNGA BH0SD CH0UD K3 AULAAD SAL3 GAAND3 NAALI K3 GAAND3 BACCH3W =]]

BH0SDIK3 T3RI B3H3N K3 B00R K0 MAI CH33R JAUNGA L0WD3 K3 DINN3 T3RI B3H3N KI CH00T K0 MAI MART3 JAU B3H3N CH0UD K3 BACCHWW =]]

AJA =]] R3GISTAAN K3 DINN3 T3RI B3H3N KI GAAND MARU L0WD3 K3 DINN3 :P

T3RI B3H3N KI CH00T K0 MAI CH0UD CH0UD KR PAGAL KR DNGA NAW R3 B3H3N CH0UD K3 L0WD3 T3RI B3H3N KI CH00T M3 MAI MUTHI MAAR MAAR K3 FAD DUNGA B3H3N CH0UD K3 DINN3 =]]

RANDII INSHAAN K3 RANDII BACCH3W T3RI B3H3N K3 BH0SD3 K0 MAI CH33R JAUNGA LUN K3 BAAL T3RI B3H3N KI GAAND M3 MAI G0LI MARU BH0SDK3 BACCH3W :P :3 =]]

T3RI B3H3N K0 MAI APN3 L0WD3 P3 BITHA KR T3RI B3H3N KI CH00T K0 MAI CH0UD DUNGA =]]

B3H3N CH0UD K3 L0WD3 RANDII INSHAAN K3 RANDII BACCH3W T3RI B3H3N KI CH00T K0 MAI CH0UDT3 JAUNGA =]]

L0WD3 K3 DINN3 T3RI B3H3N KI GAAND K0  MAI CH33R JAU B3H3N CH0UD K3 L0WD3 RANDII K3 PILL3Y T3RI B3H3N KI GAAND MARU MAA K3 L0WD3 =]]

T3RI B3H3N K0 MAI CH0UD CH0UD KAR T3RI BAAJI K3 BH0SD3 K0 MAI CH33RT3 JAU =]]

B3H3N CH0UD K3 DINN3 T3RI B3H3N KI GAAND M3 MAI AISA L0WDA DALU KI T3RI B3H3N KI CH00T PAGAL H0 JAAY3GI =]]

B3H3N CH0UD K3 DINN3 =]]] AAJ T3RI B3H3N K3 BH0SD3 K0 MAI MAR DUNGA B3H3N CH0UD K3 L0WD3 =]]]

T3RI B3H3N KI CH00T M3 MAI L0WDA DAALU B3H3N CH0UD K3 DINN3 T3RI B3H3N K3 BH0SD3 K0 MAI CH0UDT3 JAU RANDII K3 NASHAL B3H3N CH0UD K3 L0WD3 =]]

T3RI B3H3N K3 BH0SD3 M3 MAI L0WDA DAAL KR T3RI B3H3N KI KUSS K0 MAI CH0UD DU B3H3N CH0UD K3 L0WD3 =]]

RANDII CHINAAL K3 BACCH3W T3RI B3H3N KI CH00T K0 MAI MART3 JAU B3H3N CH0UD K3 L0WD3 =]]

RANDII K3 DINN3 B3H3N CH0UD K3 L0WD3 T3RI B3H3N K3 BH0SD3 M3 MAI L0WDA DAAL KR T3RI B3H3N KI CH00T MARU =]]

GAANDU K3 BACCH3W L0WD3 T3RI B3H3N KI KUSS K0 MAI CH0UDT3 JAU B3H3N CH0UD K3 L0WD3 =]]

T3RI B3H3N KI CH00T K0 MAI CH0UD MARU B3H3N CH0UD K3 L0WD3 RANDII K3 DINN3 T3RI B3H3N KI CH00T MARU MAA K3 L0WD3 =]]

L0WD3 K3 BACCH3W B3H3N CH0UD K3 DINN3 T3RI B3H3N K3 BH0SD3 M3 MAI L0WDA DAAL KR T3RI B3H3N KI CH00T K0 MAI CH0UD MARU MAA K3 L0WD3 RANDII K3 BACCH3W3 =]]

T3RI B3H3N KI CH00T K0 MAI MART3 JAUNGA B3H3N CH0UD K3 L0WD3 T3RI RANDII MAA K3 BH0SD3 M3 MAI L0WDA DUNGA =]]

BH0SDK3 BACCH3W T3RI B3H3N KI CH00T K0 MAI CH0UD MARUNGA =]]L0WD3 K3 DINN3 RANDII K3 BACCH3W =]]

T3RI B3H3N K3 BH0SD3 K0 MAI CH0UD DALU B3H3N CH0UD K3 L0WD3 T3RI B3H3N K3 BH0SD3 K0 MAI CH0UDT3 JAU =]]

B3H3N CH0UD K3 L0WD3 RANDII INSHAN K3 RANDII K3 AULAAD BH0SDK3 BACCH3W T3RI B3H3N K3 BH0SD3 M3 MAI L0WDA DAL KR T3RI B3H3N KI CH00T K0 MAI CH0UDT3 JAU B3H3N CH0UD K3 L0WD3 =]]

T3RI B3H3N KI GAAND K0 MAI CH0UD DU B3H3N CH0UD K3 L0WD3 =]]

T3RI B3H3N K3 BH0SD3 M3 MAI MUTHI MARU B3H3N CH0UD K3 L0WD3 T3RI B3H3N KI GAAND K0 MAI CH0UDT3 JAU =]]

B3H3N CH0UD K3 L0WD3 T3RI BAAJI KI CH00T M3 MAI L0WDA DAL DUNGA L0WD3 K3 DINN3 B3H3N CH0UD K3 DINN3 B3H3N CH0UD K3 BACCH3W =]]

T3RI B3H3N KI GAAND 0 MAI CH0UD DUNGA L0WD3 K3 BACCH3W RANDII K3 DINN3 =]]

T3RI B3H3N K3 BH0SD3 M3 MAI L0WDA DALU B3H3N CH0UD K3 DINN3 RANDII K3 BACCH3W L0WD3 K3 BACCH3W B3H3N CH0UD K3 DINN3 =]]

T3RI B3H3N KI CH00T K0 MAI CH0UD DUNGA B3H3N CH0UD K3 L0WD3 T3RI B3H3N KI CH00T M3 MAI L0WDA DUNGA B3H3N CH0UD K3 BACCH3W =]]

RANDII K3 DINN3 L0WD3 K3 BACCH3W T3RI B3H3N KI CH00T K0 MAI CH0UD DUNGA MAA K3 L0WD3 =]]

T3RI B3H3N K3 BH0SD3 K0 MAI CH0UDT3 JAUNGA B3H3N CH0UD K3 BACCH3W T3RI B3H3N KI CH00T M3 MAI L0WDA DAL DAAL KR T3RI B3H3N KI CH00T K0 MAI CH33R DUNGA =]]

L0WD3 K3 DINN3 GHASTI K3 BACCH3W T3RI B3H3N KI CH00T K0 MAI AAJ CH33R DU B3H3N CH0UD K3 L0WD3 T3RI B3H3N KI CH00T MARU =]]

MAA K3 L0WD3 T3RI B3H3N K3 BH0SD3 M3 MAI L0WDA D3T3 JAAUNGA BH0SDIK3 BACCH3W F33L KR L0WD3 K3 BAAL

T3RI B3H3N KI CH00T K0 MAI AAJ KAIS3 CH0UD RHA HUN B3H3N CH0UD K3 L0WD3 T3RI B3H3N KI GAAND K0 MAI AAJ CH0UDT3 JAUNGA =]]B3H3N CH0UD K3 DINN3

T3RI B3H3N KI CH00T M3 MAI AISA L0WDA DUNGA KI T3RI B3H3N KI CH00T FAT JAAY3GI B3H3N CH0UD K3 L0WD3

T3RI B3H3N KI CH00T M3 MAI L0WDA DAL KAR T3RI B3H3N KI CH00T K0 MAI SHIFT KRA DUNGA B3H3N CH0UD K3 L0WD3 RANDII K3 NASHAL B3H3N CH0UD K3 L0WD3 :D

T3RI B3H3N K3 BH0SD3 K0 MAI CH0UDT3 JAU L0WD3 K3 DINN3 T3RI B3H3N KI GAAND K0 MAI MAR MAAR KR T3RI B3H3N KI CH00T K0 MAI CH0UD DUNGA =]]

B3H3N CH0UD K3 BACCH3W RANDII K3 AULAAD LIKH BH0SDIK3 BACCH3W T3RI B3H3N KI CH00T K0 MAI CH0UDT3 JAU L0WD3 K3 DINN3 T3RI B3H3N KI CH00T K0 MARU =]]

SAL3 L0WD3 LANG3R KI AULAAD B3H3N CH0UD K3 BACCH3W BAAP S3 LAD3 GA T3RI B3H3N KI CH00T K0 MAI KHA JAAUNGA B3H3N CH0UD K3 BACCH3W =]]

T3RI B3H3N K3 BH0SD3 K0 MAI CH0UDT3 JAUNGA RANDII K3 AULAAD T3RI B3H3N KI CH00T M3 MAI L0WDA DUNGA B3H3N CH0UD K3 BACCH3W T3RI B3H3N KI CH00T MARUNGA BH0SDK3 BACCH3W =]]

T3RI B3H3N KI CH00T K0 MAI AISA CH0UDUNGA B3H3N CH0UD K3 L0WD3 T3RI B3H3N KI CH00T R0T3 JAAY3GI B3H3N CH0UD K3 L0WD3 =]]

T3RI B3H3N K3 BH0SD3 K0 MAI AAJ N0CH KHAUNGA L0WD3 K3 BACCH3W T3RI B3H3N K3 BH0SD3 M3 LAAT MAAR MAAR K3R T3RI B3H3N KI CH00T K0 MAI SULA DUNGA L0WD3 K3 BACCH3W =]]

T3RI B3H3N KI GAAND M3 MAI HATHI KA L0WDA DAAL KR T3RI B3H3N KI GAAND K0 CH33R DALU RANDII K3 NASHAL =]]

T3RI B3H3N K0 D3KH KAIS3 CH0UDT3 JATA HUN BH0SDIK3 BACCH3W T3RI B3H3N KI CH00T R0T3 JAAY3GI B3H3N CH0UD K3 L0WD3 T3RI B3H3N KI GAAND K0 CH33R DALU =]]

RANDII K3 AULAAD B3H3N CH0UD K3 BACCH3W LIKH BH0SDIK3 T3RI B3H3N K3 BH0SD3 M3 MAI L0WDA DAL K3R T3RI B3H3N KI CH00T MARU MAA K3 L0WD3 =]]

B,
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
    `Aankhein mila ke dekho toh pata chalega 😉\nTumhare dil mein bhi koi jagah hai ya nahi?${getSignature()}`,
    `Tumhare saath time bitana accha lagta hai ❤️\nJaise chand ko tare mil jaye${getSignature()}`,
    `Kya tumhare dil me bhi koi hai ya jagah khali hai? 😏\nMeri taraf se puch raha hoon samjhe?${getSignature()}`,
    `Tumhara smile toh mere din ko bright kar deta hai ☀️\nJaise suraj ki kirne andhera mitaye${getSignature()}`,
    `Koi tume bataya hai ki tum kitni cute ho? 😍\nNahi toh main bata du?${getSignature()}`,
    `Tumhare bina group adhoora lagta hai 💫\nJaise biryani mein namak nahi${getSignature()}`,
    `Tumse baat karke aisa lagta hai 🌟\nJaise koi hit movie dekhi ho${getSignature()}`,
    `Tumhara har message dil ko chhu jata hai 💓\nJaise koi soft song playing ho${getSignature()}`,
    `Kya tum mere liye special ho? 🤔\nKyuki tumhare aate hi mera mood special ho jata hai!${getSignature()}`,
    `Tumhe dekh ke lagta hai 😘\nShayad main pyaar mein pad gaya hoon!${getSignature()}`,
    `Tumhari aankhon mein kuch alag hi chamak hai ✨\nJaise sitaaron ki raat ho${getSignature()}`,
    `Tumse baat karke lagta hai ❤️\nJaise koi khoobsurat sapna dekh raha hoon${getSignature()}`,
    `Tumhara har message dil ko chhu jata hai 💫\nJaise koi meethi si dhadkan ho${getSignature()}`,
    `Kya tumhe pata hai tum kitni pretty ho? 🌸\nHar baar dekh ke dil dhadak jata hai${getSignature()}`,
    `Tumhari muskurahat dekh ke 🌟\nPoora din bright ho jata hai${getSignature()}`,
    `Tumhare saath har pal hai khaas 💖\nJaise khushi ki baarish ho${getSignature()}`,
    `Tumhari aawaaz mein hai jaadu 🎶\nJo dil ko chhoo jata hai${getSignature()}`,
    `Tumhare bina lagta hai kuch adhoora 😔\nTumhare saath poori ho jaati hai duniya${getSignature()}`,
    `Tumhe dekh ke lagta hai 🌹\nJaise baharon ka mausam ho${getSignature()}`,
    `Tumhari har baat hai niraali ✨\nDil ko chhoo jaati hai${getSignature()}`,
    `Tumse baat karke aisa lagta hai 💫\nJaise koi khoobsurat sapna dekh raha hoon${getSignature()}`,
    `Tumhare liye toh dil dhadakta hai ❤️\nHar pal tumhare khayal mein${getSignature()}`,
    `Tumhari muskurahat hai jaise 🌞\nSuraj ki pahli kirn${getSignature()}`,
    `Tumhare saath bitaye har pal hai khaas 💫\nJaise koi hasi ka tohfa ho${getSignature()}`,
    `Tumhe paana hai meri khwahish 🌟\nTumhare bina adhoori hai har aarzu${getSignature()}`
  ],
  roast:[
    // ENHANCED ROAST MESSAGES
    `Tere jaise logo ko dekh ke lagta hai nature ne experiment kiya tha 😂\nPar result aaya fail!${getSignature()}`,
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
