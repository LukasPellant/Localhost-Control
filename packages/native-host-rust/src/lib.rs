use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::io::{self, Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

pub const VERSION: &str = env!("CARGO_PKG_VERSION");
const MAX_CHROME_RESPONSE_BYTES: usize = 1024 * 1024;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Listener {
    pub address: String,
    pub port: u16,
    pub pid: u32,
}

#[derive(Clone, Debug)]
pub struct ProcessMetadata {
    pub pid: u32,
    pub parent_pid: Option<u32>,
    pub process_name: String,
    pub executable_path: Option<String>,
    pub command_line: Option<String>,
    pub project_hint: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KillParams {
    pub pid: u32,
    pub port: u16,
    pub mode: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScanParams {
    include_system_ports: bool,
    http_probe: bool,
    max_probe_ms: u64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TerminalParams {
    project_hint: Option<String>,
    command_line: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProcessResources {
    #[serde(skip_serializing_if = "Option::is_none")]
    memory_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    private_memory_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    thread_count: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    handle_count: Option<u64>,
}

#[derive(Clone, Debug, Default)]
struct ProbeResult {
    url: Option<String>,
    title: Option<String>,
    status_code: Option<u16>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TargetResolution {
    Allowed,
    Denied(String),
}

#[derive(Clone, Debug, Deserialize)]
struct CimProcess {
    #[serde(rename = "ProcessId")]
    process_id: u32,
    #[serde(rename = "ParentProcessId")]
    parent_process_id: Option<u32>,
    #[serde(rename = "Name")]
    name: Option<String>,
    #[serde(rename = "ExecutablePath")]
    executable_path: Option<String>,
    #[serde(rename = "CommandLine")]
    command_line: Option<String>,
    #[serde(rename = "WorkingSetSize")]
    working_set_size: Option<Value>,
    #[serde(rename = "PrivatePageCount")]
    private_page_count: Option<Value>,
    #[serde(rename = "ThreadCount")]
    thread_count: Option<Value>,
    #[serde(rename = "HandleCount")]
    handle_count: Option<Value>,
}

pub fn encode_native_message(message: &Value) -> io::Result<Vec<u8>> {
    let mut body = serde_json::to_vec(message)?;
    if body.len() > MAX_CHROME_RESPONSE_BYTES {
        let id = message.get("id").and_then(Value::as_str);
        let fallback = json!({
            "id": id,
            "result": {
                "error": "response_too_large",
                "message": "Native host response exceeded Chrome's 1 MB message limit."
            }
        });
        body = serde_json::to_vec(&fallback)?;
    }

    let mut frame = Vec::with_capacity(4 + body.len());
    frame.extend_from_slice(&(body.len() as u32).to_le_bytes());
    frame.extend_from_slice(&body);
    Ok(frame)
}

pub fn read_native_messages(reader: &mut impl Read) -> io::Result<Vec<Value>> {
    let mut messages = Vec::new();
    loop {
        let mut header = [0u8; 4];
        match reader.read_exact(&mut header) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::UnexpectedEof => break,
            Err(error) => return Err(error),
        }

        let length = u32::from_le_bytes(header) as usize;
        let mut body = vec![0u8; length];
        reader.read_exact(&mut body)?;
        messages.push(serde_json::from_slice(&body).unwrap_or_else(|_| {
            json!({
                "error": "invalid_json",
                "message": "Native messaging payload was not valid JSON."
            })
        }));
    }
    Ok(messages)
}

pub fn run_stdio_loop(mut reader: impl Read, mut writer: impl Write) -> io::Result<()> {
    loop {
        let mut header = [0u8; 4];
        match reader.read_exact(&mut header) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::UnexpectedEof => return Ok(()),
            Err(error) => return Err(error),
        }

        let length = u32::from_le_bytes(header) as usize;
        let mut body = vec![0u8; length];
        reader.read_exact(&mut body)?;
        let request = serde_json::from_slice(&body).unwrap_or_else(|_| {
            json!({
                "error": "invalid_json",
                "message": "Native messaging payload was not valid JSON."
            })
        });
        let response = match handle_request(request) {
            Ok(value) => value,
            Err(message) => json!({ "result": { "error": "internal_error", "message": message } }),
        };
        writer.write_all(&encode_native_message(&response)?)?;
        writer.flush()?;
    }
}

pub fn handle_request(request: Value) -> Result<Value, String> {
    let id = request
        .get("id")
        .and_then(Value::as_str)
        .map(str::to_string);
    let method = request
        .get("method")
        .and_then(Value::as_str)
        .unwrap_or_default();

    let result = match method {
        "version" => json!({ "version": VERSION, "platform": std::env::consts::OS }),
        "scan" => {
            let params: ScanParams =
                serde_json::from_value(request.get("params").cloned().unwrap_or(Value::Null))
                    .map_err(|_| {
                        "Request does not match the Localhost Control native host protocol."
                            .to_string()
                    })?;
            scan_local_ports(&params)?
        }
        "kill" => {
            let params: KillParams =
                serde_json::from_value(request.get("params").cloned().unwrap_or(Value::Null))
                    .map_err(|_| {
                        "Request does not match the Localhost Control native host protocol."
                            .to_string()
                    })?;
            kill_process_tree(&params)?
        }
        "openTerminal" => {
            let params: TerminalParams =
                serde_json::from_value(request.get("params").cloned().unwrap_or(Value::Null))
                    .map_err(|_| {
                        "Request does not match the Localhost Control native host protocol."
                            .to_string()
                    })?;
            open_terminal(&params)
        }
        _ => json!({
            "error": "invalid_request",
            "message": "Request does not match the Localhost Control native host protocol."
        }),
    };

    Ok(json!({ "id": id, "result": result }))
}

fn scan_local_ports(params: &ScanParams) -> Result<Value, String> {
    let started_at = Instant::now();
    let mut listeners = read_tcp_listeners()?;
    listeners.retain(|listener| is_localish(&listener.address));
    if !params.include_system_ports {
        listeners.retain(|listener| listener.port >= 1024);
    }
    let listeners = dedupe_listeners(listeners);
    let pids: Vec<u32> = listeners.iter().map(|listener| listener.pid).collect();
    let metadata = read_process_metadata(&pids).unwrap_or_default();
    let probes = if params.http_probe {
        probe_listeners(&listeners, params.max_probe_ms)
    } else {
        HashMap::new()
    };
    let mut entries: Vec<Value> = listeners
        .iter()
        .map(|listener| {
            build_port_entry(
                listener,
                metadata.get(&listener.pid),
                probes.get(&listener.port),
            )
        })
        .collect();
    entries.sort_by(compare_entries);

    Ok(json!({
        "entries": entries,
        "scannedAt": iso_now(),
        "durationMs": started_at.elapsed().as_millis() as u64
    }))
}

fn read_tcp_listeners() -> Result<Vec<Listener>, String> {
    let output = Command::new("netstat")
        .args(["-ano", "-p", "tcp"])
        .creation_flags_no_window()
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(parse_netstat_listeners(&String::from_utf8_lossy(
        &output.stdout,
    )))
}

fn parse_netstat_listeners(output: &str) -> Vec<Listener> {
    output
        .lines()
        .filter_map(|line| {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() < 5
                || !parts[0].eq_ignore_ascii_case("TCP")
                || !parts[3].eq_ignore_ascii_case("LISTENING")
            {
                return None;
            }
            let (address, port) = parse_address_port(parts[1])?;
            let pid = parts[4].parse().ok()?;
            Some(Listener { address, port, pid })
        })
        .collect()
}

fn parse_address_port(value: &str) -> Option<(String, u16)> {
    if value.starts_with('[') {
        let end = value.rfind("]:")?;
        let address = value[1..end].to_string();
        let port = value[end + 2..].parse().ok()?;
        return Some((address, port));
    }
    let (address, port) = value.rsplit_once(':')?;
    Some((address.to_string(), port.parse().ok()?))
}

fn read_process_metadata(
    pids: &[u32],
) -> Result<HashMap<u32, (ProcessMetadata, Option<ProcessResources>)>, String> {
    let unique: Vec<u32> = pids
        .iter()
        .copied()
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    if unique.is_empty() {
        return Ok(HashMap::new());
    }
    let filter = unique
        .iter()
        .map(|pid| format!("ProcessId={pid}"))
        .collect::<Vec<_>>()
        .join(" OR ");
    let command = format!(
        "$ErrorActionPreference = 'Stop'; \
         Get-CimInstance Win32_Process -Filter \"{filter}\" | \
         Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine,WorkingSetSize,PrivatePageCount,ThreadCount,HandleCount | \
         ConvertTo-Json -Compress"
    );
    let output = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &command])
        .creation_flags_no_window()
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if text.is_empty() {
        return Ok(HashMap::new());
    }
    let value: Value = serde_json::from_str(&text).map_err(|error| error.to_string())?;
    let rows: Vec<CimProcess> = if value.is_array() {
        serde_json::from_value(value).map_err(|error| error.to_string())?
    } else {
        vec![serde_json::from_value(value).map_err(|error| error.to_string())?]
    };

    Ok(rows
        .into_iter()
        .map(|row| {
            let metadata = ProcessMetadata {
                pid: row.process_id,
                parent_pid: row.parent_process_id,
                process_name: row
                    .name
                    .unwrap_or_else(|| format!("pid-{}", row.process_id)),
                executable_path: row.executable_path.clone(),
                command_line: row.command_line.clone(),
                project_hint: derive_project_hint(
                    row.command_line.as_deref(),
                    row.executable_path.as_deref(),
                ),
            };
            let resources = ProcessResources {
                memory_bytes: value_to_u64(row.working_set_size),
                private_memory_bytes: value_to_u64(row.private_page_count),
                thread_count: value_to_u64(row.thread_count),
                handle_count: value_to_u64(row.handle_count),
            };
            (metadata.pid, (metadata, Some(resources)))
        })
        .collect())
}

fn build_port_entry(
    listener: &Listener,
    metadata: Option<&(ProcessMetadata, Option<ProcessResources>)>,
    probe: Option<&ProbeResult>,
) -> Value {
    let process_name = metadata
        .map(|(item, _)| item.process_name.as_str())
        .unwrap_or("unknown");
    let command_line = metadata.and_then(|(item, _)| item.command_line.as_deref());
    let (detected_kind, confidence) = classify_port(
        listener.port,
        process_name,
        command_line,
        probe.and_then(|item| item.title.as_deref()),
        probe.and_then(|item| item.status_code),
    );
    let executable_path = metadata.and_then(|(item, _)| item.executable_path.as_deref());
    let (killable, protection_reason) =
        protection(listener.pid, listener.port, process_name, executable_path);

    let mut entry = json!({
        "port": listener.port,
        "address": listener.address,
        "pid": listener.pid,
        "processName": process_name,
        "detectedKind": detected_kind,
        "confidence": confidence,
        "killable": killable
    });
    insert_optional_str(&mut entry, "executablePath", executable_path);
    insert_optional_str(&mut entry, "commandLine", command_line);
    insert_optional_str(
        &mut entry,
        "projectHint",
        metadata.and_then(|(item, _)| item.project_hint.as_deref()),
    );
    if let Some(parent_pid) = metadata.and_then(|(item, _)| item.parent_pid) {
        entry["parentPid"] = json!(parent_pid);
    }
    if let Some(resources) = metadata.and_then(|(_, resources)| resources.as_ref()) {
        entry["resources"] = serde_json::to_value(resources).unwrap_or(Value::Null);
    }
    if let Some(probe) = probe {
        insert_optional_str(&mut entry, "url", probe.url.as_deref());
        insert_optional_str(&mut entry, "title", probe.title.as_deref());
        if let Some(status_code) = probe.status_code {
            entry["statusCode"] = json!(status_code);
        }
    }
    insert_optional_str(&mut entry, "protectionReason", protection_reason.as_deref());
    entry
}

pub fn resolve_kill_target(
    params: &KillParams,
    listeners: &[Listener],
    metadata: &[ProcessMetadata],
) -> TargetResolution {
    let Some(listener) = listeners
        .iter()
        .find(|listener| listener.pid == params.pid && listener.port == params.port)
    else {
        return TargetResolution::Denied(format!(
            "Refused to kill PID {} because it is not the listener on port {}.",
            params.pid, params.port
        ));
    };
    let process = metadata.iter().find(|item| item.pid == params.pid);
    let process_name = process
        .map(|item| item.process_name.as_str())
        .unwrap_or("unknown");
    let executable_path = process.and_then(|item| item.executable_path.as_deref());
    let (killable, reason) = protection(listener.pid, listener.port, process_name, executable_path);
    if killable {
        TargetResolution::Allowed
    } else {
        TargetResolution::Denied(format!(
            "Refused to kill PID {} on port {}: {}.",
            params.pid,
            params.port,
            reason.unwrap_or_else(|| "Protected process".to_string())
        ))
    }
}

fn kill_process_tree(params: &KillParams) -> Result<Value, String> {
    if params.mode != "force-tree" {
        return Ok(json!({
            "killed": false,
            "pid": params.pid,
            "port": params.port,
            "portClosed": false,
            "message": "Unsupported kill mode."
        }));
    }
    let listeners = read_tcp_listeners()?;
    let metadata_map = read_process_metadata(&[params.pid]).unwrap_or_default();
    let metadata: Vec<ProcessMetadata> = metadata_map
        .values()
        .map(|(item, _)| item.clone())
        .collect();
    if let TargetResolution::Denied(message) = resolve_kill_target(params, &listeners, &metadata) {
        return Ok(json!({
            "killed": false,
            "pid": params.pid,
            "port": params.port,
            "portClosed": !listeners.iter().any(|listener| listener.port == params.port),
            "message": message
        }));
    }

    let output = Command::new("taskkill")
        .args(["/PID", &params.pid.to_string(), "/T", "/F"])
        .creation_flags_no_window()
        .output()
        .map_err(|error| error.to_string())?;
    let port_closed = wait_for_port_closed(params.port, Duration::from_secs(3));
    Ok(json!({
        "killed": output.status.success(),
        "pid": params.pid,
        "port": params.port,
        "portClosed": port_closed,
        "message": if port_closed {
            format!("Killed PID {}; port {} is closed.", params.pid, params.port)
        } else if output.status.success() {
            format!("Killed PID {}; port {} is still listening.", params.pid, params.port)
        } else {
            String::from_utf8_lossy(&output.stderr).trim().to_string()
        }
    }))
}

fn open_terminal(params: &TerminalParams) -> Value {
    let command_hint = params
        .command_line
        .as_deref()
        .and_then(|command_line| derive_project_hint(Some(command_line), None));
    let cwd = params
        .project_hint
        .as_deref()
        .filter(|value| Path::new(value).exists())
        .map(str::to_string)
        .or_else(|| command_hint.filter(|value| Path::new(value).exists()))
        .or_else(|| std::env::var("USERPROFILE").ok())
        .or_else(|| {
            std::env::current_dir()
                .ok()
                .map(|path| path.display().to_string())
        })
        .unwrap_or_else(|| "C:\\".to_string());
    let terminal = std::env::var("LOCALAPPDATA")
        .ok()
        .map(|value| format!("{value}\\Microsoft\\WindowsApps\\wt.exe"))
        .filter(|value| Path::new(value).exists())
        .unwrap_or_else(|| "powershell.exe".to_string());
    let mut command = Command::new(&terminal);
    if terminal.ends_with("wt.exe") {
        command.args(["-d", &cwd]);
    } else {
        command.args([
            "-NoExit",
            "-Command",
            &format!("Set-Location -LiteralPath '{}'", cwd.replace('\'', "''")),
        ]);
    }
    match command
        .current_dir(&cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
    {
        Ok(_) => json!({ "opened": true, "message": format!("Opened terminal in {cwd}") }),
        Err(error) => json!({ "opened": false, "message": error.to_string() }),
    }
}

fn wait_for_port_closed(port: u16, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if !read_tcp_listeners()
            .unwrap_or_default()
            .iter()
            .any(|listener| listener.port == port)
        {
            return true;
        }
        std::thread::sleep(Duration::from_millis(120));
    }
    !read_tcp_listeners()
        .unwrap_or_default()
        .iter()
        .any(|listener| listener.port == port)
}

fn probe_listeners(listeners: &[Listener], max_probe_ms: u64) -> HashMap<u16, ProbeResult> {
    listeners
        .iter()
        .filter_map(|listener| {
            probe_listener(listener, max_probe_ms).map(|probe| (listener.port, probe))
        })
        .collect()
}

fn probe_listener(listener: &Listener, max_probe_ms: u64) -> Option<ProbeResult> {
    let host = if listener.address == "0.0.0.0" || listener.address == "::" {
        "127.0.0.1"
    } else if listener.address == "::1" {
        "[::1]"
    } else {
        &listener.address
    };
    let url = format!("http://{host}:{}", listener.port);
    let address = ("127.0.0.1", listener.port)
        .to_socket_addrs()
        .ok()?
        .next()?;
    let timeout = Duration::from_millis(max_probe_ms.clamp(50, 5000));
    let mut stream = TcpStream::connect_timeout(&address, timeout).ok()?;
    let _ = stream.set_read_timeout(Some(timeout));
    let _ = stream.set_write_timeout(Some(timeout));
    let request = format!("GET / HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n");
    stream.write_all(request.as_bytes()).ok()?;
    let mut response = String::new();
    stream.read_to_string(&mut response).ok()?;
    let status_code = response
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|value| value.parse().ok());
    let title = extract_title(&response);
    Some(ProbeResult {
        url: Some(url),
        title,
        status_code,
    })
}

fn extract_title(response: &str) -> Option<String> {
    let lower = response.to_lowercase();
    let start = lower.find("<title>")? + "<title>".len();
    let end = lower[start..].find("</title>")? + start;
    Some(response[start..end].trim().chars().take(120).collect())
}

fn classify_port(
    port: u16,
    process_name: &str,
    command_line: Option<&str>,
    title: Option<&str>,
    status_code: Option<u16>,
) -> (&'static str, &'static str) {
    let text = format!(
        "{} {} {} {}",
        process_name,
        command_line.unwrap_or_default(),
        title.unwrap_or_default(),
        status_code
            .map(|value| value.to_string())
            .unwrap_or_default()
    )
    .to_lowercase();
    if text.contains("vite") || port == 5173 || port == 5174 {
        ("vite", "high")
    } else if text.contains("next") || port == 3000 {
        ("next", "high")
    } else if text.contains("convex") || port == 3210 {
        ("convex", "high")
    } else if text.contains("python")
        || text.contains("uvicorn")
        || text.contains("flask")
        || text.contains("django")
        || text.contains("http.server")
    {
        ("python", "high")
    } else if text.contains("node")
        || text.contains("npm")
        || text.contains("pnpm")
        || text.contains("yarn")
        || text.contains("bun")
        || text.contains("deno")
    {
        ("node", "medium")
    } else if (3000..=9999).contains(&port) {
        ("static", "low")
    } else {
        ("unknown", "low")
    }
}

fn protection(
    pid: u32,
    port: u16,
    process_name: &str,
    executable_path: Option<&str>,
) -> (bool, Option<String>) {
    let lower_name = process_name.to_lowercase();
    let lower_path = executable_path.unwrap_or_default().to_lowercase();
    let reason = if pid <= 4 {
        Some("Protected system process")
    } else if port < 1024 {
        Some("Protected low system port")
    } else if matches!(
        lower_name.as_str(),
        "system"
            | "registry"
            | "idle"
            | "smss.exe"
            | "csrss.exe"
            | "wininit.exe"
            | "winlogon.exe"
            | "services.exe"
            | "lsass.exe"
            | "svchost.exe"
            | "spoolsv.exe"
            | "fontdrvhost.exe"
            | "wudfhost.exe"
    ) {
        Some("Protected Windows service process")
    } else if matches!(
        lower_name.as_str(),
        "chrome.exe" | "brave.exe" | "msedge.exe" | "firefox.exe" | "chrome" | "brave" | "firefox"
    ) {
        Some("Protected browser process")
    } else if lower_path.starts_with("c:\\windows\\") {
        Some("Protected Windows executable")
    } else {
        None
    };
    (reason.is_none(), reason.map(str::to_string))
}

fn compare_entries(left: &Value, right: &Value) -> std::cmp::Ordering {
    let left_killable = left
        .get("killable")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let right_killable = right
        .get("killable")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    right_killable
        .cmp(&left_killable)
        .then_with(|| confidence_weight(right).cmp(&confidence_weight(left)))
        .then_with(|| {
            left.get("port")
                .and_then(Value::as_u64)
                .cmp(&right.get("port").and_then(Value::as_u64))
        })
        .then_with(|| {
            left.get("pid")
                .and_then(Value::as_u64)
                .cmp(&right.get("pid").and_then(Value::as_u64))
        })
}

fn confidence_weight(entry: &Value) -> u8 {
    match entry
        .get("confidence")
        .and_then(Value::as_str)
        .unwrap_or("low")
    {
        "high" => 3,
        "medium" => 2,
        _ => 1,
    }
}

fn dedupe_listeners(listeners: Vec<Listener>) -> Vec<Listener> {
    let mut by_pid_port: HashMap<(u32, u16), Listener> = HashMap::new();
    for listener in listeners {
        let key = (listener.pid, listener.port);
        let replace = by_pid_port
            .get(&key)
            .map(|existing| {
                address_priority(&listener.address) > address_priority(&existing.address)
            })
            .unwrap_or(true);
        if replace {
            by_pid_port.insert(key, listener);
        }
    }
    by_pid_port.into_values().collect()
}

fn address_priority(address: &str) -> u8 {
    match address {
        "127.0.0.1" => 4,
        "::1" => 3,
        "0.0.0.0" => 2,
        "::" => 1,
        _ => 0,
    }
}

fn is_localish(address: &str) -> bool {
    matches!(address, "127.0.0.1" | "::1" | "0.0.0.0" | "::")
}

fn insert_optional_str(target: &mut Value, key: &str, value: Option<&str>) {
    if let Some(value) = value.filter(|value| !value.is_empty()) {
        target[key] = json!(value);
    }
}

fn value_to_u64(value: Option<Value>) -> Option<u64> {
    match value? {
        Value::Number(number) => number.as_u64(),
        Value::String(text) => text.parse().ok(),
        _ => None,
    }
}

fn derive_project_hint(
    command_line: Option<&str>,
    executable_path: Option<&str>,
) -> Option<String> {
    if let Some(command_line) = command_line {
        let lower_command = command_line.to_lowercase();
        if let Some(index) = lower_command.find("\\node_modules\\") {
            if let Some(start) = find_last_windows_drive_start(command_line, index) {
                return Some(command_line[start..index].trim_matches('"').to_string());
            }
        }
        for token in command_line.split_whitespace() {
            let cleaned = token.trim_matches('"');
            if cleaned.len() > 3
                && cleaned.as_bytes().get(1) == Some(&b':')
                && cleaned.contains('\\')
            {
                let lower = cleaned.to_lowercase();
                if !lower.starts_with("c:\\program files") && !lower.starts_with("c:\\windows") {
                    let path = Path::new(cleaned);
                    return Some(if path.extension().is_some() {
                        path.parent().unwrap_or(path).display().to_string()
                    } else {
                        cleaned.to_string()
                    });
                }
            }
        }
    }
    executable_path.and_then(|value| {
        let lower = value.to_lowercase();
        if lower.starts_with("c:\\windows\\") || lower.starts_with("c:\\program files\\") {
            None
        } else {
            Path::new(value)
                .parent()
                .map(|path| path.display().to_string())
        }
    })
}

fn find_last_windows_drive_start(value: &str, before: usize) -> Option<usize> {
    let bytes = value.as_bytes();
    if bytes.len() < 3 {
        return None;
    }
    let mut result = None;
    let end = before.min(bytes.len().saturating_sub(2));
    for index in 0..end {
        if bytes[index].is_ascii_alphabetic()
            && bytes[index + 1] == b':'
            && bytes[index + 2] == b'\\'
        {
            result = Some(index);
        }
    }
    result
}

fn iso_now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

#[cfg(test)]
mod tests {
    use super::derive_project_hint;

    #[test]
    fn derives_project_hint_from_node_modules_path_inside_quoted_command() {
        let command_line = "\"node\"   \"D:\\DevelopmentD\\DarkBurn\\node_modules\\.bin\\\\..\\vite\\bin\\vite.js\" --host 127.0.0.1";

        assert_eq!(
            derive_project_hint(Some(command_line), None),
            Some("D:\\DevelopmentD\\DarkBurn".to_string())
        );
    }
}

trait CommandExt {
    fn creation_flags_no_window(&mut self) -> &mut Self;
}

impl CommandExt for Command {
    fn creation_flags_no_window(&mut self) -> &mut Self {
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt as _;
            self.creation_flags(0x08000000);
        }
        self
    }
}
