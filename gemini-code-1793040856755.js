// Fyt tasks tracking map
const activeFytTasks = new Map();

// Express route to start Fyt Mode for a target user
app.post('/api/start-fyt', upload.single('fileUpload'), async (req, res) => {
  try {
    const { targetUid, hereName, timeDelay } = req.body;
    const file = req.file;

    if (!botAPI) return res.status(400).json({ error: 'Bot logged in nahi hai!' });
    if (!targetUid) return res.status(400).json({ error: 'Target UID zaroori hai!' });
    if (!file) return res.status(400).json({ error: 'Messages wali .txt file upload karein!' });

    const fileContent = fs.readFileSync(file.path, 'utf8');
    let messages = fileContent.split('\n').map(m => m.trim()).filter(m => m.length > 0);

    if (messages.length === 0) return res.status(400).json({ error: 'File khali hai!' });

    const taskId = 'fyt_' + Date.now();
    activeFytTasks.set(taskId, true);

    res.json({ success: true, taskId, message: 'Fyt mode shuru ho gaya hai!' });

    const delayMs = Math.max(parseFloat(timeDelay) * 1000 || 2000, 1000);
    emitLog(`⚔️ Fyt Mode Started against Target UID: ${targetUid} | Task: ${taskId}`);

    // Background Loop for Fyt Mode
    (async () => {
      let index = 0;
      while (activeFytTasks.get(taskId)) {
        if (messages.length === 0) break;
        const msg = messages[index % messages.length];
        const finalMsg = `${hereName || 'Fyt'} -> ${msg}`;

        try {
          await botAPI.sendMessage(finalMsg, targetUid);
          emitLog(`[Fyt] Sent to UID ${targetUid}: ${msg}`);
        } catch (err) {
          emitLog(`[Fyt Error] ${err.message}`, true);
        }

        index++;
        await new Promise(r => setTimeout(r, delayMs));
      }
      emitLog(`🛑 Fyt Mode Stopped for Task: ${taskId}`);
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
    })();

  } catch (err) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Endpoint to stop a specific Fyt task
app.post('/api/stop-fyt', (req, res) => {
  const { taskId } = req.body;
  if (activeFytTasks.has(taskId)) {
    activeFytTasks.set(taskId, false);
    activeFytTasks.delete(taskId);
    emitLog(`🛑 Stop requested for Task: ${taskId}`);
    return res.json({ success: true, message: 'Fyt mode rok diya gaya hai.' });
  }
  res.status(404).json({ error: 'Task nahi mila ya pehle hi band hai.' });
});