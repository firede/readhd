// Authored UI copy — keep verbatim.

export const TIP_CHUNK =
  '意群是几个词组成的小短语，可以一口气读下来，比如“每天清晨 | 可爱的小狐狸 | 都会去溪边 | 喝水”。按意群换颜色，能帮孩子看清句子的结构，适合认字基本过关、但长句子读不顺的中高年级孩子。需要配置模型服务；没有配置时会自动按词显示。';
export const TIP_WORD =
  '按词换颜色，比如“每天 | 清晨 | 可爱 | 的 | 小狐狸”。中文词与词之间没有空格，颜色能帮孩子看出哪几个字是一个词，适合刚开始独立阅读、认字还比较吃力的孩子。';
export const NOTE_COLOR = '颜色只用来区分边界，不代表词的种类。';
export const TIP_FADE =
  '把“的、了、着、过、吗、呢”这类助词和语气词变浅，让有实际意思的词更突出。效果因人而异，建议试用一段时间再决定。';
export const TIP_RULER = '把其他行调暗，只留下鼠标所在的一两行，帮助视线不串行。';
const HELP_READER_PREFIX =
  '把网页正文提取出来重新排版：更大的字、更短的行、没有广告干扰，还可以朗读。';
export function helpReader(shortcut: string | null): string {
  return shortcut
    ? `${HELP_READER_PREFIX}快捷键 ${shortcut}，按 Esc 退出。`
    : `${HELP_READER_PREFIX}按 Esc 退出。`;
}
export const SHORTCUT_UNBOUND =
  '未设置快捷键，可以在 chrome://extensions/shortcuts 里设置';
export const TIP_GAP =
  '在词或意群之间加一点空隙。有研究发现加空隙对一部分孩子有帮助，但也有孩子不习惯；不习惯的话，只用颜色区分就好。';
export const HELP_TTS =
  '一句一句地朗读，正在读的句子会高亮。点一下任意句子，就从那里开始读。';
export const NOTE_PRIVACY =
  '开启模型分析后，网页上的中文段落会发送给你选择的模型服务商进行分析。API Key 只保存在这台电脑的浏览器里，不会同步到其他设备，也不会发送给服务商以外的任何地方。';
export const NOTE_USAGE =
  '这里记录每次分析使用的模型和 token 数量，方便你心里有数。实际费用请以服务商账单为准。';
export const ABOUT_TEXT =
  'ReadHD 通过调整网页文字的颜色和排版，帮助有阅读困难的孩子更顺畅地阅读中文。它是阅读的辅助工具，不能代替专业的评估和训练。';
