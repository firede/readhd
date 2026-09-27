import { describe, expect, it } from 'vitest';
import {
  pickAutoVoice,
  pickVoice,
  splitSentences,
  TtsPlayer,
  type TtsSynth,
  type TtsVoiceLike,
  type UtteranceLike,
} from '../src/lib/tts';

const texts = (spans: { start: number; end: number }[], s: string) =>
  spans.map((p) => s.slice(p.start, p.end));

describe('splitSentences', () => {
  it('splits on 。！？；!?. and newlines', () => {
    const s = '第一句。第二句！第三句？第四句；第五句\n第六句。';
    const spans = splitSentences(s);
    expect(texts(spans, s)).toEqual([
      '第一句。',
      '第二句！',
      '第三句？',
      '第四句；',
      '第五句\n',
      '第六句。',
    ]);
  });

  it('keeps trailing quotes/brackets with the sentence', () => {
    const s = '他说："你好。"明天见。';
    expect(texts(splitSentences(s), s)).toEqual(['他说："你好。"', '明天见。']);
    const s2 = '（这是补充。）然后呢。';
    expect(texts(splitSentences(s2), s2)).toEqual(['（这是补充。）', '然后呢。']);
  });

  it('handles trailing text without punctuation', () => {
    const s = '有标点。没标点尾巴';
    expect(texts(splitSentences(s), s)).toEqual(['有标点。', '没标点尾巴']);
  });

  it('skips whitespace-only pieces', () => {
    const s = '一。\n\n  \n二。';
    expect(texts(splitSentences(s), s)).toEqual(['一。', '二。']);
  });
});

const v = (
  name: string,
  lang = 'zh-CN',
  localService = true,
): TtsVoiceLike => ({
  name,
  voiceURI: name,
  lang,
  localService,
});

const ZH_CN: TtsVoiceLike = v('Tingting', 'zh-CN', true);
const ZH_TW: TtsVoiceLike = v('Sinji', 'zh-TW', false);
const EN: TtsVoiceLike = v('Samantha', 'en-US', true);

describe('pickVoice', () => {
  it('prefers explicit voiceURI', () => {
    expect(pickVoice([ZH_TW, ZH_CN], ZH_TW.voiceURI)).toBe(ZH_TW);
  });
});

describe('pickAutoVoice', () => {
  it('macOS list: Yue wins over Eddy/Tingting/novelty voices', () => {
    const macos = [
      v('Eddy (中文（中国大陆）)'),
      v('Tingting'),
      v('Yue (Premium)'),
      v('Grandma (中文（中国大陆）)'),
      v('Shelley (中文（中国大陆）)'),
      v('Rocko (中文（中国大陆）)'),
    ];
    expect(pickAutoVoice(macos)?.name).toBe('Yue (Premium)');
  });

  it('macOS list without Yue: Tingting next', () => {
    const macos = [v('Eddy'), v('Tingting'), v('Grandma')];
    expect(pickAutoVoice(macos)?.name).toBe('Tingting');
  });

  it('Edge list: Xiaoxiao Online (Natural) preferred', () => {
    const edge = [
      v('Microsoft Yunxi Online (Natural)', 'zh-CN', false),
      v('Microsoft Xiaoxiao Online (Natural)', 'zh-CN', false),
      v('Microsoft Yunyang Online (Natural)', 'zh-CN', false),
    ];
    expect(pickAutoVoice(edge)?.name).toBe(
      'Microsoft Xiaoxiao Online (Natural)',
    );
  });

  it('Edge list without Xiaoxiao: other Microsoft zh-CN neural', () => {
    const edge = [
      v('Microsoft Yunxi Online (Natural)', 'zh-CN', false),
      v('Microsoft HsiaoChen Online (Natural)', 'zh-TW', false),
    ];
    expect(pickAutoVoice(edge)?.name).toBe(
      'Microsoft Yunxi Online (Natural)',
    );
  });

  it('Chrome Windows list: prefers Huihui/Yaoyao/Kangkang among local zh-CN', () => {
    const win = [
      v('Microsoft Zira', 'en-US'),
      v('Microsoft Huihui', 'zh-CN'),
      v('Microsoft Lili', 'zh-CN'),
    ];
    expect(pickAutoVoice(win)?.name).toBe('Microsoft Huihui');
  });

  it('local zh-CN fallback: first non-novelty when no huihui/yaoyao/kangkang', () => {
    const vs = [v('Eddy'), v('Lili'), v('Meijia')];
    expect(pickAutoVoice(vs)?.name).toBe('Lili');
  });

  it('Google zh-CN voice picked before generic zh-*', () => {
    const vs = [
      v('Sinji', 'zh-TW', false),
      v('Google 普通话', 'zh-CN', false),
    ];
    expect(pickAutoVoice(vs)?.name).toBe('Google 普通话');
  });

  it('other zh-CN beats zh-* from other regions', () => {
    const vs = [v('Sinji', 'zh-TW'), v('Lili', 'zh-CN', false)];
    expect(pickAutoVoice(vs)?.name).toBe('Lili');
  });

  it('only novelty voices: still returns one', () => {
    const vs = [v('Eddy'), v('Grandma'), v('Rocko')];
    expect(pickAutoVoice(vs)?.name).toBe('Eddy');
  });

  it('no zh voice: null', () => {
    expect(pickAutoVoice([v('Samantha', 'en-US')])).toBeNull();
  });
});

class FakeSynth implements TtsSynth {
  spoken: UtteranceLike[] = [];
  cancelled = 0;
  paused = 0;
  resumed = 0;
  voices: TtsVoiceLike[];
  constructor(voices: TtsVoiceLike[]) {
    this.voices = voices;
  }
  speak(u: UtteranceLike) {
    this.spoken.push(u);
  }
  cancel() {
    this.cancelled++;
  }
  pause() {
    this.paused++;
  }
  resume() {
    this.resumed++;
  }
  getVoices() {
    return this.voices;
  }
}

function fakeUtt(text: string): UtteranceLike {
  return {
    text,
    lang: '',
    rate: 1,
    voice: null,
    onboundary: null,
    onend: null,
    onerror: null,
  };
}

function makePlayer(
  voices: TtsVoiceLike[],
  cb: ConstructorParameters<typeof TtsPlayer>[4] = {},
) {
  const synth = new FakeSynth(voices);
  const player = new TtsPlayer(synth, fakeUtt, 0.9, '', cb);
  return { synth, player };
}

describe('TtsPlayer', () => {
  it('queues all sentences of all paragraphs in order', async () => {
    const seen: [number, number, number][] = [];
    const { synth, player } = makePlayer([ZH_CN], {
      onSentence: (pi, s, e) => seen.push([pi, s, e]),
    });
    player.setQueue(['第一句。第二句。', '第三句。']);
    await player.play(0);
    expect(synth.spoken.map((u) => u.text)).toEqual(['第一句。']);
    // finish first → next sentence
    synth.spoken[0]!.onend!();
    expect(synth.spoken.map((u) => u.text)).toEqual(['第一句。', '第二句。']);
    synth.spoken[1]!.onend!();
    synth.spoken[2]!.onend!();
    expect(seen).toEqual([
      [0, 0, 4],
      [0, 4, 8],
      [1, 0, 4],
    ]);
    expect(player.getState()).toBe('stopped');
  });

  it('word boundary callback maps to absolute index', async () => {
    const words: [number, number][] = [];
    const { synth, player } = makePlayer([ZH_CN], {
      onWord: (pi, i) => words.push([pi, i]),
    });
    player.setQueue(['小明去学校。']);
    await player.play(0);
    synth.spoken[0]!.onboundary!({ name: 'word', charIndex: 2 });
    expect(words).toEqual([[0, 2]]);
  });

  it('pause/resume/stop update state and synth', async () => {
    const { synth, player } = makePlayer([ZH_CN]);
    player.setQueue(['一句。两句。']);
    await player.play(0);
    player.pause();
    expect(synth.paused).toBe(1);
    player.resume();
    expect(synth.resumed).toBe(1);
    player.stop();
    expect(synth.cancelled).toBeGreaterThan(0);
    expect(player.getState()).toBe('stopped');
  });

  it('jumpTo while playing speaks that sentence', async () => {
    const { synth, player } = makePlayer([ZH_CN]);
    player.setQueue(['一。二。三。']);
    await player.play(0);
    player.jumpTo(2);
    expect(synth.spoken.at(-1)!.text).toBe('三。');
  });

  it('no zh voice -> onNoVoice and stopped', async () => {
    let noVoice = false;
    const { synth, player } = makePlayer([EN], {
      onNoVoice: () => {
        noVoice = true;
      },
    });
    player.setQueue(['你好。']);
    await player.play(0);
    expect(noVoice).toBe(true);
    expect(synth.spoken.length).toBe(0);
    expect(player.getState()).toBe('stopped');
  });

  it('ignores interrupted/canceled errors', async () => {
    const { synth, player } = makePlayer([ZH_CN]);
    player.setQueue(['一。二。']);
    await player.play(0);
    synth.spoken[0]!.onerror!({ error: 'interrupted' });
    expect(player.getState()).toBe('playing');
  });
});
