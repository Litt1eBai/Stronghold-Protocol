use serde_json::{json, Value};
use std::time::Duration;

// Only the fixed registration endpoint is exposed; the webview cannot choose an arbitrary URL.
#[tauri::command]
async fn register_account(fields: Value) -> Result<Value, String> {
    let origin = reqwest::Url::parse(env!("SP_SERVER_URL"))
        .map_err(|_| "Invalid server URL".to_string())?
        .origin()
        .ascii_serialization();
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "注册服务暂时不可用".to_string())?;
    let response = client
        .post(format!("{origin}/api/auth/register"))
        .json(&fields)
        .send()
        .await
        .map_err(|_| "无法连接注册服务，请检查网络".to_string())?;
    let status = response.status().as_u16();
    let body: Value = response
        .json()
        .await
        .map_err(|_| "注册服务返回了无效响应".to_string())?;
    Ok(json!({ "status": status, "body": body }))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![register_account])
        .run(tauri::generate_context!())
        .expect("error while running Stronghold Protocol client");
}
