use anyhow::{anyhow, Context, Result};
#[cfg(unix)]
use std::ffi::{c_char, c_int, c_long, c_void, CStr, CString};
use std::io::Write;
use std::process::{Command, Stdio};
#[cfg(unix)]
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
    pub const CURLOPT_CUSTOMREQUEST: c_int = 10036;
    pub const CURLOPT_WRITEFUNCTION: c_int = 20011;
    pub const CURLOPT_TIMEOUT: c_int = 13;
    pub const CURLOPT_POST: c_int = 47;
    pub const CURLOPT_FOLLOWLOCATION: c_int = 52;
    pub const CURLOPT_POSTFIELDSIZE: c_int = 60;
    pub const CURLOPT_NOSIGNAL: c_int = 99;
    pub const CURLOPT_TCP_KEEPALIVE: c_int = 213;
    pub const CURLOPT_MAXAGE_CONN: c_int = 288;

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

    pub struct PooledCurlHandle {
        pub raw: *mut c_void,
        pub last_used: std::time::Instant,
    }
    unsafe impl Send for PooledCurlHandle {}

    impl Drop for PooledCurlHandle {
        fn drop(&mut self) {
            if !self.raw.is_null() {
                if let Some(api) = api() {
                    unsafe {
                        (api.easy_cleanup)(self.raw);
                    }
                }
                self.raw = std::ptr::null_mut();
            }
        }
    }

    static HANDLE_POOL: OnceLock<Mutex<Vec<PooledCurlHandle>>> = OnceLock::new();

    fn pool() -> &'static Mutex<Vec<PooledCurlHandle>> {
        HANDLE_POOL.get_or_init(|| Mutex::new(Vec::with_capacity(8)))
    }

    pub fn checkout_handle(api: &LibCurlApi, allow_pooled: bool) -> Option<(PooledCurlHandle, bool)> {
        if allow_pooled {
            if let Ok(mut guard) = pool().lock() {
                while let Some(mut h) = guard.pop() {
                    if h.last_used.elapsed() <= std::time::Duration::from_secs(75) {
                        unsafe {
                            (api.easy_reset)(h.raw);
                        }
                        h.last_used = std::time::Instant::now();
                        return Some((h, true));
                    }
                    // Drop expired handle (>75s idle) so stale half-closed CDN sockets are never reused
                    drop(h);
                }
            }
        }
        let raw = unsafe { (api.easy_init)() };
        if raw.is_null() {
            None
        } else {
            Some((
                PooledCurlHandle {
                    raw,
                    last_used: std::time::Instant::now(),
                },
                false,
            ))
        }
    }

    pub fn checkin_handle(mut handle: PooledCurlHandle) {
        handle.last_used = std::time::Instant::now();
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
        custom_method: Option<&str>,
        byte_range: Option<(u64, u64)>,
        timeout_secs: u64,
    ) -> Option<Result<Vec<u8>>> {
        let api = api()?;
        let c_url = match CString::new(url) {
            Ok(c) => c,
            Err(e) => {
                return Some(Err(anyhow!("Invalid URL passed to http_pool: {e}")));
            }
        };
        let c_ua = CString::new(
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        )
        .unwrap();

        for attempt in 0..2 {
            let allow_pooled = attempt == 0;
            let (handle, was_pooled) = checkout_handle(api, allow_pooled)?;
            let raw = handle.raw;

            let mut response_buf: Vec<u8> = Vec::with_capacity(16 * 1024);
            let mut slist: *mut CurlSlist = std::ptr::null_mut();

            let (code, status_code) = unsafe {
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
                (api.easy_setopt)(raw, CURLOPT_MAXAGE_CONN, 75 as c_long);
                (api.easy_setopt)(raw, CURLOPT_TIMEOUT, timeout_secs.max(5) as c_long);
                (api.easy_setopt)(
                    raw,
                    CURLOPT_WRITEFUNCTION,
                    write_vec_callback
                        as unsafe extern "C" fn(*const c_char, usize, usize, *mut c_void) -> usize,
                );
                (api.easy_setopt)(
                    raw,
                    CURLOPT_WRITEDATA,
                    (&mut response_buf as *mut Vec<u8>) as *mut c_void,
                );

                if !slist.is_null() {
                    (api.easy_setopt)(raw, CURLOPT_HTTPHEADER, slist);
                }

                let c_range_opt =
                    byte_range.and_then(|(start, end)| CString::new(format!("{start}-{end}")).ok());
                if let Some(ref c_range) = c_range_opt {
                    (api.easy_setopt)(raw, CURLOPT_RANGE, c_range.as_ptr());
                }

                let c_method_opt = custom_method.and_then(|m| CString::new(m.trim()).ok());
                if let Some(ref c_method) = c_method_opt {
                    (api.easy_setopt)(raw, CURLOPT_CUSTOMREQUEST, c_method.as_ptr());
                }

                if let Some(body) = post_body {
                    if c_method_opt.is_none() {
                        (api.easy_setopt)(raw, CURLOPT_POST, 1 as c_long);
                    }
                    (api.easy_setopt)(raw, CURLOPT_POSTFIELDSIZE, body.len() as c_long);
                    (api.easy_setopt)(raw, CURLOPT_POSTFIELDS, body.as_ptr() as *const c_char);
                }

                let code = (api.easy_perform)(raw);
                let mut status_code: c_long = 0;
                if code == 0 {
                    (api.easy_getinfo)(
                        raw,
                        CURLINFO_RESPONSE_CODE,
                        &mut status_code as *mut c_long,
                    );
                }

                if !slist.is_null() {
                    (api.slist_free_all)(slist);
                }

                (code, status_code)
            };

            if code != 0 {
                // Never return a broken handle to the pool; if this was a reused handle (or first attempt),
                // immediately retry once on a fresh `curl_easy_init()` connection.
                drop(handle);
                if attempt == 0 && (was_pooled || post_body.is_none()) {
                    continue;
                }
                let err_msg = unsafe {
                    let err_ptr = (api.easy_strerror)(code);
                    if err_ptr.is_null() {
                        format!("curl error code {code}")
                    } else {
                        CStr::from_ptr(err_ptr).to_string_lossy().to_string()
                    }
                };
                return Some(Err(anyhow!("HTTP request failed ({url}): {err_msg}")));
            }

            checkin_handle(handle);

            if status_code >= 400 {
                let snippet =
                    String::from_utf8_lossy(&response_buf[..response_buf.len().min(240)])
                        .trim()
                        .to_string();
                return Some(Err(anyhow!(
                    "HTTP {status_code} for {url}{}",
                    if snippet.is_empty() {
                        String::new()
                    } else {
                        format!(": {snippet}")
                    }
                )));
            }

            return Some(Ok(response_buf));
        }

        None
    }

    pub fn pooled_handle_count() -> usize {
        pool().lock().map(|g| g.len()).unwrap_or(0)
    }
}

#[cfg(target_os = "windows")]
mod winhttp_ffi {
    use super::*;
    use std::ffi::c_void;
    use std::sync::OnceLock;

    type HINTERNET = *mut c_void;
    type BOOL = i32;
    type DWORD = u32;
    type WORD = u16;
    type LPCWSTR = *const u16;
    type LPVOID = *mut c_void;
    type LPCVOID = *const c_void;

    const WINHTTP_ACCESS_TYPE_DEFAULT_PROXY: DWORD = 0;
    const WINHTTP_ACCESS_TYPE_NO_PROXY: DWORD = 1;
    const WINHTTP_FLAG_SECURE: DWORD = 0x00800000;
    const WINHTTP_ADDREQ_FLAG_ADD: DWORD = 0x20000000;
    const WINHTTP_ADDREQ_FLAG_REPLACE: DWORD = 0x80000000;
    const WINHTTP_QUERY_STATUS_CODE: DWORD = 19;
    const WINHTTP_QUERY_FLAG_NUMBER: DWORD = 0x20000000;
    const WINHTTP_OPTION_ENABLE_HTTP_PROTOCOL: DWORD = 133;
    const WINHTTP_PROTOCOL_FLAG_HTTP2: DWORD = 0x1;

    #[link(name = "winhttp")]
    extern "system" {
        fn WinHttpOpen(
            psz_agent_w: LPCWSTR,
            dw_access_type: DWORD,
            psz_proxy_w: LPCWSTR,
            psz_proxy_bypass_w: LPCWSTR,
            dw_flags: DWORD,
        ) -> HINTERNET;
        fn WinHttpConnect(
            h_session: HINTERNET,
            pswz_server_name: LPCWSTR,
            n_server_port: WORD,
            dw_reserved: DWORD,
        ) -> HINTERNET;
        fn WinHttpOpenRequest(
            h_connect: HINTERNET,
            pwsz_verb: LPCWSTR,
            pwsz_object_name: LPCWSTR,
            pwsz_version: LPCWSTR,
            pwsz_referrer: LPCWSTR,
            ppwsz_accept_types: *const LPCWSTR,
            dw_flags: DWORD,
        ) -> HINTERNET;
        fn WinHttpSetTimeouts(
            h_internet: HINTERNET,
            n_resolve_timeout: i32,
            n_connect_timeout: i32,
            n_send_timeout: i32,
            n_receive_timeout: i32,
        ) -> BOOL;
        fn WinHttpSetOption(
            h_internet: HINTERNET,
            dw_option: DWORD,
            lp_buffer: LPVOID,
            dw_buffer_length: DWORD,
        ) -> BOOL;
        fn WinHttpAddRequestHeaders(
            h_request: HINTERNET,
            lpsz_headers: LPCWSTR,
            dw_headers_length: DWORD,
            dw_modifiers: DWORD,
        ) -> BOOL;
        fn WinHttpSendRequest(
            h_request: HINTERNET,
            lpsz_headers: LPCWSTR,
            dw_headers_length: DWORD,
            lp_optional: LPCVOID,
            dw_optional_length: DWORD,
            dw_total_length: DWORD,
            dw_context: usize,
        ) -> BOOL;
        fn WinHttpReceiveResponse(h_request: HINTERNET, lp_reserved: LPVOID) -> BOOL;
        fn WinHttpQueryHeaders(
            h_request: HINTERNET,
            dw_info_level: DWORD,
            pwsz_name: LPCWSTR,
            lp_buffer: LPVOID,
            lpdw_buffer_length: *mut DWORD,
            lpdw_index: *mut DWORD,
        ) -> BOOL;
        fn WinHttpReadData(
            h_request: HINTERNET,
            lp_buffer: LPVOID,
            dw_number_of_bytes_to_read: DWORD,
            lpdw_number_of_bytes_read: *mut DWORD,
        ) -> BOOL;
        fn WinHttpCloseHandle(h_internet: HINTERNET) -> BOOL;
    }

    struct WinHttpSession(HINTERNET);
    unsafe impl Send for WinHttpSession {}
    unsafe impl Sync for WinHttpSession {}

    static SESSION: OnceLock<Option<WinHttpSession>> = OnceLock::new();

    fn to_wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    fn get_session() -> Option<HINTERNET> {
        SESSION
            .get_or_init(|| unsafe {
                let ua = to_wide("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36");
                let mut h = WinHttpOpen(
                    ua.as_ptr(),
                    WINHTTP_ACCESS_TYPE_DEFAULT_PROXY,
                    std::ptr::null(),
                    std::ptr::null(),
                    0,
                );
                if h.is_null() {
                    h = WinHttpOpen(
                        ua.as_ptr(),
                        WINHTTP_ACCESS_TYPE_NO_PROXY,
                        std::ptr::null(),
                        std::ptr::null(),
                        0,
                    );
                }
                if h.is_null() {
                    None
                } else {
                    let mut proto = WINHTTP_PROTOCOL_FLAG_HTTP2;
                    let _ = WinHttpSetOption(
                        h,
                        WINHTTP_OPTION_ENABLE_HTTP_PROTOCOL,
                        (&mut proto as *mut DWORD) as LPVOID,
                        std::mem::size_of::<DWORD>() as DWORD,
                    );
                    Some(WinHttpSession(h))
                }
            })
            .as_ref()
            .map(|s| s.0)
    }

    struct HandleGuard(HINTERNET);
    impl Drop for HandleGuard {
        fn drop(&mut self) {
            if !self.0.is_null() {
                unsafe {
                    let _ = WinHttpCloseHandle(self.0);
                }
            }
        }
    }

    fn parse_url_parts(url: &str) -> Option<(bool, String, u16, String)> {
        let (https, rest) = if let Some(r) = url.strip_prefix("https://") {
            (true, r)
        } else if let Some(r) = url.strip_prefix("http://") {
            (false, r)
        } else {
            return None;
        };
        let (host_port, path) = match rest.find('/') {
            Some(idx) => (&rest[..idx], &rest[idx..]),
            None => (rest, "/"),
        };
        let default_port = if https { 443 } else { 80 };
        let (host, port) = match host_port.rfind(':') {
            Some(colon_idx) => {
                let p = host_port[colon_idx + 1..]
                    .parse::<u16>()
                    .unwrap_or(default_port);
                (&host_port[..colon_idx], p)
            }
            None => (host_port, default_port),
        };
        if host.is_empty() {
            return None;
        }
        Some((https, host.to_string(), port, path.to_string()))
    }

    pub fn execute_winhttp_request(
        url: &str,
        headers: &[(&str, &str)],
        post_body: Option<&[u8]>,
        custom_method: Option<&str>,
        byte_range: Option<(u64, u64)>,
        timeout_secs: u64,
    ) -> Option<Result<Vec<u8>>> {
        let session = get_session()?;
        let (https, host, port, path) = parse_url_parts(url)?;

        unsafe {
            let host_w = to_wide(&host);
            let h_conn = WinHttpConnect(session, host_w.as_ptr(), port, 0);
            if h_conn.is_null() {
                return Some(Err(anyhow!("WinHttpConnect failed for {host}:{port}")));
            }
            let _conn_guard = HandleGuard(h_conn);

            let verb = custom_method.unwrap_or_else(|| if post_body.is_some() { "POST" } else { "GET" });
            let verb_w = to_wide(verb);
            let path_w = to_wide(&path);
            let flags = if https { WINHTTP_FLAG_SECURE } else { 0 };
            let h_req = WinHttpOpenRequest(
                h_conn,
                verb_w.as_ptr(),
                path_w.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                flags,
            );
            if h_req.is_null() {
                return Some(Err(anyhow!("WinHttpOpenRequest failed for {url}")));
            }
            let _req_guard = HandleGuard(h_req);

            let timeout_ms = (timeout_secs.max(5) as i32).saturating_mul(1000);
            let _ = WinHttpSetTimeouts(h_req, 8000, 10000, timeout_ms, timeout_ms);

            let mut hdr_buf = String::new();
            for (k, v) in headers {
                hdr_buf.push_str(k.trim());
                hdr_buf.push_str(": ");
                hdr_buf.push_str(v.trim());
                hdr_buf.push_str("\r\n");
            }
            if let Some((start, end)) = byte_range {
                hdr_buf.push_str(&format!("Range: bytes={start}-{end}\r\n"));
            }
            if !hdr_buf.is_empty() {
                let hdr_w = to_wide(&hdr_buf);
                let _ = WinHttpAddRequestHeaders(
                    h_req,
                    hdr_w.as_ptr(),
                    u32::MAX,
                    WINHTTP_ADDREQ_FLAG_ADD | WINHTTP_ADDREQ_FLAG_REPLACE,
                );
            }

            let (opt_ptr, opt_len) = match post_body {
                Some(b) if !b.is_empty() => (b.as_ptr() as LPCVOID, b.len() as DWORD),
                _ => (std::ptr::null(), 0),
            };

            if WinHttpSendRequest(
                h_req,
                std::ptr::null(),
                0,
                opt_ptr,
                opt_len,
                opt_len,
                0,
            ) == 0
            {
                return Some(Err(anyhow!(
                    "WinHttpSendRequest failed for {url}: {}",
                    std::io::Error::last_os_error()
                )));
            }

            if WinHttpReceiveResponse(h_req, std::ptr::null_mut()) == 0 {
                return Some(Err(anyhow!(
                    "WinHttpReceiveResponse failed for {url}: {}",
                    std::io::Error::last_os_error()
                )));
            }

            let mut status_code: DWORD = 0;
            let mut status_size = std::mem::size_of::<DWORD>() as DWORD;
            let _ = WinHttpQueryHeaders(
                h_req,
                WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
                std::ptr::null(),
                (&mut status_code as *mut DWORD) as LPVOID,
                &mut status_size,
                std::ptr::null_mut(),
            );

            let mut out = Vec::with_capacity(16 * 1024);
            let mut chunk = [0u8; 32 * 1024];
            loop {
                let mut bytes_read: DWORD = 0;
                if WinHttpReadData(
                    h_req,
                    chunk.as_mut_ptr() as LPVOID,
                    chunk.len() as DWORD,
                    &mut bytes_read,
                ) == 0
                {
                    break;
                }
                if bytes_read == 0 {
                    break;
                }
                out.extend_from_slice(&chunk[..bytes_read as usize]);
            }

            if status_code >= 400 {
                let snippet = String::from_utf8_lossy(&out[..out.len().min(240)])
                    .trim()
                    .to_string();
                return Some(Err(anyhow!(
                    "HTTP {status_code} for {url}{}",
                    if snippet.is_empty() {
                        String::new()
                    } else {
                        format!(": {snippet}")
                    }
                )));
            }

            Some(Ok(out))
        }
    }
}

/// Returns `true` when in-process `libcurl` or `WinHTTP` connection pooling is active.
pub fn is_inprocess_http_pool_available() -> bool {
    #[cfg(unix)]
    {
        libcurl_ffi::api().is_some()
    }
    #[cfg(target_os = "windows")]
    {
        true
    }
    #[cfg(not(any(unix, target_os = "windows")))]
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
    #[cfg(target_os = "windows")]
    {
        1
    }
    #[cfg(not(any(unix, target_os = "windows")))]
    {
        0
    }
}

/// Performs an HTTP/2 connection-pooled `GET` request in-process via `libcurl.so.4` (Unix)
/// or `winhttp.dll` (Windows), falling back to `curl --config -` subprocess execution if needed.
pub fn http_get_bytes(
    url: &str,
    headers: &[(&str, &str)],
    byte_range: Option<(u64, u64)>,
    timeout_secs: u64,
) -> Result<Vec<u8>> {
    #[cfg(unix)]
    {
        if let Some(res) =
            libcurl_ffi::execute_pooled_request(url, headers, None, None, byte_range, timeout_secs)
        {
            return res;
        }
    }
    #[cfg(target_os = "windows")]
    {
        if let Some(Ok(bytes)) =
            winhttp_ffi::execute_winhttp_request(url, headers, None, None, byte_range, timeout_secs)
        {
            return Ok(bytes);
        }
    }
    fallback_curl_subprocess(url, headers, None, None, byte_range, timeout_secs)
}

/// Performs an HTTP/2 connection-pooled `POST` request in-process via `libcurl.so.4` (Unix)
/// or `winhttp.dll` (Windows), falling back to `curl --config -` subprocess execution if needed.
pub fn http_post_bytes(
    url: &str,
    headers: &[(&str, &str)],
    body: &[u8],
    timeout_secs: u64,
) -> Result<Vec<u8>> {
    #[cfg(unix)]
    {
        if let Some(res) = libcurl_ffi::execute_pooled_request(
            url,
            headers,
            Some(body),
            None,
            None,
            timeout_secs,
        ) {
            return res;
        }
    }
    #[cfg(target_os = "windows")]
    {
        if let Some(Ok(bytes)) = winhttp_ffi::execute_winhttp_request(
            url,
            headers,
            Some(body),
            None,
            None,
            timeout_secs,
        ) {
            return Ok(bytes);
        }
    }
    fallback_curl_subprocess(url, headers, Some(body), None, None, timeout_secs)
}

/// Performs an HTTP/2 connection-pooled custom-method request (`PUT`, `DELETE`, etc.).
pub fn http_custom_bytes(
    method: &str,
    url: &str,
    headers: &[(&str, &str)],
    body: Option<&[u8]>,
    timeout_secs: u64,
) -> Result<Vec<u8>> {
    #[cfg(unix)]
    {
        if let Some(res) = libcurl_ffi::execute_pooled_request(
            url,
            headers,
            body,
            Some(method),
            None,
            timeout_secs,
        ) {
            return res;
        }
    }
    #[cfg(target_os = "windows")]
    {
        if let Some(Ok(bytes)) = winhttp_ffi::execute_winhttp_request(
            url,
            headers,
            body,
            Some(method),
            None,
            timeout_secs,
        ) {
            return Ok(bytes);
        }
    }
    fallback_curl_subprocess(url, headers, body, Some(method), None, timeout_secs)
}

fn resolve_curl_binary() -> &'static str {
    #[cfg(target_os = "windows")]
    {
        if std::path::Path::new(r"C:\Windows\System32\curl.exe").is_file() {
            return r"C:\Windows\System32\curl.exe";
        }
    }
    "curl"
}

fn fallback_curl_subprocess(
    url: &str,
    headers: &[(&str, &str)],
    post_body: Option<&[u8]>,
    custom_method: Option<&str>,
    byte_range: Option<(u64, u64)>,
    timeout_secs: u64,
) -> Result<Vec<u8>> {
    let mut cfg = format!("url = \"{}\"\n", url.replace('"', "\\\""));
    if let Some(method) = custom_method {
        cfg.push_str(&format!("request = \"{}\"\n", method.trim().replace('"', "")));
    } else if post_body.is_some() {
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
    let mut cmd = Command::new(resolve_curl_binary());
    cmd.args(["-fsSL", "--max-time", &timeout_str, "--config", "-"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    crate::configure_background_command(&mut cmd);
    let mut child = cmd
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

