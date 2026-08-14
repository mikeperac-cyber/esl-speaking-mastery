/**
 * ESL Speaking Audio Recorder & IndexedDB Storage System (Foundations Track)
 */

class ESLRecorderManager {
  constructor(trackId) {
    this.trackId = trackId; // 'master_b2_c2' or 'foundations_a2_b1'
    this.dbName = 'ESLSpeakingRecordingsDB';
    this.dbVersion = 1;
    this.db = null;
    this.currentRecordingQNum = null;
    this.mediaRecorder = null;
    this.audioChunks = [];
    this.recordingStartTime = null;
    this.timerInterval = null;
    this.speechRecognizer = null;
    this.liveTranscript = '';
    this.cachedRecordings = {}; // qNum -> record data
    this.activeAudioBlobUrls = {}; // qNum -> objectUrl
  }

  async init() {
    await this.initDB();
    await this.loadAllRecordings();
    this.updateRecordingsBadge();
  }

  initDB() {
    return new Promise((resolve) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('recordings')) {
          const store = db.createObjectStore('recordings', { keyPath: 'id' });
          store.createIndex('track', 'track', { unique: false });
          store.createIndex('day', 'day', { unique: false });
        }
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve(this.db);
      };

      request.onerror = (event) => {
        console.error('IndexedDB init error:', event.target.error);
        resolve(null);
      };
    });
  }

  getRecordId(qNum) {
    return `${this.trackId}_q${qNum}`;
  }

  async loadAllRecordings() {
    if (!this.db) return;
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction('recordings', 'readonly');
        const store = tx.objectStore('recordings');
        const req = store.getAll();

        req.onsuccess = () => {
          const records = req.result || [];
          records.forEach((rec) => {
            if (rec.track === this.trackId) {
              this.cachedRecordings[rec.qNum] = rec;
            }
          });
          resolve(this.cachedRecordings);
        };

        req.onerror = () => resolve({});
      } catch (e) {
        console.warn('Error loading recordings from IndexedDB:', e);
        resolve({});
      }
    });
  }

  async saveToDB(record) {
    this.cachedRecordings[record.qNum] = record;
    this.updateRecordingsBadge();

    if (!this.db) return;
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction('recordings', 'readwrite');
        const store = tx.objectStore('recordings');
        store.put(record);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (e) {
        console.warn('Error writing to IndexedDB:', e);
        resolve(false);
      }
    });
  }

  async deleteFromDB(qNum) {
    delete this.cachedRecordings[qNum];
    if (this.activeAudioBlobUrls[qNum]) {
      URL.revokeObjectURL(this.activeAudioBlobUrls[qNum]);
      delete this.activeAudioBlobUrls[qNum];
    }
    this.updateRecordingsBadge();

    if (!this.db) return;
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction('recordings', 'readwrite');
        const store = tx.objectStore('recordings');
        store.delete(this.getRecordId(qNum));
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (e) {
        resolve(false);
      }
    });
  }

  async clearAllFromDB() {
    if (!confirm('Are you sure you want to delete all saved recordings for this track? This cannot be undone.')) {
      return;
    }

    this.cachedRecordings = {};
    Object.values(this.activeAudioBlobUrls).forEach(url => URL.revokeObjectURL(url));
    this.activeAudioBlobUrls = {};
    this.updateRecordingsBadge();

    if (this.db) {
      const tx = this.db.transaction('recordings', 'readwrite');
      const store = tx.objectStore('recordings');
      const req = store.getAll();
      req.onsuccess = () => {
        const records = req.result || [];
        records.forEach(r => {
          if (r.track === this.trackId) {
            store.delete(r.id);
          }
        });
      };
    }

    if (typeof renderActiveDay === 'function') {
      renderActiveDay();
    }
    this.renderRecordingsList();
  }

  getRecording(qNum) {
    return this.cachedRecordings[qNum] || null;
  }

  getAudioUrl(qNum, blob) {
    if (this.activeAudioBlobUrls[qNum]) {
      URL.revokeObjectURL(this.activeAudioBlobUrls[qNum]);
    }
    const url = URL.createObjectURL(blob);
    this.activeAudioBlobUrls[qNum] = url;
    return url;
  }

  async toggleRecording(qNum, day, promptText) {
    if (this.currentRecordingQNum === qNum) {
      this.stopRecording(qNum, day);
    } else {
      if (this.currentRecordingQNum !== null) {
        this.stopRecording(this.currentRecordingQNum, day);
      }
      await this.startRecording(qNum, day);
    }
  }

  async startRecording(qNum, day) {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert('Audio recording is not supported in this browser environment. Please use a modern browser (Chrome, Edge, Firefox, Safari) over HTTPS or localhost.');
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.currentRecordingQNum = qNum;
      this.audioChunks = [];
      this.liveTranscript = '';

      let mimeType = 'audio/webm';
      if (!MediaRecorder.isTypeSupported('audio/webm')) {
        if (MediaRecorder.isTypeSupported('audio/mp4')) mimeType = 'audio/mp4';
        else if (MediaRecorder.isTypeSupported('audio/ogg')) mimeType = 'audio/ogg';
        else mimeType = '';
      }

      this.mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);

      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          this.audioChunks.push(e.data);
        }
      };

      this.mediaRecorder.onstop = () => {
        const audioBlob = new Blob(this.audioChunks, { type: this.mediaRecorder.mimeType || 'audio/webm' });
        const durationSec = Math.round((Date.now() - this.recordingStartTime) / 1000);
        stream.getTracks().forEach(track => track.stop());
        this.handleRecordingComplete(qNum, day, audioBlob, durationSec, this.liveTranscript);
      };

      this.mediaRecorder.start(250);
      this.recordingStartTime = Date.now();

      this.setRecordingUI(qNum, true);
      this.startTimerUI(qNum);
      this.startLiveTranscription(qNum);

    } catch (err) {
      console.error('Error starting audio recording:', err);
      alert('Could not access microphone. Please ensure microphone permissions are granted in your browser.');
      this.setRecordingUI(qNum, false);
      this.currentRecordingQNum = null;
    }
  }

  stopRecording(qNum, day) {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }
    if (this.speechRecognizer) {
      try { this.speechRecognizer.stop(); } catch (e) {}
      this.speechRecognizer = null;
    }
    clearInterval(this.timerInterval);
    this.setRecordingUI(qNum, false);
    this.currentRecordingQNum = null;
  }

  startTimerUI(qNum) {
    clearInterval(this.timerInterval);
    const timerElem = document.getElementById(`rec_time_${qNum}`);
    const timerBox = document.getElementById(`rec_timer_${qNum}`);
    if (timerBox) timerBox.style.display = 'inline-flex';

    this.timerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - this.recordingStartTime) / 1000);
      const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
      const secs = String(elapsed % 60).padStart(2, '0');
      if (timerElem) timerElem.textContent = `${mins}:${secs}`;
    }, 500);
  }

  startLiveTranscription(qNum) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    try {
      this.speechRecognizer = new SpeechRecognition();
      this.speechRecognizer.continuous = true;
      this.speechRecognizer.interimResults = true;
      this.speechRecognizer.lang = 'en-US';

      const transcriptBox = document.getElementById(`transcript_box_${qNum}`);
      const transcriptText = document.getElementById(`transcript_text_${qNum}`);

      if (transcriptBox) transcriptBox.style.display = 'block';

      this.speechRecognizer.onresult = (event) => {
        let interim = '';
        let final = '';
        for (let i = 0; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            final += event.results[i][0].transcript + ' ';
          } else {
            interim += event.results[i][0].transcript;
          }
        }
        this.liveTranscript = (final + interim).trim();
        if (transcriptText) {
          transcriptText.textContent = this.liveTranscript || 'Listening and transcribing your speech...';
        }
      };

      this.speechRecognizer.onerror = (e) => {
        console.warn('Speech recognition error:', e.error);
      };

      this.speechRecognizer.start();
    } catch (e) {
      console.warn('Speech recognition start failed:', e);
    }
  }

  setRecordingUI(qNum, isRecording) {
    const btn = document.getElementById(`btn_rec_${qNum}`);
    const timerBox = document.getElementById(`rec_timer_${qNum}`);

    if (btn) {
      if (isRecording) {
        btn.classList.add('recording-active');
        btn.innerHTML = `<span class="rec-icon">⏹️</span> <span class="rec-label">Stop Recording</span>`;
      } else {
        btn.classList.remove('recording-active');
        btn.innerHTML = `<span class="rec-icon">🎙️</span> <span class="rec-label">Record Response</span>`;
        if (timerBox) timerBox.style.display = 'none';
      }
    }
  }

  async handleRecordingComplete(qNum, day, audioBlob, durationSec, transcript) {
    const record = {
      id: this.getRecordId(qNum),
      track: this.trackId,
      qNum: qNum,
      day: day,
      blob: audioBlob,
      mimeType: audioBlob.type,
      duration: durationSec,
      transcript: transcript || '',
      timestamp: Date.now()
    };

    await this.saveToDB(record);
    this.renderPlaybackUI(qNum, record);
  }

  renderPlaybackUI(qNum, record) {
    const playbackBox = document.getElementById(`playback_box_${qNum}`);
    const audioElem = document.getElementById(`audio_${qNum}`);
    const transcriptBox = document.getElementById(`transcript_box_${qNum}`);
    const transcriptText = document.getElementById(`transcript_text_${qNum}`);
    const transcriptStats = document.getElementById(`transcript_stats_${qNum}`);
    const saveBadge = document.getElementById(`save_status_${qNum}`);

    if (!playbackBox || !audioElem) return;

    const audioUrl = this.getAudioUrl(qNum, record.blob);
    audioElem.src = audioUrl;
    playbackBox.style.display = 'block';

    if (saveBadge) {
      const dateStr = new Date(record.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      saveBadge.innerHTML = `✅ Saved (${record.duration}s • ${dateStr})`;
    }

    if (record.transcript && record.transcript.trim().length > 0) {
      if (transcriptBox) transcriptBox.style.display = 'block';
      if (transcriptText) transcriptText.textContent = `"${record.transcript}"`;
      
      const words = record.transcript.trim().split(/\s+/).length;
      const wpm = record.duration > 0 ? Math.round((words / record.duration) * 60) : 0;
      if (transcriptStats) {
        transcriptStats.innerHTML = `📊 <strong>${words}</strong> words spoken • <strong>${record.duration}</strong>s • Pace: <strong>${wpm}</strong> WPM`;
      }
    } else {
      if (transcriptBox && !this.currentRecordingQNum) {
        transcriptBox.style.display = 'none';
      }
    }
  }

  async deleteRecording(qNum) {
    if (!confirm('Are you sure you want to discard this audio recording?')) return;
    await this.deleteFromDB(qNum);

    const playbackBox = document.getElementById(`playback_box_${qNum}`);
    const audioElem = document.getElementById(`audio_${qNum}`);
    const transcriptBox = document.getElementById(`transcript_box_${qNum}`);

    if (playbackBox) playbackBox.style.display = 'none';
    if (audioElem) audioElem.src = '';
    if (transcriptBox) transcriptBox.style.display = 'none';
  }

  downloadRecording(qNum, day) {
    const record = this.cachedRecordings[qNum];
    if (!record || !record.blob) {
      alert('No recording found to download.');
      return;
    }

    const ext = record.mimeType && record.mimeType.includes('mp4') ? 'mp4' : (record.mimeType && record.mimeType.includes('ogg') ? 'ogg' : 'webm');
    const filename = `ESL_Speaking_${this.trackId.toUpperCase()}_Day${record.day || day}_Q${qNum}_Response.${ext}`;
    
    const a = document.createElement('a');
    a.href = URL.createObjectURL(record.blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  updateRecordingsBadge() {
    const count = Object.keys(this.cachedRecordings).length;
    const badge = document.getElementById('savedRecordingsBadge');
    if (badge) {
      badge.textContent = `🎙️ Saved Responses (${count}/150)`;
      badge.style.display = count > 0 ? 'inline-flex' : 'inline-flex';
    }
  }

  openRecordingsModal() {
    const modal = document.getElementById('recordingsManagerModal');
    if (modal) {
      this.renderRecordingsList();
      modal.classList.add('active');
    }
  }

  closeRecordingsModal() {
    const modal = document.getElementById('recordingsManagerModal');
    if (modal) modal.classList.remove('active');
  }

  renderRecordingsList() {
    const container = document.getElementById('recordingsListContent');
    if (!container) return;

    const records = Object.values(this.cachedRecordings).sort((a, b) => a.qNum - b.qNum);

    if (records.length === 0) {
      container.innerHTML = `
        <div style="text-align:center; padding: 2.5rem 1rem; color: var(--text-muted);">
          <div style="font-size:2.5rem; margin-bottom:0.75rem;">🎙️</div>
          <h4 style="font-family:'Playfair Display',serif; font-size:1.3rem; color:var(--brown-dark); margin-bottom:0.4rem;">No Audio Recordings Yet</h4>
          <p style="font-size:0.92rem;">Click <strong>"Record Answer"</strong> on any speaking question to capture and save your spoken practice!</p>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1.25rem; flex-wrap:wrap; gap:0.75rem;">
        <span style="font-size:0.95rem; font-weight:700; color:var(--brown-dark);">Total Saved Responses: <strong>${records.length}</strong> / 150</span>
        <button class="btn-rec-danger" onclick="recorderManager.clearAllFromDB()">
          🗑️ Clear All Recordings
        </button>
      </div>

      <div style="display:flex; flex-direction:column; gap:1rem; max-height:480px; overflow-y:auto; padding-right:0.5rem;">
        ${records.map(rec => {
          const dateStr = new Date(rec.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
          const audioUrl = this.getAudioUrl(rec.qNum, rec.blob);
          return `
            <div class="saved-rec-item">
              <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:0.6rem; flex-wrap:wrap; gap:0.5rem;">
                <div>
                  <span class="q-tier-tag" style="background:var(--brown-primary); color:#fff; font-size:0.75rem; padding:0.2rem 0.6rem;">Day ${rec.day} • Question #${rec.qNum}</span>
                  <span style="font-size:0.8rem; color:var(--text-light); margin-left:0.5rem;">${dateStr} (${rec.duration}s)</span>
                </div>
                <div style="display:flex; gap:0.4rem;">
                  <button class="btn-action" onclick="recorderManager.downloadRecording(${rec.qNum}, ${rec.day})" title="Download Audio File">
                    💾 Download
                  </button>
                  <button class="btn-action" style="color:#b71c1c;" onclick="recorderManager.deleteRecording(${rec.qNum})" title="Delete Recording">
                    🗑️
                  </button>
                </div>
              </div>

              <audio controls src="${audioUrl}" style="width:100%; height:38px; margin-bottom:0.5rem;"></audio>

              ${rec.transcript ? `
                <div style="background:#fff; border:1px solid var(--brown-border); border-left:3px solid var(--brown-primary); padding:0.6rem 0.85rem; border-radius:4px; font-size:0.88rem; color:var(--text-main); font-style:italic;">
                  "${rec.transcript}"
                </div>
              ` : ''}
            </div>
          `;
        }).join('')}
      </div>
    `;
  }
}
