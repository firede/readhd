// Read-aloud: sentence splitting + a queue-based player over an injectable
// speech synth (unit-testable; the content script wires speechSynthesis).

export interface SentenceSpan {
  start: number;
  end: number;
}

const TERMINATORS = new Set('。！？；…!?;\n'.split(''));
const CLOSERS = new Set('”’」』）》）〉】〕〗〙〛—"\''.split(''));

/** Split text into sentence spans; trailing closers stay with the sentence. */
export function splitSentences(text: string): SentenceSpan[] {
  const out: SentenceSpan[] = [];
  let start = 0;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i]!;
    i++;
    if (TERMINATORS.has(ch)) {
      while (i < n && CLOSERS.has(text[i]!)) i++;
      let s = start;
      while (s < i && /\s/u.test(text[s]!)) s++;
      if (s < i) out.push({ start: s, end: i });
      start = i;
    }
  }
  if (start < n) {
    let s = start;
    while (s < n && /\s/u.test(text[s]!)) s++;
    if (s < n) out.push({ start: s, end: n });
  }
  return out;
}

export interface TtsVoiceLike {
  voiceURI: string;
  lang: string;
  localService: boolean;
}

export interface UtteranceLike {
  text: string;
  lang: string;
  rate: number;
  voice: TtsVoiceLike | null;
  onboundary: ((e: { name: string; charIndex: number }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
}

export interface TtsSynth {
  speak(u: UtteranceLike): void;
  cancel(): void;
  pause(): void;
  resume(): void;
  getVoices(): TtsVoiceLike[];
  /** Resolve when voices may have changed (voiceschanged); optional. */
  onVoicesChanged?: (cb: () => void) => void;
}

export type TtsState = 'playing' | 'paused' | 'stopped';

export interface TtsCallbacks {
  onSentence?: (paragraphIdx: number, start: number, end: number) => void;
  onWord?: (paragraphIdx: number, absIndex: number) => void;
  onState?: (s: TtsState) => void;
  /** No usable zh voice — caller should surface "没有找到中文语音". */
  onNoVoice?: () => void;
}

export interface QueueItem {
  paragraphIdx: number;
  start: number;
  end: number;
  text: string;
}

/** Pure: pick a voice per the preference order. */
export function pickVoice(
  voices: TtsVoiceLike[],
  voiceURI: string,
): TtsVoiceLike | null {
  if (voiceURI) {
    const v = voices.find((x) => x.voiceURI === voiceURI);
    if (v) return v;
  }
  return (
    voices.find(
      (v) => v.lang.replace('_', '-').startsWith('zh-CN') && v.localService,
    ) ??
    voices.find((v) => v.lang.replace('_', '-').startsWith('zh')) ??
    null
  );
}

export class TtsPlayer {
  private queue: QueueItem[] = [];
  private idx = 0;
  private state: TtsState = 'stopped';
  private currentUtt: UtteranceLike | null = null;

  constructor(
    private synth: TtsSynth,
    private makeUtterance: (text: string) => UtteranceLike,
    private rate: number,
    private voiceURI: string,
    private cb: TtsCallbacks,
  ) {}

  getState(): TtsState {
    return this.state;
  }

  setQueue(paragraphTexts: string[]): void {
    this.queue = [];
    paragraphTexts.forEach((t, paragraphIdx) => {
      for (const s of splitSentences(t)) {
        this.queue.push({
          paragraphIdx,
          start: s.start,
          end: s.end,
          text: t.slice(s.start, s.end),
        });
      }
    });
    this.idx = 0;
  }

  /** Queue index of the sentence containing paragraph offset `off`. */
  sentenceIndexAt(paragraphIdx: number, off: number): number {
    return this.queue.findIndex(
      (q) => q.paragraphIdx === paragraphIdx && off >= q.start && off < q.end,
    );
  }

  private setState(s: TtsState): void {
    this.state = s;
    this.cb.onState?.(s);
  }

  private async resolveVoice(): Promise<TtsVoiceLike | null> {
    let voices = this.synth.getVoices();
    if (voices.length === 0 && this.synth.onVoicesChanged) {
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, 2000);
        this.synth.onVoicesChanged!(() => {
          clearTimeout(t);
          resolve();
        });
      });
      voices = this.synth.getVoices();
    }
    return pickVoice(voices, this.voiceURI);
  }

  async play(fromIndex?: number): Promise<void> {
    this.synth.cancel();
    if (fromIndex != null && fromIndex >= 0) this.idx = fromIndex;
    if (this.queue.length === 0 || this.idx >= this.queue.length) {
      this.setState('stopped');
      return;
    }
    const voice = await this.resolveVoice();
    if (!voice) {
      this.setState('stopped');
      this.cb.onNoVoice?.();
      return;
    }
    this.setState('playing');
    this.speakCurrent(voice);
  }

  pause(): void {
    if (this.state !== 'playing') return;
    this.synth.pause();
    this.setState('paused');
  }

  resume(): void {
    if (this.state !== 'paused') return;
    this.synth.resume();
    this.setState('playing');
  }

  stop(): void {
    this.synth.cancel();
    this.idx = 0;
    this.currentUtt = null;
    this.setState('stopped');
  }

  jumpTo(index: number): void {
    if (index < 0 || index >= this.queue.length) return;
    this.idx = index;
    if (this.state === 'playing') {
      this.synth.cancel();
      const voice = this.currentUtt?.voice ?? null;
      this.speakCurrent(voice);
    }
  }

  private speakCurrent(voice: TtsVoiceLike | null): void {
    const item = this.queue[this.idx];
    if (!item || this.state !== 'playing') return;
    this.cb.onSentence?.(item.paragraphIdx, item.start, item.end);
    const utt = this.makeUtterance(item.text);
    utt.lang = 'zh-CN';
    utt.rate = this.rate;
    utt.voice = voice;
    utt.onboundary = (e) => {
      if (e.name === 'word') {
        this.cb.onWord?.(item.paragraphIdx, item.start + e.charIndex);
      }
    };
    utt.onend = () => {
      if (this.state !== 'playing') return;
      this.idx++;
      if (this.idx >= this.queue.length) {
        this.setState('stopped');
      } else {
        this.speakCurrent(voice);
      }
    };
    utt.onerror = (e) => {
      if (e?.error === 'interrupted' || e?.error === 'canceled') return;
      utt.onend?.();
    };
    this.currentUtt = utt;
    this.synth.speak(utt);
  }
}
