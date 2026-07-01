// W7 — i18n catalog (EN / 繁中-TW / 日本語). `en` is the source of truth: its
// keys define the MessageKey type, and zh/ja are typed Record<MessageKey,string>
// so tsc FAILS the build if a translation is missing a key — important since we
// can't GUI-test every string. Add keys here, then use them via useT() in
// components. Coverage is filled in surface by surface (chrome first).
//
// Brand tokens ("KN33C4P", "beta") and provider names are intentionally NOT
// translated.

export const en = {
  // Header
  "header.home": "Home",
  "header.settings": "Settings",

  // Sidebar nav
  "nav.newReport": "New report",
  "nav.quickMemo": "Quick Memo",
  "nav.icReport": "Full IC Report",
  "nav.templates": "Templates",
  "nav.settings": "Settings",

  // Sidebar sections
  "sidebar.reports": "Reports",
  "sidebar.noReports": 'No reports yet. Generate one and hit "Save to report".',
  "sidebar.untitledReport": "Untitled report",
  "sidebar.noVersions": "no versions",
  "sidebar.source": "source",
  "sidebar.sources": "sources",
  "sidebar.templatesHeading": "Templates",
  "sidebar.generateFrom": "Generate from",
  "badge.starter": "starter",
  "badge.custom": "custom",
  "sidebar.theme": "Theme",
  "sidebar.language": "Language",

  // Settings — section titles
  "settings.title": "Settings",
  "settings.appearance": "Appearance",
  "settings.language": "Language",
  "settings.languageBody": "Choose the interface language. Your choice is remembered on this Mac.",
  "settings.llmConnection": "LLM Connection",
  "settings.templateEditor": "Template Editor",
  "settings.formatLearning": "Format Learning",
  "settings.about": "About",

  // Common
  "common.back": "← Back",
} as const;

export type MessageKey = keyof typeof en;

export const zh: Record<MessageKey, string> = {
  "header.home": "首頁",
  "header.settings": "設定",

  "nav.newReport": "新報告",
  "nav.quickMemo": "快速備忘錄",
  "nav.icReport": "完整 IC 報告",
  "nav.templates": "範本",
  "nav.settings": "設定",

  "sidebar.reports": "報告",
  "sidebar.noReports": "還沒有報告。生成一份後按「儲存報告」。",
  "sidebar.untitledReport": "未命名報告",
  "sidebar.noVersions": "尚無版本",
  "sidebar.source": "來源",
  "sidebar.sources": "來源",
  "sidebar.templatesHeading": "範本",
  "sidebar.generateFrom": "以此範本生成",
  "badge.starter": "內建",
  "badge.custom": "自訂",
  "sidebar.theme": "主題",
  "sidebar.language": "語言",

  "settings.title": "設定",
  "settings.appearance": "外觀",
  "settings.language": "語言",
  "settings.languageBody": "選擇介面語言。你的選擇會記在這台 Mac 上。",
  "settings.llmConnection": "LLM 連線",
  "settings.templateEditor": "範本編輯器",
  "settings.formatLearning": "格式學習",
  "settings.about": "關於",

  "common.back": "← 返回",
};

export const ja: Record<MessageKey, string> = {
  "header.home": "ホーム",
  "header.settings": "設定",

  "nav.newReport": "新規レポート",
  "nav.quickMemo": "クイックメモ",
  "nav.icReport": "IC レポート(完全版)",
  "nav.templates": "テンプレート",
  "nav.settings": "設定",

  "sidebar.reports": "レポート",
  "sidebar.noReports": "まだレポートがありません。生成して「レポートを保存」を押してください。",
  "sidebar.untitledReport": "無題のレポート",
  "sidebar.noVersions": "バージョンなし",
  "sidebar.source": "ソース",
  "sidebar.sources": "ソース",
  "sidebar.templatesHeading": "テンプレート",
  "sidebar.generateFrom": "このテンプレートで生成",
  "badge.starter": "標準",
  "badge.custom": "カスタム",
  "sidebar.theme": "テーマ",
  "sidebar.language": "言語",

  "settings.title": "設定",
  "settings.appearance": "外観",
  "settings.language": "言語",
  "settings.languageBody": "インターフェースの言語を選びます。この Mac に記憶されます。",
  "settings.llmConnection": "LLM 接続",
  "settings.templateEditor": "テンプレートエディタ",
  "settings.formatLearning": "フォーマット学習",
  "settings.about": "情報",

  "common.back": "← 戻る",
};
