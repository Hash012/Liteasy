use super::model::{digest, Manifest, MAX_FILE_BYTES, MAX_MANIFEST_BYTES};
use openidconnect::reqwest::{self, Client, Method, Response};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use url::Url;

pub struct Remote {
    client: Client,
    root: Url,
    username: String,
    password: String,
}

pub fn endpoint(value: &str) -> Result<Url, String> {
    let mut url = Url::parse(value.trim()).map_err(|_| "请输入有效的 WebDAV HTTPS 地址。")?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("WebDAV 地址必须使用 HTTPS，且不能包含账号、密码、查询参数或片段。".into());
    }
    if !url.path().ends_with('/') {
        url.set_path(&format!("{}/", url.path()));
    }
    Ok(url)
}

fn network_error(_: reqwest::Error) -> String {
    "WebDAV 网络请求失败，请检查网络、证书和服务器地址。".into()
}
fn status_error(status: u16) -> String {
    match status {
        401 | 403 => "WebDAV 身份验证失败或没有访问权限。".into(),
        404 => "WebDAV 目录或文件不存在。".into(),
        409 => "WebDAV 父目录不存在，请检查服务器地址。".into(),
        412 => "其他设备已更新远端数据，请重新同步。".into(),
        423 => "WebDAV 文件被锁定，请稍后重试。".into(),
        507 => "WebDAV 存储空间不足。".into(),
        _ => format!("WebDAV 服务器返回 HTTP {status}。"),
    }
}
fn success(response: Response) -> Result<Response, String> {
    if matches!(response.status().as_u16(), 200 | 201 | 204) {
        Ok(response)
    } else {
        Err(status_error(response.status().as_u16()))
    }
}
pub async fn bounded(mut response: Response, limit: u64) -> Result<Vec<u8>, String> {
    if response.content_length().is_some_and(|n| n > limit) {
        return Err("WebDAV 响应超过大小限制。".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(network_error)? {
        if bytes.len() as u64 + chunk.len() as u64 > limit {
            return Err("WebDAV 响应超过大小限制。".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}
fn strong_etag(response: &Response) -> Result<String, String> {
    response
        .headers()
        .get("etag")
        .and_then(|v| v.to_str().ok())
        .filter(|s| s.starts_with('"') && s.ends_with('"') && s.len() >= 2)
        .map(str::to_owned)
        .ok_or_else(|| "服务器未提供强 ETag，无法安全同步。".into())
}
impl Remote {
    pub fn new(
        base: &str,
        collection: &str,
        username: &str,
        password: &str,
    ) -> Result<Self, String> {
        let root = endpoint(base)?
            .join(&format!("liteasy/{collection}/"))
            .map_err(|_| "同步目录无效。")?;
        let client = Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(15))
            .timeout(Duration::from_secs(180))
            .user_agent("Liteasy-WebDAV/1")
            .build()
            .map_err(network_error)?;
        Ok(Self {
            client,
            root,
            username: username.into(),
            password: password.into(),
        })
    }
    fn request(&self, method: &str, name: &str) -> reqwest::RequestBuilder {
        self.client
            .request(
                Method::from_bytes(method.as_bytes()).expect("fixed HTTP method"),
                self.root.join(name).expect("validated internal URL"),
            )
            .basic_auth(&self.username, Some(&self.password))
    }
    async fn mkdir(&self, name: &str) -> Result<(), String> {
        let response = self
            .request("MKCOL", name)
            .send()
            .await
            .map_err(network_error)?;
        if response.status().as_u16() == 405 {
            // A 405 alone does not prove the resource is an existing collection.
            let response = self
                .request("PROPFIND", name)
                .header("Depth", "0")
                .header("Content-Type", "application/xml")
                .body("<propfind xmlns=\"DAV:\"><prop><resourcetype/></prop></propfind>")
                .send()
                .await
                .map_err(network_error)?;
            if response.status().as_u16() != 207 {
                return Err(status_error(response.status().as_u16()));
            }
            return Ok(());
        }
        success(response)?;
        Ok(())
    }
    pub async fn prepare(&self) -> Result<(), String> {
        self.mkdir("../").await?;
        self.mkdir("").await?;
        self.mkdir("objects/").await
    }
    pub async fn verify(&self) -> Result<(), String> {
        self.prepare().await?;
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let name = format!("probe-{}-{nonce}", std::process::id());
        let value = format!("Liteasy WebDAV verification {nonce}").into_bytes();
        success(
            self.request("PUT", &name)
                .header("If-None-Match", "*")
                .body(value.clone())
                .send()
                .await
                .map_err(network_error)?,
        )?;
        let result: Result<(), String> = async {
            let response = success(
                self.request("GET", &name)
                    .send()
                    .await
                    .map_err(network_error)?,
            )?;
            let etag = strong_etag(&response)?;
            if bounded(response, 4096).await? != value {
                return Err("服务器未正确保存验证文件。".into());
            }
            let response = self
                .request("PUT", &name)
                .header("If-None-Match", "*")
                .body("must-not-overwrite")
                .send()
                .await
                .map_err(network_error)?;
            if response.status().as_u16() != 412 {
                return Err("服务器不支持条件创建，无法安全同步。".into());
            }
            let response = self
                .request("PUT", &name)
                .header("If-Match", "\"liteasy-impossible-etag\"")
                .body("must-not-overwrite")
                .send()
                .await
                .map_err(network_error)?;
            if response.status().as_u16() != 412 {
                return Err("服务器不支持条件更新，无法安全同步。".into());
            }
            success(
                self.request("PUT", &name)
                    .header("If-Match", etag)
                    .body(value.clone())
                    .send()
                    .await
                    .map_err(network_error)?,
            )?;
            let response = success(
                self.request("GET", &name)
                    .send()
                    .await
                    .map_err(network_error)?,
            )?;
            if bounded(response, 4096).await? != value {
                return Err("服务器条件写入验证失败。".into());
            }
            Ok(())
        }
        .await;
        let cleanup = self
            .request("DELETE", &name)
            .send()
            .await
            .map_err(network_error)
            .and_then(success);
        result?;
        cleanup?;
        Ok(())
    }
    pub async fn manifest(&self) -> Result<(Manifest, Option<String>), String> {
        let response = self
            .request("GET", "manifest.v1.json")
            .send()
            .await
            .map_err(network_error)?;
        if response.status().as_u16() == 404 {
            return Ok((Manifest::default(), None));
        }
        let response = success(response)?;
        let etag = strong_etag(&response)?;
        let manifest: Manifest =
            serde_json::from_slice(&bounded(response, MAX_MANIFEST_BYTES).await?)
                .map_err(|_| "远端同步清单损坏。")?;
        manifest.validate()?;
        Ok((manifest, Some(etag)))
    }
    pub async fn publish(&self, manifest: &Manifest, etag: Option<&str>) -> Result<(), String> {
        manifest.validate()?;
        let bytes = serde_json::to_vec(manifest).map_err(|e| e.to_string())?;
        if bytes.len() as u64 > MAX_MANIFEST_BYTES {
            return Err("同步清单超过 16 MiB。".into());
        }
        let request = self
            .request("PUT", "manifest.v1.json")
            .header("Content-Type", "application/json");
        let request = if let Some(tag) = etag {
            request.header("If-Match", tag)
        } else {
            request.header("If-None-Match", "*")
        };
        success(request.body(bytes).send().await.map_err(network_error)?)?;
        Ok(())
    }
    pub async fn upload(&self, hash: &str, bytes: Vec<u8>) -> Result<(), String> {
        if digest(&bytes) != hash {
            return Err("上传前文件发生变化，请重新同步。".into());
        }
        let name = format!("objects/{hash}");
        let response = self
            .request("PUT", &name)
            .header("If-None-Match", "*")
            .body(bytes)
            .send()
            .await
            .map_err(network_error)?;
        if response.status().as_u16() == 412 {
            // Verify existing content; never trust an object name alone after an interrupted upload.
            self.download(hash, MAX_FILE_BYTES).await?;
        } else {
            success(response)?;
        }
        Ok(())
    }
    pub async fn download(&self, hash: &str, limit: u64) -> Result<Vec<u8>, String> {
        let response = success(
            self.request("GET", &format!("objects/{hash}"))
                .send()
                .await
                .map_err(network_error)?,
        )?;
        let bytes = bounded(response, limit).await?;
        if digest(&bytes) != hash {
            return Err("下载文件校验失败，已保留本地版本。".into());
        }
        Ok(bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn endpoints_reject_credential_leaks_and_preserve_encoded_paths() {
        for s in [
            "http://server/dav",
            "https://user:pass@server/dav",
            "https://server/dav?token=abc",
            "file:///tmp",
            "https://server/#x",
        ] {
            assert!(endpoint(s).is_err());
        }
        assert_eq!(
            endpoint("https://server/dav%20folder").unwrap().as_str(),
            "https://server/dav%20folder/"
        );
    }
}

#[cfg(test)]
pub(super) mod test_server {
    use super::*;
    use std::{
        collections::BTreeMap,
        io::{Read, Write},
        net::{TcpListener, TcpStream},
        sync::{
            atomic::{AtomicBool, Ordering},
            Arc, Mutex,
        },
        thread,
    };
    #[derive(Default)]
    pub struct ServerState {
        pub objects: BTreeMap<String, (Vec<u8>, String)>,
        pub ignore_conditions: bool,
        pub fail_manifest_put: bool,
        pub no_etag: bool,
        pub revision: usize,
    }
    pub struct Server {
        pub remote: Remote,
        pub state: Arc<Mutex<ServerState>>,
        stop: Arc<AtomicBool>,
        address: std::net::SocketAddr,
        thread: Option<thread::JoinHandle<()>>,
    }
    impl Drop for Server {
        fn drop(&mut self) {
            self.stop.store(true, Ordering::SeqCst);
            let _ = TcpStream::connect(self.address);
            self.thread.take().unwrap().join().unwrap();
        }
    }
    impl Server {
        pub fn start() -> Self {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let address = listener.local_addr().unwrap();
            let state = Arc::new(Mutex::new(ServerState::default()));
            let shared = state.clone();
            let stop = Arc::new(AtomicBool::new(false));
            let stopped = stop.clone();
            let thread = thread::spawn(move || {
                for stream in listener.incoming() {
                    if stopped.load(Ordering::SeqCst) {
                        break;
                    }
                    let mut stream = stream.unwrap();
                    stream
                        .set_read_timeout(Some(Duration::from_secs(5)))
                        .unwrap();
                    let mut request = Vec::new();
                    let mut byte = [0];
                    while !request.ends_with(b"\r\n\r\n") {
                        if stream.read_exact(&mut byte).is_err() {
                            break;
                        }
                        request.push(byte[0]);
                    }
                    let header = String::from_utf8(request).unwrap();
                    let mut lines = header.split("\r\n");
                    let first = lines.next().unwrap();
                    let mut parts = first.split_whitespace();
                    let method = parts.next().unwrap();
                    let path = parts.next().unwrap().to_string();
                    let headers: BTreeMap<_, _> = lines
                        .filter_map(|line| line.split_once(':'))
                        .map(|(k, v)| (k.to_lowercase(), v.trim().to_string()))
                        .collect();
                    let length: usize = headers
                        .get("content-length")
                        .map(|v| v.parse().unwrap())
                        .unwrap_or(0);
                    let mut body = vec![0; length];
                    stream.read_exact(&mut body).unwrap();
                    let mut state = shared.lock().unwrap();
                    let mut code = 200;
                    let mut result = Vec::new();
                    let mut etag = None;
                    if !headers
                        .get("authorization")
                        .is_some_and(|v| v.starts_with("Basic "))
                    {
                        code = 401;
                    } else {
                        match method {
                            "MKCOL" => code = 201,
                            "PROPFIND" => {
                                code = 207;
                                result = b"<multistatus xmlns=\"DAV:\"/>".to_vec();
                            }
                            "GET" => {
                                if let Some((bytes, tag)) = state.objects.get(&path) {
                                    result = bytes.clone();
                                    etag = Some(tag.clone());
                                } else {
                                    code = 404;
                                }
                            }
                            "DELETE" => {
                                state.objects.remove(&path);
                                code = 204;
                            }
                            "PUT" => {
                                let existing = state.objects.get(&path);
                                let precondition_failed =
                                    (headers.get("if-none-match").is_some_and(|v| v == "*")
                                        && existing.is_some())
                                        || headers.get("if-match").is_some_and(|v| {
                                            existing.map(|(_, tag)| tag) != Some(v)
                                        });
                                if (precondition_failed && !state.ignore_conditions)
                                    || (path.ends_with("manifest.v1.json")
                                        && state.fail_manifest_put)
                                {
                                    code = 412;
                                } else {
                                    state.revision += 1;
                                    let tag = format!("\"{}\"", state.revision);
                                    state.objects.insert(path, (body, tag));
                                    code = 201;
                                }
                            }
                            _ => code = 405,
                        }
                    }
                    let tag = if state.no_etag {
                        String::new()
                    } else {
                        etag.map(|t| format!("ETag: {t}\r\n")).unwrap_or_default()
                    };
                    write!(stream, "HTTP/1.1 {code} Result\r\nContent-Length: {}\r\n{tag}Connection: close\r\n\r\n", result.len()).unwrap();
                    stream.write_all(&result).unwrap();
                }
            });
            let remote = Remote {
                client: Client::builder()
                    .no_proxy()
                    .redirect(reqwest::redirect::Policy::none())
                    .timeout(Duration::from_secs(5))
                    .build()
                    .unwrap(),
                root: Url::parse(&format!("http://{address}/liteasy/test/")).unwrap(),
                username: "test".into(),
                password: "secret".into(),
            };
            Self {
                remote,
                state,
                stop,
                address,
                thread: Some(thread),
            }
        }
    }
    pub fn runtime() -> tokio::runtime::Runtime {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
    }
    #[test]
    fn webdav_http_verification_cas_integrity_and_cleanup() {
        let server = Server::start();
        runtime().block_on(async {
            server.remote.verify().await.unwrap();
            assert!(server.state.lock().unwrap().objects.is_empty());
            let bytes = b"attachment".to_vec();
            let hash = digest(&bytes);
            server.remote.upload(&hash, bytes.clone()).await.unwrap();
            server.remote.upload(&hash, bytes.clone()).await.unwrap();
            assert_eq!(server.remote.download(&hash, 100).await.unwrap(), bytes);
            assert!(server.remote.download(&hash, 2).await.is_err());
            let manifest = Manifest::default();
            server.remote.publish(&manifest, None).await.unwrap();
            assert!(server.remote.publish(&manifest, None).await.is_err());
            let (_, etag) = server.remote.manifest().await.unwrap();
            server
                .remote
                .publish(&manifest, etag.as_deref())
                .await
                .unwrap();
            assert!(server
                .remote
                .publish(&manifest, etag.as_deref())
                .await
                .is_err());
            server.state.lock().unwrap().no_etag = true;
            assert!(server.remote.manifest().await.is_err());
            server.state.lock().unwrap().no_etag = false;
            server
                .state
                .lock()
                .unwrap()
                .objects
                .get_mut(&format!("/liteasy/test/objects/{hash}"))
                .unwrap()
                .0 = b"tampered".to_vec();
            assert!(server.remote.download(&hash, 100).await.is_err());
        });
    }
    #[test]
    fn webdav_rejects_servers_ignoring_conditions_and_cleans_probe() {
        let server = Server::start();
        server.state.lock().unwrap().ignore_conditions = true;
        runtime().block_on(async {
            assert!(server.remote.verify().await.is_err());
        });
        assert!(server.state.lock().unwrap().objects.is_empty());
    }
}
