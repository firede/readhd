import { useEffect, useState } from 'react';
import { ttsRate, ttsVoice } from '../../lib/settings';
import { HELP_TTS } from '../../ui/copy';

const TTS_SAMPLE = '小明在花盆里种下了三颗豆子。';

function zhVoices(): SpeechSynthesisVoice[] {
  return speechSynthesis
    .getVoices()
    .filter((v) => v.lang.replace('_', '-').toLowerCase().startsWith('zh'));
}

export function TtsSection() {
  const [voice, setVoice] = useState('');
  const [rate, setRate] = useState(0.9);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    void ttsVoice.getValue().then(setVoice);
    void ttsRate.getValue().then(setRate);
    const load = () => setVoices(zhVoices());
    load();
    speechSynthesis.addEventListener('voiceschanged', load);
    return () => speechSynthesis.removeEventListener('voiceschanged', load);
  }, []);

  function preview() {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(TTS_SAMPLE);
    u.lang = 'zh-CN';
    u.rate = rate;
    const v = voices.find((x) => x.voiceURI === voice);
    if (v) u.voice = v;
    speechSynthesis.speak(u);
  }

  return (
    <div>
      <h2>朗读</h2>
      <p className="rh-muted">{HELP_TTS}</p>
      <div className="ffield">
        <label htmlFor="voice">朗读语音</label>
        <select
          id="voice"
          value={voice}
          onChange={(e) => {
            setVoice(e.target.value);
            void ttsVoice.setValue(e.target.value);
          }}
        >
          <option value="">自动</option>
          {voices.map((v) => (
            <option key={v.voiceURI} value={v.voiceURI}>
              {v.name}（{v.lang}）
            </option>
          ))}
        </select>
      </div>
      <div className="ffield">
        <label htmlFor="rate">语速 {rate.toFixed(2)}</label>
        <input
          id="rate"
          type="range"
          min="0.5"
          max="1.5"
          step="0.05"
          value={rate}
          onChange={(e) => {
            const v = Number(e.target.value);
            setRate(v);
            void ttsRate.setValue(v);
          }}
        />
      </div>
      <button className="rh-btn" onClick={preview}>
        试听
      </button>
    </div>
  );
}
