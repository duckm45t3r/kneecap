# KN33C4P — Propose: MarkItDown 整合評估(2026-07-01)

> **Handoff 檔**:Alfred(chief-of-staff session)準備,交 kneecap dedicated session 執行決策。
> **本檔性質**:propose + PoC spec,非 authoritative。決策拍板後 update STATE.md,PoC 執行由 kneecap session 動。
> **Alfred 邊界**:CSO 準備 context/propose/PoC spec,**不代替 dedicated session 執行 PoC 或 code**。

---

## 觸發來源

- **Inbox**:2026-06-27 line message(from Ue0422)「評估看看這個開源資料能不能導入給 kneecap 用」+ IG reel `DaFh8lpzKkm`(iamlily.genai)
- **內容**:iamlily.genai 影片主打「上傳 PDF 給 Claude 之前先知道這件事!」,推薦**微軟開源 MarkItDown**(GitHub 14K stars),號稱省 ~70% token,有 **MCP 整合 Claude Desktop 自動背景轉檔**
- **Alfred review**:2026-07-01 完成 caption 完整讀取 + repo 事實核查 + 對 kneecap STATE.md 交叉比對,寫本檔

---

## MarkItDown 事實核查

- **Repo**:https://github.com/microsoft/markitdown
- **License**:MIT
- **語言**:Python(CLI + Python API + MCP server)
- **功能**:把 PDF / Word / Excel / PowerPoint / 圖片(有 OCR 選項)/ YouTube URL → 乾淨 Markdown
- **核心特徵**:**保留結構**(標題階層 / 表格對齊 / 清單 / 程式碼塊)—— 不是純 text dump
- **原生 MCP server**:官方提供 MCP wrapper,可接 Claude Desktop 自動背景轉檔(**注意:是 Claude Desktop,不是 Tauri 桌面 app;對 kneecap fit 不好,見「整合路徑」)
- **不做**:標準流程不做 OCR(掃描 PDF 沒解);對加密/受保護 PDF 也吃不了
- **iamlily 講的省 70% token 數字**:是**寬鬆 case**(結構複雜的 PDF),典型 case 大約 30-50% 保守估算

---

## kneecap 現況 gap(對照 STATE_2026-06-26.md)

### Gap 1:Text-only provider PDF 品質差

STATE.md PDF 讀取表格明列:
| Provider | PDF mode | image PDF? |
|---|---|---|
| Nvidia / Nemotron `nvidia/llama-3.3-nemotron-super-49b-v1` | extracted text only | ❌ image PDFs |
| Local Ollama | extracted text only | ❌ image PDFs |

「extracted text only」目前是**土法排版全丟 LLM**,結構(標題/表格/清單)不保留。**對 BYO 免費 Nemotron 使用者 = 明擺次級體驗**。

### Gap 2:Hosted 成本主因 = source × 5 sections 重送

STATE.md 明講「10 頁 IC 成本 ~$0.4(單 deck)~ $1.7(big data room),主要成本 = source × 5 sections;5× 重送是 pending caching 優化」。**$20/月/user soft ceiling 內能塞的 report 數受限於此**。

### Gap 3:Vision provider 對 text-based PDF 也有 token 浪費

Sonnet / Gemini 的 vision token 貴。但 **大部分 pitch deck 是 text-based PDF(不是掃描)**,對這些走 vision 是 overkill。

---

## MarkItDown 對 kneecap 的三條 fit 收益

### 收益 1:Text-only provider 品質翻倍(對 Nemotron/Ollama 用戶)

**現在**:Nemotron / Ollama 拿到亂七八糟 text dump → 品質差

**加 MarkItDown 後**:同樣 text-only provider 拿到 **結構化 markdown**(標題階層 / 表格 / 清單保留)。LLM parse 品質可能大幅提升(**估**:對表格重的 pitch deck 可能 30-60% quality gain,無實測)。

**Impact**:免費 provider tier 從「將就用」升「真的堪用」。對 kneecap 免費 tier 敘事影響大。

### 收益 2:Hosted 直接壓成本($1.7 case 可能壓到 $0.5-1.0)

**Big data room case** 是 hosted 成本主要痛點。MarkItDown preprocess 後:
- 同樣內容 markdown token 數比 raw PDF text 少 30-70%
- **5 sections 重送每次都省**(caching 是正交優化,兩條可疊加)

**Impact**:$20/月 soft ceiling 內能塞的 IC memo 從「≥80」提升至「≥120-140」。單用戶 monthly capacity 直接 up。

**注意**:單 deck $0.4 case 影響有限(小份 PDF preprocessing overhead vs 節省相抵),**big data room 才是 MarkItDown 收益 sweet spot**。

### 收益 3:Vision provider 對 text-based PDF 也可省 token

若 kneecap 加一層「PDF 是 text-based 還 scanned」判斷:
- text-based → MarkItDown preprocess → 送 Sonnet/Gemini text mode
- scanned → 直接 vision

**Impact**:Sonnet vision token 是 kneecap hosted 底層直接成本項,text-based PDF(絕大多數 pitch deck)可壓一大截。

---

## 三個 caveat(不能無視)

### Caveat 1:掃描/圖像 PDF MarkItDown 沒解

MarkItDown 標準流程不做 OCR。**掃描 pitch deck 必須繼續走 vision provider**。STATE.md 表格既有 ❌ 不會被解決 —— 但 MarkItDown **不會讓它更糟,它是額外一層不是取代**。

若要解掃描:MarkItDown 有 optional OCR extension(Azure Document Intelligence 或 Tesseract),但那是另一整條 dependency chain,不建議 phase 1 引入。

### Caveat 2:Rust/JS ↔ Python 語言邊界

kneecap 是 Tauri(Rust + JS)+ Ollama(subprocess)stack。MarkItDown 是 Python。整合有語言邊界成本,見「整合路徑」章。

### Caveat 3:有些 PDF metadata / 特殊排版吃不了

罕見 case(embedded fonts / 掃描-text hybrid / 特殊 form 結構)MarkItDown 也吃不好,需 fallback 到現有 text 抽取。**不是 showstopper,是 minor 邊界處理**。

---

## 三條整合路徑 trade-off(給 kneecap dedicated session 拍)

### 路徑 A:Subprocess spawn Python `markitdown` CLI

**how**:kneecap Rust 端 spawn `markitdown input.pdf` subprocess,capture stdout markdown。
**優點**:
- 最簡單快速上線
- MarkItDown upstream 更新自動吃到
- 已跟 Ollama subprocess pattern 同構,工程慣性低
**缺點**:
- 用戶要裝 Python(或 kneecap bundle Python runtime → app size +20-40MB)
- 冷啟動有 Python interpreter 開銷(~200-500ms)
**適合場景**:phase 1 快速驗證 + MVP;Bundle 若不能接受可延到 phase 2

### 路徑 B:MarkItDown 官方 MCP server

**how**:接 MarkItDown 官方 MCP server,走 MCP 協議通訊。
**優點**:
- 有官方支援 + upstream 維護
- 未來 MCP 生態擴張可 reuse
**缺點**:
- **MCP 主要對 Claude Desktop use case**,kneecap **不是** Claude Desktop 而是 Tauri 自己的 app,MCP 客戶端需要另接
- 多一層 protocol 開銷
- 對 kneecap 敘事的價值低(不會出現在 kneecap 廣告文案上)
**適合場景**:**不推**;iamlily 講的 MCP 整合是 Claude Desktop 場景,誤導到 kneecap 場景會多 hop

### 路徑 C:Rust / JS 純 port

**how**:找 Rust / JS 現有 lib 拼 MarkItDown 覆蓋面(`pdf-parse` / `docx4js` / `xlsx.js` 等)。
**優點**:
- App 精簡,無 Python 依賴
- 冷啟動快
- Long-term 最乾淨
**缺點**:
- 沒單一 lib 覆蓋 MarkItDown 全部格式(PDF+Word+Excel+PPT+YouTube),需自組
- 品質不一定跟得上 MarkItDown upstream
- 工程量大(1-2 週對照 phase 1 A 的 1-2 天)
**適合場景**:phase 2 optimization,phase 1 快速驗證後再投資

---

## PoC spec(給 kneecap dedicated session 執行,Alfred 不做)

### PoC 目的

用**真數據**證明 MarkItDown 對 kneecap 有實質收益,而非 marketing claim。決策依據:token 節省 % + 品質 preservation + 實作成本。

### PoC 輸入樣本(kneecap session 準備 3 份)

1. **Text-based pitch deck PDF**(10-20 頁,含表格 + 清單) — 常見 case,收益 sweet spot
2. **Big data room PDF**(50+ 頁,含 financial model 表格 + market analysis 段落) — hosted $1.7 case 對應
3. **Scanned pitch deck PDF**(掃描/圖像格式)— confirm MarkItDown 對這條無解,不會 regression

### PoC 步驟(kneecap session 執行)

**Step 1:安裝 + 基準測試**
```bash
pip install markitdown
# 對 3 份 PDF 各跑
markitdown sample_1.pdf > sample_1.md
markitdown sample_2.pdf > sample_2.md
markitdown sample_3.pdf > sample_3.md  # 應該無 text 或極少
```

**Step 2:token 對照**(用 tiktoken 或 anthropic tokenizer)
```
raw text 抽取 vs markdown 版
    → token 差 %(收益 1 硬指標)
```

**Step 3:品質 preservation 眼球檢查**
- 表格對齊?
- 標題階層?
- 清單保留?

**Step 4:kneecap eval(關鍵)**
用 kneecap 現有 IC report 生成流程跑 3 組:
- **對照組 A**:直接送 raw PDF text 給 Nemotron(現況)
- **實驗組 B**:MarkItDown preprocess 後送 Nemotron
- **對照組 C**:直接送原 PDF 給 Sonnet vision(當品質 upper bound)

生成 IC report,**眼球比對 5 sections 內容完整度 + 準確度**。

### PoC 交付物

1. **`notes/POC_MARKITDOWN_RESULTS_2026_07_xx.md`**:token 節省表 + 品質對照 + 3 條整合路徑推薦
2. **PoC 結論**:go / no-go / conditional-go 三選一 + 若 go 挑哪條整合路徑

### PoC 工程量估算

- Python setup + 3 sample 準備:0.5 天
- Token 對照 + 眼球 preservation:0.5 天
- kneecap eval + IC report 生成對照:1 天
- 寫 results 檔:0.5 天
- **總計 2-3 天**

---

## 開放項(kneecap dedicated session 拍板)

- [ ] **PoC 起跑時機**:插隊當前 sprint,還是排在 W6+?(建議:插隊,因為對 hosted 經濟直接影響,長痛不如短痛)
- [ ] **樣本來源**:從 VHS 現有 IC report 用過的 pitch deck 抽 3 份(有真實 eval baseline),還是找 public deck?
- [ ] **PoC eval judge**:眼球 vs LLM-as-judge(Sonnet / Opus 當 judge 比對三組輸出)—— 後者更客觀但多 hosted 成本
- [ ] **若 PoC go**:phase 1 走路徑 A(Python subprocess bundle),還是先 flag ROADMAP 到 phase 2 再看?

---

## 對 kneecap 敘事的 bonus(非必要但值得知道)

- **對外可講的變化**:「kneecap 免費 tier(BYO Nemotron / Ollama)PDF 品質對齊 hosted vision provider」= 敘事上的 free tier 升級,對 VHS 定價敘事有幫助
- **對 VHS 敘事**:「我們用微軟開源的 MarkItDown 做 preprocessing」= 站在 Microsoft 開源生態肩膀上,不是關起門造輪子

---

## 對 STATE.md 的預期 update(若 PoC go 後)

- PDF 讀取表格加 column「preprocess with MarkItDown?」
- Text-only provider(Nemotron/Ollama)⚠️/❌ 部分升 ✅(依據 PoC 品質對照)
- Hosted 經濟章加一句「MarkItDown preprocessing 對 big data room case 可壓 30-60% source token」

---

**檔案 owner(準備)**:Alfred(CSO,chief-of-staff session)
**建立日期**:2026-07-01
**決策 owner**:Wei + kneecap dedicated session
**下次動作**:kneecap dedicated session 開起來後 review 本檔 → 拍 4 個開放項 → 執行 PoC → 寫 results 檔 → update STATE.md
