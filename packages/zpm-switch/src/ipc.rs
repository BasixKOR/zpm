use std::{sync::Arc, time::Duration};

use futures::{SinkExt, stream::StreamExt};
use tokio_tungstenite::tungstenite::Message;

use crate::{daemons::DaemonEntry, errors::Error};

pub const YARNSW_PATH_ENV: &str = "YARNSW_PATH";

/// Connects to the daemon described by `entry`, sends `request_payload`
/// wrapped in the standard `{requestId, request}` envelope, and returns
/// the matching `response` value. Times out after `timeout`.
pub async fn send_daemon_request(
    entry: &DaemonEntry,
    request_payload: serde_json::Value,
    timeout: Duration,
) -> Result<serde_json::Value, Error> {
    let url = build_ws_url(entry.port, entry.auth_token.as_deref());

    let (mut ws, _) = tokio_tungstenite::connect_async(&url)
        .await
        .map_err(|e| Error::DaemonConnectionFailed(Arc::new(std::io::Error::new(
            std::io::ErrorKind::ConnectionRefused,
            e.to_string(),
        ))))?;

    let request_id: u64 = 1;

    let envelope = serde_json::json!({
        "requestId": request_id,
        "request": request_payload,
    });

    ws.send(Message::Text(envelope.to_string().into()))
        .await
        .map_err(|e| Error::DaemonConnectionFailed(Arc::new(std::io::Error::new(
            std::io::ErrorKind::Other,
            e.to_string(),
        ))))?;

    let response = tokio::time::timeout(timeout, async {
        while let Some(Ok(msg)) = ws.next().await {
            if let Message::Text(text) = msg {
                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&text) {
                    if parsed.get("kind").and_then(|k| k.as_str()) == Some("response")
                        && parsed.get("requestId").and_then(|r| r.as_u64()) == Some(request_id)
                    {
                        if let Some(resp) = parsed.get("response") {
                            return Some(resp.clone());
                        }
                    }
                }
            }
        }
        None
    }).await;

    ws.close(None).await.ok();

    match response {
        Ok(Some(resp)) => Ok(resp),
        _ => Err(Error::DaemonResponseTimeout),
    }
}

pub fn build_ws_url(port: u16, token: Option<&str>) -> String {
    match token {
        Some(t) => format!("ws://127.0.0.1:{}/?token={}", port, t),
        None => format!("ws://127.0.0.1:{}/", port),
    }
}
