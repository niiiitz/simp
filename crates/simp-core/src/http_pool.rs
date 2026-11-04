use anyhow::{anyhow, Context, Result};
use std::ffi::{c_char, c_int, c_long, c_void, CStr, CString};
use std::io::Write;
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock};

#[cfg(unix)]
mod libcurl_ffi {
    use super::*;

    pub const CURLOPT_WRITEDATA: c_int = 10001;
    pub const CURLOPT_URL: c_int = 10002;
    pub const CURLOPT_RANGE: c_int = 10007;
    pub const CURLOPT_POSTFIELDS: c_int = 10015;
    pub const CURLOPT_USERAGENT: c_int = 10018;
    pub const CURLOPT_HTTPHEADER: c_int = 10023;
    pub const CURLOPT_WRITEFUNCTION: c_int = 20011;
    pub const CURLOPT_TIMEOUT: c_int = 13;
    pub const CURLOPT_POST: c_int = 47;
    pub const CURLOPT_FOLLOWLOCATION: c_int = 52;
    pub const CURLOPT_POSTFIELDSIZE: c_int = 60;
    pub const CURLOPT_NOSIGNAL: c_int = 99;
    pub const CURLOPT_TCP_KEEPALIVE: c_int = 213;

    pub const CURLINFO_RESPONSE_CODE: c_int = 0x200000 + 2;

    #[repr(C)]
    pub struct CurlSlist {
        _private: [u8; 0],
    }

    pub struct LibCurlApi {
        pub global_init: unsafe extern "C" fn(flags: c_long) -> c_int,
        pub easy_init: unsafe extern "C" fn() -> *mut c_void,
        pub easy_reset: unsafe extern "C" fn(curl: *mut c_void),
        pub easy_cleanup: unsafe extern "C" fn(curl: *mut c_void),
        pub easy_setopt: unsafe extern "C" fn(curl: *mut c_void, option: c_int, ...) -> c_int,
        pub easy_perform: unsafe extern "C" fn(curl: *mut c_void) -> c_int,
        pub easy_getinfo: unsafe extern "C" fn(curl: *mut c_void, info: c_int, ...) -> c_int,
        pub easy_strerror: unsafe extern "C" fn(code: c_int) -> *const c_char,
        pub slist_append:
            unsafe extern "C" fn(list: *mut CurlSlist, s: *const c_char) -> *mut CurlSlist,
        pub slist_free_all: unsafe extern "C" fn(list: *mut CurlSlist),
    }

    unsafe impl Send for LibCurlApi {}
    unsafe impl Sync for LibCurlApi {}

    static LIBCURL_API: OnceLock<Option<LibCurlApi>> = OnceLock::new();

    pub fn api() -> Option<&'static LibCurlApi> {
        LIBCURL_API
            .get_or_init(|| unsafe {
                let candidates = [
                    "libcurl.so.4\0",
                    "libcurl-gnutls.so.4\0",
                    "libcurl.so\0",
                    "libcurl.4.dylib\0",
                ];
                let mut handle = std::ptr::null_mut();
                for cand in candidates {
                    handle = libc::dlopen(
                        cand.as_ptr() as *const c_char,
                        libc::RTLD_LAZY | libc::RTLD_LOCAL,
                    );
                    if !handle.is_null() {
                        break;
                    }
                }
                if handle.is_null() {
                    return None;
                }

                macro_rules! sym {
                    ($name:literal) => {{
                        let ptr = libc::dlsym(handle, concat!($name, "\0").as_ptr() as *const c_char);
                        if ptr.is_null() {
                            return None;
                        }
                        std::mem::transmute(ptr)
                    }};
                }

                let api = LibCurlApi {
                    global_init: sym!("curl_global_init"),
                    easy_init: sym!("curl_easy_init"),
                    easy_reset: sym!("curl_easy_reset"),
                    easy_cleanup: sym!("curl_easy_cleanup"),
                    easy_setopt: sym!("curl_easy_setopt"),
                    easy_perform: sym!("curl_easy_perform"),
                    easy_getinfo: sym!("curl_easy_getinfo"),
                    easy_strerror: sym!("curl_easy_strerror"),
                    slist_append: sym!("curl_slist_append"),
                    slist_free_all: sym!("curl_slist_free_all"),
                };
                // CURL_GLOBAL_DEFAULT = 3
                let _ = (api.global_init)(3);
                Some(api)
            })
            .as_ref()
    }

    pub struct PooledCurlHandle(pub *mut c_void);
    unsafe impl Send for PooledCurlHandle {}

    impl Drop for PooledCurlHandle {
        fn drop(&mut self) {
            if !self.0.is_null() {
                if let Some(api) = api() {
                    unsafe {
                        (api.easy_cleanup)(self.0);
                    }
                }
                self.0 = std::ptr::null_mut();
            }
        }
    }

    static HANDLE_POOL: OnceLock<Mutex<Vec<PooledCurlHandle>>> = OnceLock::new();

    fn pool() -> &'static Mutex<Vec<PooledCurlHandle>> {
        HANDLE_POOL.get_or_init(|| Mutex::new(Vec::with_capacity(8)))
    }

    pub fn checkout_handle(api: &LibCurlApi) -> Option<PooledCurlHandle> {
        if let Ok(mut guard) = pool().lock() {
            if let Some(h) = guard.pop() {
                unsafe {
                    (api.easy_reset)(h.0);
                }
                return Some(h);
            }
        }
        let raw = unsafe { (api.easy_init)() };
        if raw.is_null() {
            None
        } else {
            Some(PooledCurlHandle(raw))
        }
    }

    pub fn checkin_handle(handle: PooledCurlHandle) {
        if let Ok(mut guard) = pool().lock() {
            if guard.len() < 8 {
                guard.push(handle);
            }
        }
    }

    pub unsafe extern "C" fn write_vec_callback(
        ptr: *const c_char,
        size: usize,
        nmemb: usize,
        userdata: *mut c_void,
    ) -> usize {
        let total = size.saturating_mul(nmemb);
        if total == 0 || ptr.is_null() || userdata.is_null() {
            return total;
        }
        let out_vec = &mut *(userdata as *mut Vec<u8>);
        let slice = std::slice::from_raw_parts(ptr as *const u8, total);
        out_vec.extend_from_slice(slice);
        total
    }

    pub fn execute_pooled_request(
        url: &str,
        headers: &[(&str, &str)],
        post_body: Option<&[u8]>,
        byte_range: Option<(u64, u64)>,
        timeout_secs: u64,
    ) -> Option<Result<Vec<u8>>> {
        let api = api()?;
        let handle = checkout_handle(api)?;
        let raw = handle.0;

        let c_url = match CString::new(url) {
            Ok(c) => c,
            Err(e) => {
                checkin_handle(handle);
                return Some(Err(anyhow!("Invalid URL passed to http_pool: {e}")));
            }
        };
        let c_ua = CString::new(
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        )
        .unwrap();

        let mut response_buf: Vec<u8> = Vec::with_capacity(16 * 1024);
        let mut slist: *mut CurlSlist = std::ptr::null_mut();

        let res = unsafe {
            for (k, v) in headers {
                let line = format!("{}: {}", k.trim(), v.trim());
                if let Ok(c_line) = CString::new(line) {
                    slist = (api.slist_append)(slist, c_line.as_ptr());
                }
            }

            (api.easy_setopt)(raw, CURLOPT_URL, c_url.as_ptr());
            (api.easy_setopt)(raw, CURLOPT_USERAGENT, c_ua.as_ptr());
            (api.easy_setopt)(raw, CURLOPT_FOLLOWLOCATION, 1 as c_long);
            (api.easy_setopt)(raw, CURLOPT_NOSIGNAL, 1 as c_long);
            (api.easy_setopt)(raw, CURLOPT_TCP_KEEPALIVE, 1 as c_long);
            (api.easy_setopt)(raw, CURLOPT_TIMEOUT, timeout_secs.max(5) as c_long);
            (api.easy_setopt)(
                raw,
                CURLOPT_WRITEFUNCTION,
                write_vec_callback as unsafe extern "C" fn(*const c_char, usize, usize, *mut c_void) -> usize,
            );
            (api.easy_setopt)(
                raw,
                CURLOPT_WRITEDATA,
                (&mut response_buf as *mut Vec<u8>) as *mut c_void,
            );

            if !slist.is_null() {
                (api.easy_setopt)(raw, CURLOPT_HTTPHEADER, slist);
            }

            let c_range_opt = byte_range.and_then(|(start, end)| {
                CString::new(format!("{start}-{end}")).ok()
            });
            if let Some(ref c_range) = c_range_opt {
                (api.easy_setopt)(raw, CURLOPT_RANGE, c_range.as_ptr());
            }

            if let Some(body) = post_body {
                (api.easy_setopt)(raw, CURLOPT_POST, 1 as c_long);
                (api.easy_setopt)(raw, CURLOPT_POSTFIELDSIZE, body.len() as c_long);
                (api.easy_setopt)(raw, CURLOPT_POSTFIELDS, body.as_ptr() as *const c_char);
            }

            let code = (api.easy_perform)(raw);
            let mut status_code: c_long = 0;
            if code == 0 {
                (api.easy_getinfo)(raw, CURLINFO_RESPONSE_CODE, &mut status_code as *mut c_long);
            }

            if !slist.is_null() {
                (api.slist_free_all)(slist);
            }

            if code != 0 {
                let err_ptr = (api.easy_strerror)(code);
                let err_msg = if err_ptr.is_null() {
                    format!("curl error code {code}")
                } else {
                    CStr::from_ptr(err_ptr).to_string_lossy().to_string()
                };
                Err(anyhow!("HTTP request failed ({url}): {err_msg}"))
            } else if status_code >= 400 {
                let snippet = String::from_utf8_lossy(
                    &response_buf[..response_buf.len().min(240)],
                )
                .trim()
                .to_string();
                Err(anyhow!(
                    "HTTP {status_code} for {url}{}",
                    if snippet.is_empty() {
                        String::new()
                    } else {
                        format!(": {snippet}")
                    }
                ))
            } else {
                Ok(response_buf)
            }
        };

        checkin_handle(handle);
        Some(res)
    }

    pub fn pooled_handle_count() -> usize {
        pool().lock().map(|g| g.len()).unwrap_or(0)
    }
}

/// Returns `true` when in-process `libcurl` connection pooling is active.
pub fn is_inprocess_http_pool_available() -> bool {
    #[cfg(unix)]
    {
        libcurl_ffi::api().is_some()
    }
    #[cfg(not(unix))]
    {
        false
    }
}

/// Returns the number of warm `CURL*` easy handles currently parked in the connection pool.
pub fn warm_handle_count() -> usize {
    #[cfg(unix)]
    {
        libcurl_ffi::pooled_handle_count()
    }
    #[cfg(not(unix))]
    {
        0
    }
}

/// Performs an HTTP/2 connection-pooled `GET` request in-process via `libcurl.so.4` (preserving
/// live TLS sessions, HTTP/2 multiplex streams, and DNS cache across calls), falling back to
/// `curl --config -` subprocess execution if `libcurl.so.4` is unavailable.
pub fn http_get_bytes(
    url: &str,
    headers: &[(&str, &str)],
    byte_range: Option<(u64, u64)>,
    timeout_secs: u64,
) -> Result<Vec<u8>> {
    #[cfg(unix)]
    {
        if let Some(res) =
            libcurl_ffi::execute_pooled_request(url, headers, None, byte_range, timeout_secs)
        {
            return res;
        }
    }
    fallback_curl_subprocess(url, headers, None, byte_range, timeout_secs)
}

/// Performs an HTTP/2 connection-pooled `POST` request in-process via `libcurl.so.4` (preserving
/// live TLS sessions, HTTP/2 multiplex streams, and DNS cache across calls), falling back to
/// `curl --config -` subprocess execution if `libcurl.so.4` is unavailable.
pub fn http_post_bytes(
    url: &str,
    headers: &[(&str, &str)],
    body: &[u8],
    timeout_secs: u64,
) -> Result<Vec<u8>> {
    #[cfg(unix)]
    {
        if let Some(res) =
            libcurl_ffi::execute_pooled_request(url, headers, Some(body), None, timeout_secs)
        {
            return res;
        }
    }
    fallback_curl_subprocess(url, headers, Some(body), None, timeout_secs)
}

fn fallback_curl_subprocess(
    url: &str,
    headers: &[(&str, &str)],
    post_body: Option<&[u8]>,
    byte_range: Option<(u64, u64)>,
    timeout_secs: u64,
) -> Result<Vec<u8>> {
    let mut cfg = format!("url = \"{}\"\n", url.replace('"', "\\\""));
    if post_body.is_some() {
        cfg.push_str("request = \"POST\"\n");
    }
    for (k, v) in headers {
        let header_line = format!("{}: {}", k.trim(), v.trim()).replace('"', "\\\"");
        cfg.push_str(&format!("header = \"{header_line}\"\n"));
    }
    if let Some((start, end)) = byte_range {
        cfg.push_str(&format!("header = \"Range: bytes={start}-{end}\"\n"));
    }
    if let Some(body) = post_body {
        let body_str = String::from_utf8_lossy(body);
        cfg.push_str(&format!(
            "data = \"{}\"\n",
            body_str.replace('\\', "\\\\").replace('"', "\\\"")
        ));
    }

    let timeout_str = timeout_secs.max(5).to_string();
    let mut child = Command::new("curl")
        .args(["-fsSL", "--max-time", &timeout_str, "--config", "-"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .with_context(|| format!("Failed to spawn curl subprocess for {url}"))?;

    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(cfg.as_bytes());
    }

    let out = child.wait_with_output()?;
    if !out.status.success() {
        return Err(anyhow!(
            "HTTP request failed ({url}): {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(out.stdout)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    #[test]
    fn test_inprocess_libcurl_pool_reuses_handles_and_fetches_http() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind ephemeral local port");
        let port = listener.local_addr().unwrap().port();

        let server = std::thread::spawn(move || {
            for i in 0..2 {
                if let Ok((mut stream, _)) = listener.accept() {
                    let mut req_buf = [0u8; 1024];
                    let _ = stream.read(&mut req_buf);
                    let body = format!("{{\"ok\":true,\"seq\":{i}}}");
                    let resp = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        body.len(),
                        body
                    );
                    let _ = stream.write_all(resp.as_bytes());
                    let _ = stream.flush();
                }
            }
        });

        let url = format!("http://127.0.0.1:{port}/test");
        let res1 = http_get_bytes(&url, &[("X-Simp-Test", "1")], None, 5).expect("GET #1");
        assert_eq!(String::from_utf8_lossy(&res1), "{\"ok\":true,\"seq\":0}");

        let res2 =
            http_post_bytes(&url, &[("Content-Type", "application/json")], b"{}", 5).expect("POST #2");
        assert_eq!(String::from_utf8_lossy(&res2), "{\"ok\":true,\"seq\":1}");

        if is_inprocess_http_pool_available() {
            assert!(
                warm_handle_count() >= 1,
                "Expected at least 1 warm CURL* handle in pool after requests"
            );
        }

        let _ = server.join();
    }
}

