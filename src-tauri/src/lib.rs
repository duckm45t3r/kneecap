// KN33C4P backend — Tauri commands.
//
// W2.1: API key storage via macOS Keychain (keyring crate) + real connection
//       tests against Anthropic / OpenAI hello-world endpoints.
// W2.2: URL fetch + Quick Memo single-shot LLM call.
// W2.3+: Full IC Report multi-step, format learning, local model, VHS-hosted.

use keyring::Entry;
use serde::{Deserialize, Serialize};

const KEYRING_SERVICE: &str = "capital.vhs.kneecap";
const SUPPORTED_PROVIDERS: &[&str] = &["anthropic", "openai"];

// ─── API key storage (macOS Keychain) ────────────────────────────────

#[tauri::command]
fn save_api_key(provider: String, key: String) -> Result<(), String> {
    if !SUPPORTED_PROVIDERS.contains(&provider.as_str()) {
        return Err(format!("Unsupported provider: {}", provider));
    }
    let trimmed = key.trim();
    if trimmed.is_empty() {
        return Err("Empty key".to_string());
    }
    let entry = Entry::new(KEYRING_SERVICE, &provider).map_err(|e| e.to_string())?;
    entry.set_password(trimmed).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn delete_api_key(provider: String) -> Result<(), String> {
    let entry = Entry::new(KEYRING_SERVICE, &provider).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn list_configured_providers() -> Vec<String> {
    let mut out = Vec::new();
    for p in SUPPORTED_PROVIDERS {
        if let Ok(entry) = Entry::new(KEYRING_SERVICE, p) {
            if entry.get_password().is_ok() {
                out.push((*p).to_string());
            }
        }
    }
    out
}

fn read_key(provider: &str) -> Result<String, String> {
    let entry = Entry::new(KEYRING_SERVICE, provider).map_err(|e| e.to_string())?;
    entry.get_password().map_err(|e| match e {
        keyring::Error::NoEntry => "No key on file".to_string(),
        other => other.to_string(),
    })
}

// ─── Connection test (real API call, 8-token hello) ──────────────────

#[derive(Serialize)]
struct ChatMsg<'a> {
    role: &'a str,
    content: &'a str,
}

#[derive(Serialize)]
struct TestReq<'a> {
    model: &'a str,
    max_tokens: u32,
    messages: Vec<ChatMsg<'a>>,
}

#[tauri::command]
async fn test_connection(provider: String) -> Result<String, String> {
    let key = read_key(&provider)?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;

    match provider.as_str() {
        "anthropic" => {
            let body = TestReq {
                model: "claude-haiku-4-5-20251001",
                max_tokens: 8,
                messages: vec![ChatMsg {
                    role: "user",
                    content: "Reply with the single word: ok",
                }],
            };
            let res = client
                .post("https://api.anthropic.com/v1/messages")
                .header("x-api-key", &key)
                .header("anthropic-version", "2023-06-01")
                .header("content-type", "application/json")
                .json(&body)
                .send()
                .await
                .map_err(|e| format!("Network: {}", e))?;
            handle_test_response(res).await
        }
        "openai" => {
            let body = TestReq {
                model: "gpt-4o-mini",
                max_tokens: 8,
                messages: vec![ChatMsg {
                    role: "user",
                    content: "Reply with the single word: ok",
                }],
            };
            let res = client
                .post("https://api.openai.com/v1/chat/completions")
                .bearer_auth(&key)
                .header("content-type", "application/json")
                .json(&body)
                .send()
                .await
                .map_err(|e| format!("Network: {}", e))?;
            handle_test_response(res).await
        }
        other => Err(format!("Unknown provider: {}", other)),
    }
}

async fn handle_test_response(res: reqwest::Response) -> Result<String, String> {
    let status = res.status();
    if status.is_success() {
        Ok("ok".to_string())
    } else {
        let body = res.text().await.unwrap_or_default();
        let trimmed: String = body.chars().take(240).collect();
        Err(format!("HTTP {}: {}", status.as_u16(), trimmed))
    }
}

// ─── Quick Memo (W2.2) ───────────────────────────────────────────────
//
// Single round-trip: optional URL fetch + one LLM call that turns the source
// material into a ~2-page memo. The prompt is intentionally generic in W2.2;
// W2.3 brings the format-learning loop that lets the user inject firm voice.

#[derive(Deserialize)]
pub struct QuickMemoInput {
    pub provider: String,
    /// Either a URL (we fetch + extract text) or raw text the user pasted in.
    pub url: Option<String>,
    pub seed_text: Option<String>,
    /// Free-form: "company name", "industry", "what you care about".
    pub note: Option<String>,
}

#[derive(Serialize)]
pub struct QuickMemoOutput {
    pub memo: String,
    pub source_excerpt: String,
}

#[tauri::command]
async fn fetch_url_text(url: String) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .user_agent("KN33C4P/0.1 (https://vhs.capital)")
        .build()
        .map_err(|e| e.to_string())?;
    let res = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Fetch: {}", e))?;
    if !res.status().is_success() {
        return Err(format!("HTTP {} from {}", res.status().as_u16(), url));
    }
    let html = res.text().await.map_err(|e| e.to_string())?;
    Ok(strip_html_naive(&html))
}

/// Naive HTML → text. Drops <script>/<style>/<noscript>, collapses tags to
/// spaces, keeps runs of visible text. Good enough for W2.2 (the LLM is fine
/// with mild noise). W2.3 can swap in a proper readability extractor.
fn strip_html_naive(html: &str) -> String {
    let lower = html.to_lowercase();
    let bytes = html.as_bytes();
    let lower_bytes = lower.as_bytes();
    let mut cleaned = String::with_capacity(html.len() / 2);
    let mut i = 0;
    let mut in_tag = false;
    let mut skip_until: Option<&[u8]> = None;

    while i < bytes.len() {
        if let Some(end_tag) = skip_until {
            if i + end_tag.len() <= lower_bytes.len()
                && &lower_bytes[i..i + end_tag.len()] == end_tag
            {
                skip_until = None;
                i += end_tag.len();
                continue;
            }
            i += 1;
            continue;
        }
        let b = bytes[i];
        if b == b'<' {
            for (open, close) in [
                (b"<script".as_slice(), b"</script>".as_slice()),
                (b"<style".as_slice(), b"</style>".as_slice()),
                (b"<noscript".as_slice(), b"</noscript>".as_slice()),
            ] {
                if i + open.len() <= lower_bytes.len()
                    && &lower_bytes[i..i + open.len()] == open
                {
                    skip_until = Some(close);
                    break;
                }
            }
            if skip_until.is_some() {
                continue;
            }
            in_tag = true;
            i += 1;
            continue;
        }
        if b == b'>' {
            in_tag = false;
            cleaned.push(' ');
            i += 1;
            continue;
        }
        if !in_tag {
            cleaned.push(bytes[i] as char);
        }
        i += 1;
    }

    let collapsed = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.chars().count() > 32_000 {
        collapsed.chars().take(32_000).collect()
    } else {
        collapsed
    }
}

#[tauri::command]
async fn quick_memo(input: QuickMemoInput) -> Result<QuickMemoOutput, String> {
    let key = read_key(&input.provider)?;

    // 1. Gather source text — either fetched from URL or user paste.
    let source_text = if let Some(url) = input.url.as_ref().filter(|u| !u.trim().is_empty()) {
        fetch_url_text(url.clone()).await?
    } else if let Some(seed) = input.seed_text.as_ref().filter(|s| !s.trim().is_empty()) {
        seed.clone()
    } else {
        return Err("Need a URL or pasted text".to_string());
    };

    let excerpt: String = source_text.chars().take(600).collect();

    let note = input.note.as_deref().unwrap_or("").trim();
    let user_prompt = format!(
        "You are turning a single web source into a ~2-page investor screening memo.\n\
        \n\
        Structure:\n\
        1) **What this company / paper does** (3-4 sentences, plain language).\n\
        2) **Why interesting** (2-3 bullets — tech, market, traction, team — only what's visible).\n\
        3) **Risks / open questions** (2-3 bullets, named honestly).\n\
        4) **Next step** (one concrete action: read X, talk to Y, skip).\n\
        \n\
        Rules:\n\
        - Lead with what is in the source. Do not invent facts.\n\
        - If the source is thin, say so in 'Open questions'.\n\
        - No filler phrases ('it is important to note', 'in conclusion').\n\
        - ~2800 characters max output.\n\
        \n\
        Reader's note: {}\n\
        \n\
        <source>\n{}\n</source>",
        if note.is_empty() { "(none provided)" } else { note },
        source_text
    );

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;

    let memo = match input.provider.as_str() {
        "anthropic" => call_anthropic_memo(&client, &key, &user_prompt).await?,
        "openai" => call_openai_memo(&client, &key, &user_prompt).await?,
        other => return Err(format!("Unknown provider: {}", other)),
    };

    Ok(QuickMemoOutput {
        memo,
        source_excerpt: excerpt,
    })
}

#[derive(Deserialize)]
struct AnthropicContentBlock {
    #[serde(rename = "type")]
    block_type: String,
    text: Option<String>,
}

#[derive(Deserialize)]
struct AnthropicReply {
    content: Vec<AnthropicContentBlock>,
}

async fn call_anthropic_memo(
    client: &reqwest::Client,
    key: &str,
    user_prompt: &str,
) -> Result<String, String> {
    let body = serde_json::json!({
        "model": "claude-sonnet-4-6",
        "max_tokens": 2000,
        "messages": [{"role":"user","content": user_prompt}]
    });
    let res = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Network: {}", e))?;
    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        return Err(format!(
            "HTTP {}: {}",
            status.as_u16(),
            body.chars().take(240).collect::<String>()
        ));
    }
    let parsed: AnthropicReply = res.json().await.map_err(|e| e.to_string())?;
    let text = parsed
        .content
        .into_iter()
        .filter(|b| b.block_type == "text")
        .filter_map(|b| b.text)
        .collect::<Vec<_>>()
        .join("\n");
    if text.trim().is_empty() {
        return Err("Empty response from Anthropic".to_string());
    }
    Ok(text)
}

#[derive(Deserialize)]
struct OpenAiChoice {
    message: OpenAiMessage,
}

#[derive(Deserialize)]
struct OpenAiMessage {
    content: Option<String>,
}

#[derive(Deserialize)]
struct OpenAiReply {
    choices: Vec<OpenAiChoice>,
}

async fn call_openai_memo(
    client: &reqwest::Client,
    key: &str,
    user_prompt: &str,
) -> Result<String, String> {
    let body = serde_json::json!({
        "model": "gpt-4o-mini",
        "max_tokens": 2000,
        "messages": [{"role":"user","content": user_prompt}]
    });
    let res = client
        .post("https://api.openai.com/v1/chat/completions")
        .bearer_auth(key)
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Network: {}", e))?;
    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        return Err(format!(
            "HTTP {}: {}",
            status.as_u16(),
            body.chars().take(240).collect::<String>()
        ));
    }
    let parsed: OpenAiReply = res.json().await.map_err(|e| e.to_string())?;
    let text = parsed
        .choices
        .into_iter()
        .filter_map(|c| c.message.content)
        .collect::<Vec<_>>()
        .join("\n");
    if text.trim().is_empty() {
        return Err("Empty response from OpenAI".to_string());
    }
    Ok(text)
}

// ─── Full IC Report (W2.3) ───────────────────────────────────────────
//
// Section-by-section LLM authoring. Five passes total:
//   founder  → who is behind this, what makes them credible / risky
//   market   → market size, why now, who they're displacing
//   traction → product, customers, growth, what's verified vs claimed
//   terms    → round shape, valuation, who else is in, asks
//   compile  → fold the four sections into a single coherent memo
// Each pass sees the source + prior sections so the model can reference
// what was already established without re-deriving facts.

#[derive(Deserialize, Serialize, Clone)]
pub struct IcPriorSection {
    pub section: String,
    pub content: String,
}

#[derive(Deserialize)]
pub struct IcReportInput {
    pub provider: String,
    /// "founder" | "market" | "traction" | "terms" | "compile"
    pub section: String,
    pub url: Option<String>,
    pub seed_text: Option<String>,
    pub hints: Option<String>,
    pub prior_sections: Option<Vec<IcPriorSection>>,
}

#[derive(Serialize)]
pub struct IcReportOutput {
    pub section: String,
    pub content: String,
}

fn ic_section_prompt(
    section: &str,
    source: &str,
    hints: &str,
    prior: &str,
) -> Result<String, String> {
    let context_block = if prior.is_empty() {
        "(no prior sections yet)".to_string()
    } else {
        prior.to_string()
    };
    let hints_block = if hints.is_empty() { "(none)" } else { hints };

    let body = match section {
        "founder" => "Section: FOUNDER & TEAM\n\
            Write 4-6 bullets about the people behind this company.\n\
            - Names + prior roles (only those visible in source).\n\
            - What looks credible (track record, depth, unique vantage).\n\
            - What looks thin (gaps, single-domain, first-time on this kind of\n\
              problem).\n\
            - Skip anything not in the source. If the founder is barely\n\
              identifiable, say so.\n",
        "market" => "Section: MARKET\n\
            Write 4-6 bullets on market shape.\n\
            - The specific problem (one sentence).\n\
            - Why now (regulatory shift, cost curve, tech unlock — only if\n\
              visible).\n\
            - Closest 2-3 incumbents or alternatives by name.\n\
            - Size envelope (TAM / SAM if explicit; otherwise estimate band\n\
              and label it as such).\n\
            - The riskiest assumption about market.\n",
        "traction" => "Section: PRODUCT & TRACTION\n\
            Write 4-6 bullets on product + traction.\n\
            - What ships today (feature, not roadmap).\n\
            - Customers / users (named if disclosed; counts if not).\n\
            - Growth signal (revenue, retention, usage) — only what's stated;\n\
              flag anything claimed without evidence.\n\
            - What's still vapor.\n",
        "terms" => "Section: ROUND & TERMS\n\
            Write 3-5 bullets on the round shape.\n\
            - Round size, valuation, structure (SAFE / priced) — only if\n\
              disclosed.\n\
            - Lead / co-investors already in.\n\
            - Use of funds.\n\
            - The ask of THIS partner (check size, board, intro).\n\
            - If terms aren't in the source, write 'TBD' and list what to\n\
              ask in the next call.\n",
        "compile" => "Section: COMPILED MEMO\n\
            Fold the four prior sections (FOUNDER, MARKET, PRODUCT/TRACTION,\n\
            ROUND/TERMS) into a single ~2-page memo:\n\
            \n\
            ## Snapshot\n\
            One paragraph: what they do, why it's interesting, what's open.\n\
            \n\
            ## Founder\n\
            (from FOUNDER section)\n\
            \n\
            ## Market\n\
            (from MARKET section)\n\
            \n\
            ## Product & Traction\n\
            (from PRODUCT/TRACTION section)\n\
            \n\
            ## Round\n\
            (from ROUND/TERMS section)\n\
            \n\
            ## Recommendation\n\
            One of: PASS / WATCH / TAKE THE CALL. Two sentences why, naming\n\
            the single most important open question.\n\
            \n\
            Rules:\n\
            - Tighten language. Cut filler. Active voice.\n\
            - Do not invent facts that weren't in the prior sections.\n",
        other => return Err(format!("Unknown section: {}", other)),
    };

    Ok(format!(
        "You are co-authoring an investor memo for VHS, a deep-tech focused VC.\n\
        \n\
        {}\n\
        Reader's hints: {}\n\
        \n\
        <prior_sections>\n{}\n</prior_sections>\n\
        \n\
        <source>\n{}\n</source>\n\
        \n\
        Output the section content only. No section heading line. No preamble.",
        body, hints_block, context_block, source
    ))
}

#[tauri::command]
async fn ic_report_section(input: IcReportInput) -> Result<IcReportOutput, String> {
    let key = read_key(&input.provider)?;

    let source_text = if let Some(url) = input.url.as_ref().filter(|u| !u.trim().is_empty()) {
        fetch_url_text(url.clone()).await?
    } else if let Some(seed) = input.seed_text.as_ref().filter(|s| !s.trim().is_empty()) {
        seed.clone()
    } else if input.section == "compile" {
        // 'compile' can run with prior sections only.
        String::new()
    } else {
        return Err("Need a URL or pasted source text".to_string());
    };

    let hints = input.hints.as_deref().unwrap_or("").trim().to_string();
    let prior = input
        .prior_sections
        .unwrap_or_default()
        .iter()
        .map(|s| format!("[{}]\n{}", s.section.to_uppercase(), s.content))
        .collect::<Vec<_>>()
        .join("\n\n");

    let prompt = ic_section_prompt(&input.section, &source_text, &hints, &prior)?;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;

    let content = match input.provider.as_str() {
        "anthropic" => call_anthropic_memo(&client, &key, &prompt).await?,
        "openai" => call_openai_memo(&client, &key, &prompt).await?,
        "local" => call_local_memo(&client, &prompt).await?,
        other => return Err(format!("Unknown provider: {}", other)),
    };

    Ok(IcReportOutput {
        section: input.section,
        content,
    })
}

// ─── Local model (W2.4 — Ollama on localhost) ────────────────────────
//
// User points KN33C4P at their local Ollama server (default
// http://localhost:11434) and picks a model that's already pulled. Zero
// outbound calls leave the machine. Slower than Sonnet for deep memos but
// good enough for one-shot section drafts on a 13B+ model.

const OLLAMA_DEFAULT_URL: &str = "http://localhost:11434";
const OLLAMA_DEFAULT_MODEL: &str = "llama3.2";

#[derive(Deserialize)]
struct OllamaConfig {
    base_url: Option<String>,
    model: Option<String>,
}

fn read_ollama_config() -> OllamaConfig {
    // W2.4 uses a single Keychain entry "local" with a JSON value
    // {"base_url":"...","model":"..."}. Falls back to defaults.
    if let Ok(raw) = read_key("local") {
        if let Ok(cfg) = serde_json::from_str::<OllamaConfig>(&raw) {
            return cfg;
        }
    }
    OllamaConfig {
        base_url: None,
        model: None,
    }
}

#[tauri::command]
async fn save_local_config(base_url: String, model: String) -> Result<(), String> {
    let cfg = serde_json::json!({
        "base_url": base_url.trim(),
        "model": model.trim(),
    });
    let entry = Entry::new(KEYRING_SERVICE, "local").map_err(|e| e.to_string())?;
    entry
        .set_password(&cfg.to_string())
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn test_local_connection() -> Result<String, String> {
    let cfg = read_ollama_config();
    let base = cfg
        .base_url
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| OLLAMA_DEFAULT_URL.to_string());
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .map_err(|e| e.to_string())?;
    let url = format!("{}/api/tags", base.trim_end_matches('/'));
    let res = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Cannot reach {}: {}", base, e))?;
    if !res.status().is_success() {
        return Err(format!("Ollama returned HTTP {}", res.status().as_u16()));
    }
    Ok("ok".to_string())
}

#[derive(Deserialize)]
struct OllamaReply {
    message: OllamaMsg,
}

#[derive(Deserialize)]
struct OllamaMsg {
    content: String,
}

async fn call_local_memo(client: &reqwest::Client, user_prompt: &str) -> Result<String, String> {
    let cfg = read_ollama_config();
    let base = cfg
        .base_url
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| OLLAMA_DEFAULT_URL.to_string());
    let model = cfg
        .model
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| OLLAMA_DEFAULT_MODEL.to_string());

    let body = serde_json::json!({
        "model": model,
        "stream": false,
        "messages": [{"role":"user","content": user_prompt}]
    });
    let url = format!("{}/api/chat", base.trim_end_matches('/'));
    let res = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Local network: {}", e))?;
    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        return Err(format!(
            "Local HTTP {}: {}",
            status.as_u16(),
            body.chars().take(240).collect::<String>()
        ));
    }
    let parsed: OllamaReply = res.json().await.map_err(|e| e.to_string())?;
    if parsed.message.content.trim().is_empty() {
        return Err("Empty response from local model".to_string());
    }
    Ok(parsed.message.content)
}

// ─── VHS-hosted (W2.5 — stub; needs server-side metered billing) ─────
//
// User-flow contract: KN33C4P sends the same {provider:"vhs", ...} payload
// to https://vhs.capital/api/kneecap/run-prompt with their device token.
// Server bills $2/finished IC report (compile section) via Stripe metered
// billing. W2.5 server-side is not built yet; this command returns a clean
// error so the Settings UI can wire its disabled state.

#[tauri::command]
async fn vhs_hosted_status() -> Result<String, String> {
    Err("VHS-hosted billing endpoint not deployed yet (W2.5)".to_string())
}

// ─── Tauri entry ─────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            save_api_key,
            delete_api_key,
            list_configured_providers,
            test_connection,
            fetch_url_text,
            quick_memo,
            ic_report_section,
            save_local_config,
            test_local_connection,
            vhs_hosted_status
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
