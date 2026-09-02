# Alfred 通知 → kneecap:新能力 cite-check gate(2026-08-07)

> Alfred 主 session 2026-08-07 建了一個引用綁定驗證 gate,對 kneecap 這種產 IC 級內容的工具直接相關。此檔是知會,不是指令 ,由 kneecap dedicated session + Wei 決定要不要採用/複製。

## 是什麼

**cite-check**:任何帶引用的判斷產出出貨前,驗「每個引用的來源有沒有真的支撐那句話」。三種修法:swap citation / soften 到來源支持的程度 / 刪句,**查不到替代來源就刪,永不硬湊引用**。

實作在 Alfred 本體:
- `Alfred/lib/cite_check.py` ,機械 triage(零成本):抽 (句,引用) 對、數字句必查、抓 dangling(無來源條目)、uncited-numeric、unused sources。
- `Alfred/config/cite_check_agent_prompt.md` ,LLM 驗證 prompt(WebFetch 真來源、隔離作者正文 vs 留言)。
- `Alfred/.claude/skills/cite-check/SKILL.md` + CLAUDE.md rule 27。

來源:從 HyperResearch(jordan-gibbs/hyperresearch)cite-checker 吸收,實跑驗過能抓「引用指向的來源其實不支撐該句」的錯(數字尤其)。

## 為什麼跟 kneecap 相關

kneecap 是 IC copilot ,產的 IC report / 分析若帶引用或數字宣稱,正是這道 gate 的守備範圍。**建議評估:kneecap 的產出流程要不要內建 citation-binding 驗證**(數字必查 + 不支撐就軟化/刪),當作出廠 QC。

## 怎麼採用(三選,Wei/kneecap 決定)

1. 產出時人工套 Alfred 的 `/cite-check` 紀律(讀 SKILL.md 照做)。
2. 把 `lib/cite_check.py` 的機械 triage 邏輯移植進 kneecap(純 Python,無外部依賴)。
3. 把 citation-binding 驗證做成 kneecap app 的一個功能(產品決策)。

有疑問回 Alfred 主 session。
