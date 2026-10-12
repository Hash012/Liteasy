//! Bounded SSE framing; partial text is never a successful inference receipt.
use serde_json::Value;

#[derive(Default)]
pub struct ResponsesStream {
    pending: Vec<u8>,
    data: Vec<String>,
    bytes: usize,
    completed: Option<Value>,
}
impl ResponsesStream {
    pub fn push(
        &mut self,
        chunk: &[u8],
        mut delta: impl FnMut(&str) -> Result<(), String>,
    ) -> Result<(), String> {
        self.bytes += chunk.len();
        if self.bytes > 16 * 1024 * 1024 {
            return Err("chatgpt_output_budget_exhausted".into());
        }
        self.pending.extend_from_slice(chunk);
        while let Some(end) = self.pending.iter().position(|b| *b == b'\n') {
            let line = self.pending.drain(..=end).collect::<Vec<_>>();
            let text = std::str::from_utf8(&line)
                .map_err(|_| "chatgpt_stream_invalid")?
                .trim_end_matches(['\r', '\n']);
            if text.is_empty() {
                self.dispatch(&mut delta)?;
            } else if let Some(data) = text.strip_prefix("data:") {
                self.data
                    .push(data.strip_prefix(' ').unwrap_or(data).into());
            }
        }
        Ok(())
    }
    fn dispatch(
        &mut self,
        delta: &mut impl FnMut(&str) -> Result<(), String>,
    ) -> Result<(), String> {
        if self.data.is_empty() {
            return Ok(());
        }
        let data = std::mem::take(&mut self.data).join("\n");
        if data == "[DONE]" {
            return Ok(());
        }
        let event: Value = serde_json::from_str(&data).map_err(|_| "chatgpt_stream_invalid")?;
        match event["type"].as_str() {
            Some("response.failed" | "response.incomplete" | "error") => Err(format!(
                "chatgpt_terminal_{}",
                event["type"].as_str().unwrap_or("error")
            )),
            Some("response.completed") => {
                if self.completed.is_some() || event["response"]["status"] != "completed" {
                    return Err("chatgpt_terminal_invalid".into());
                }
                self.completed = Some(event["response"].clone());
                Ok(())
            }
            Some("response.output_text.delta") => {
                if self.completed.is_some() {
                    return Err("chatgpt_delta_after_terminal".into());
                }
                delta(event["delta"].as_str().ok_or("chatgpt_stream_invalid")?)
            }
            _ => Ok(()),
        }
    }
    pub fn finish(self) -> Result<Value, String> {
        // A truncated frame cannot confer authority even if it contains "completed".
        if !self.pending.is_empty() || !self.data.is_empty() {
            return Err("chatgpt_stream_truncated".into());
        }
        self.completed
            .ok_or("chatgpt_stream_missing_completed".into())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn framing_survives_byte_splits_unicode_crlf_and_multiline_data() {
        let wire = "data:{\"type\":\"response.output_text.delta\",\"delta\":\"原文\"}\r\n\r\ndata: {\"type\":\"response.completed\",\n\
                    data: \"response\":{\"status\":\"completed\",\"usage\":{\"input_tokens\":7}}}\n\ndata: [DONE]\n\n";
        let mut stream = ResponsesStream::default();
        let mut text = String::new();
        for byte in wire.as_bytes() {
            stream
                .push(&[*byte], |value| {
                    text.push_str(value);
                    Ok(())
                })
                .unwrap();
        }
        assert_eq!(text, "原文");
        assert_eq!(stream.finish().unwrap()["usage"]["input_tokens"], 7);
    }
    #[test]
    fn text_and_done_without_completed_are_not_success() {
        let mut stream = ResponsesStream::default();
        stream.push(b"data: {\"type\":\"response.output_text.delta\",\"delta\":\"answer\"}\n\ndata: [DONE]\n\n", |_| Ok(())).unwrap();
        assert!(stream.finish().is_err());
    }
    #[test]
    fn every_unsuccessful_terminal_rejects_even_after_output() {
        for status in ["failed", "incomplete"] {
            let mut stream = ResponsesStream::default();
            stream
                .push(
                    b"data: {\"type\":\"response.output_text.delta\",\"delta\":\"answer\"}\n\n",
                    |_| Ok(()),
                )
                .unwrap();
            assert!(stream
                .push(
                    format!("data: {{\"type\":\"response.{status}\"}}\n\n").as_bytes(),
                    |_| Ok(())
                )
                .is_err());
        }
        let mut stream = ResponsesStream::default();
        stream
            .push(
                b"data: {\"type\":\"response.completed\",\"response\":{\"status\":\"completed\"}}",
                |_| Ok(()),
            )
            .unwrap();
        assert!(stream.finish().is_err());
    }
}
