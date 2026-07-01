use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::io::{self, Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

pub const VERSION: &str = env!("CARGO_PKG_VERSION");
const MAX_CHROME_REQUEST_BYTES: usize = 1024 * 1024;
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
    execute_command: Option<bool>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectFolderParams {
    project_path: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProcessResources {
    #[serde(skip_serializing_if = "Option::is_none")]
    cpu_percent: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    memory_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    private_memory_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    thread_count: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    handle_count: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    uptime_ms: Option<u64>,
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

#[cfg(windows)]
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
        if length > MAX_CHROME_REQUEST_BYTES {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Native messaging payload exceeded Chrome's 1 MB message limit.",
            ));
        }
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
        if length > MAX_CHROME_REQUEST_BYTES {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Native messaging payload exceeded Chrome's 1 MB message limit.",
            ));
        }
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
        "openProjectFolder" => {
            let params: ProjectFolderParams =
                serde_json::from_value(request.get("params").cloned().unwrap_or(Value::Null))
                    .map_err(|_| {
                        "Request does not match the Localhost Control native host protocol."
                            .to_string()
                    })?;
            open_project_folder(&params)
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
                probes.get(&listener_probe_key(listener)),
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

#[cfg(windows)]
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

#[cfg(windows)]
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

#[cfg(target_os = "linux")]
fn read_tcp_listeners() -> Result<Vec<Listener>, String> {
    let output = Command::new("ss")
        .args(["-ltnp"])
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(parse_ss_listeners(&String::from_utf8_lossy(&output.stdout)))
}

#[cfg(target_os = "macos")]
fn read_tcp_listeners() -> Result<Vec<Listener>, String> {
    let output = Command::new("lsof")
        .args(["-nP", "-iTCP", "-sTCP:LISTEN"])
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(parse_lsof_listeners(&String::from_utf8_lossy(
        &output.stdout,
    )))
}

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn parse_ss_listeners(output: &str) -> Vec<Listener> {
    output
        .lines()
        .filter_map(|line| {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() < 5 || parts[0] != "LISTEN" {
                return None;
            }
            let (address, port) = parse_address_port(parts[3])?;
            let pid = extract_ss_pid(line)?;
            Some(Listener { address, port, pid })
        })
        .collect()
}

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn extract_ss_pid(line: &str) -> Option<u32> {
    let start = line.find("pid=")? + "pid=".len();
    let digits: String = line[start..]
        .chars()
        .take_while(|value| value.is_ascii_digit())
        .collect();
    digits.parse().ok()
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn parse_lsof_listeners(output: &str) -> Vec<Listener> {
    output
        .lines()
        .filter_map(|raw_line| {
            let line = raw_line.trim();
            if line.is_empty() || line.starts_with("COMMAND") {
                return None;
            }
            let parts: Vec<&str> = line.split_whitespace().collect();
            let pid = parts.get(1)?.parse().ok()?;
            let tcp_index = parts.iter().position(|part| *part == "TCP")?;
            let address_port = parts.get(tcp_index + 1)?;
            if !line.ends_with("(LISTEN)") {
                return None;
            }
            let (address, port) = parse_address_port(address_port)?;
            Some(Listener { address, port, pid })
        })
        .collect()
}

fn parse_address_port(value: &str) -> Option<(String, u16)> {
    if value.starts_with('[') {
        let end = value.rfind("]:")?;
        let address = normalize_listener_address(&value[1..end]);
        let port = value[end + 2..].parse().ok()?;
        return Some((address, port));
    }
    let (address, port) = value.rsplit_once(':')?;
    Some((normalize_listener_address(address), port.parse().ok()?))
}

fn normalize_listener_address(address: &str) -> String {
    match address {
        "*" => "0.0.0.0".to_string(),
        "localhost" => "127.0.0.1".to_string(),
        value => value.to_string(),
    }
}

#[cfg(windows)]
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
                cpu_percent: None,
                memory_bytes: value_to_u64(row.working_set_size),
                private_memory_bytes: value_to_u64(row.private_page_count),
                thread_count: value_to_u64(row.thread_count),
                handle_count: value_to_u64(row.handle_count),
                uptime_ms: None,
            };
            (metadata.pid, (metadata, Some(resources)))
        })
        .collect())
}

#[cfg(target_os = "linux")]
fn read_process_metadata(
    pids: &[u32],
) -> Result<HashMap<u32, (ProcessMetadata, Option<ProcessResources>)>, String> {
    let mut result = HashMap::new();
    for pid in pids.iter().copied().collect::<HashSet<_>>() {
        let proc_root = Path::new("/proc").join(pid.to_string());
        let process_name = std::fs::read_to_string(proc_root.join("comm"))
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| format!("pid-{pid}"));
        let command_line = std::fs::read(proc_root.join("cmdline"))
            .ok()
            .map(|bytes| {
                bytes
                    .split(|byte| *byte == 0)
                    .filter(|part| !part.is_empty())
                    .map(|part| String::from_utf8_lossy(part).to_string())
                    .collect::<Vec<_>>()
                    .join(" ")
            })
            .filter(|value| !value.is_empty());
        let executable_path = std::fs::read_link(proc_root.join("exe"))
            .ok()
            .map(|path| path.display().to_string());
        let cwd = std::fs::read_link(proc_root.join("cwd"))
            .ok()
            .map(|path| path.display().to_string());
        let parent_pid = std::fs::read_to_string(proc_root.join("stat"))
            .ok()
            .and_then(|value| parse_proc_stat_parent_pid(&value));
        let resources = read_linux_resources(&proc_root);
        let project_hint = cwd
            .filter(|value| is_likely_project_path(value))
            .or_else(|| derive_project_hint(command_line.as_deref(), executable_path.as_deref()));
        let metadata = ProcessMetadata {
            pid,
            parent_pid,
            process_name,
            executable_path,
            command_line,
            project_hint,
        };
        result.insert(pid, (metadata, resources));
    }
    Ok(result)
}

#[cfg(target_os = "macos")]
fn read_process_metadata(
    pids: &[u32],
) -> Result<HashMap<u32, (ProcessMetadata, Option<ProcessResources>)>, String> {
    let unique: Vec<String> = pids
        .iter()
        .copied()
        .collect::<HashSet<_>>()
        .into_iter()
        .filter(|pid| *pid > 0)
        .map(|pid| pid.to_string())
        .collect();
    if unique.is_empty() {
        return Ok(HashMap::new());
    }
    let output = Command::new("ps")
        .args([
            "-p",
            &unique.join(","),
            "-o",
            "pid=",
            "-o",
            "ppid=",
            "-o",
            "comm=",
            "-o",
            "etime=",
            "-o",
            "%cpu=",
            "-o",
            "rss=",
            "-o",
            "command=",
        ])
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Ok(HashMap::new());
    }
    Ok(parse_darwin_ps_output(&String::from_utf8_lossy(
        &output.stdout,
    )))
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn parse_darwin_ps_output(
    output: &str,
) -> HashMap<u32, (ProcessMetadata, Option<ProcessResources>)> {
    let mut entries = HashMap::new();
    for raw_line in output.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with("PID") {
            continue;
        }
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 7 {
            continue;
        }
        let Ok(pid) = parts[0].parse::<u32>() else {
            continue;
        };
        let parent_pid = parts[1].parse::<u32>().ok();
        let process_name = parts[2].to_string();
        let elapsed = parts[3];
        let cpu_percent = parts[4]
            .parse::<f64>()
            .ok()
            .map(|value| (value * 10.0).round() / 10.0);
        let memory_bytes = parts[5].parse::<u64>().ok().map(|value| value * 1024);
        let command_line = parts[6..].join(" ");
        let executable_path = Some(process_name.clone());
        let project_hint = derive_project_hint(Some(&command_line), executable_path.as_deref());
        let metadata = ProcessMetadata {
            pid,
            parent_pid,
            process_name,
            executable_path,
            command_line: Some(command_line),
            project_hint,
        };
        let resources = ProcessResources {
            cpu_percent,
            memory_bytes,
            private_memory_bytes: None,
            thread_count: None,
            handle_count: None,
            uptime_ms: parse_elapsed_ms(elapsed),
        };
        entries.insert(pid, (metadata, Some(resources)));
    }
    entries
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

fn is_supported_kill_mode(mode: &str) -> bool {
    matches!(mode, "terminate-tree" | "force-tree")
}

#[cfg(windows)]
fn windows_taskkill_args(pid: u32, mode: &str) -> Vec<String> {
    let mut args = vec!["/PID".to_string(), pid.to_string(), "/T".to_string()];
    if mode == "force-tree" {
        args.push("/F".to_string());
    }
    args
}

#[cfg(windows)]
fn kill_process_tree(params: &KillParams) -> Result<Value, String> {
    if !is_supported_kill_mode(&params.mode) {
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
            "portClosed": !is_target_listener_active(&listeners, params.pid, params.port),
            "message": message
        }));
    }

    let args = windows_taskkill_args(params.pid, &params.mode);
    let output = Command::new("taskkill")
        .args(args)
        .creation_flags_no_window()
        .output()
        .map_err(|error| error.to_string())?;
    let port_closed = wait_for_listener_closed(params.pid, params.port, Duration::from_secs(3));
    let failed_message = (!output.status.success())
        .then(|| String::from_utf8_lossy(&output.stderr).trim().to_string())
        .filter(|message| !message.is_empty());
    Ok(build_kill_result(
        params.pid,
        params.port,
        port_closed,
        failed_message,
    ))
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn unix_signals_for_kill_mode(mode: &str) -> Vec<&'static str> {
    match mode {
        "terminate-tree" => vec!["TERM"],
        "force-tree" => vec!["TERM", "KILL"],
        _ => Vec::new(),
    }
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn kill_process_tree(params: &KillParams) -> Result<Value, String> {
    if !is_supported_kill_mode(&params.mode) {
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
            "portClosed": !is_target_listener_active(&listeners, params.pid, params.port),
            "message": message
        }));
    }

    let pids = collect_unix_process_tree(params.pid);
    for (index, signal) in unix_signals_for_kill_mode(&params.mode).iter().enumerate() {
        if index > 0 {
            std::thread::sleep(Duration::from_millis(250));
        }
        for pid in &pids {
            let _ = send_unix_signal(*pid, signal);
        }
    }
    let port_closed = wait_for_listener_closed(params.pid, params.port, Duration::from_secs(3));
    Ok(build_kill_result(
        params.pid,
        params.port,
        port_closed,
        None,
    ))
}

fn build_kill_result(
    pid: u32,
    port: u16,
    port_closed: bool,
    failed_message: Option<String>,
) -> Value {
    json!({
        "killed": port_closed,
        "pid": pid,
        "port": port,
        "portClosed": port_closed,
        "message": if port_closed {
            format!("Killed PID {}; port {} is closed.", pid, port)
        } else {
            failed_message.unwrap_or_else(|| format!("Kill requested for PID {}; port {} is still listening.", pid, port))
        }
    })
}

#[cfg(windows)]
fn powershell_single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

#[cfg(windows)]
fn build_windows_terminal_script(cwd: &str, command_line: Option<&str>) -> String {
    let mut lines = vec![
        "Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue".to_string(),
        format!("Set-Location -LiteralPath {}", powershell_single_quote(cwd)),
    ];
    if let Some(command_line) = command_line
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        lines.push(format!(
            "& cmd.exe /d /s /c {}",
            powershell_single_quote(command_line)
        ));
    }
    format!("{}\r\n", lines.join("\r\n"))
}

#[cfg(windows)]
fn write_windows_terminal_script(script: &str) -> io::Result<String> {
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let path = std::env::temp_dir().join(format!(
        "localhost-control-{}-{timestamp}.ps1",
        std::process::id()
    ));
    std::fs::write(&path, script)?;
    Ok(path.display().to_string())
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn shell_single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

#[cfg(target_os = "macos")]
fn applescript_quote(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

fn command_to_execute(params: &TerminalParams) -> Option<&str> {
    params
        .execute_command
        .unwrap_or(false)
        .then(|| params.command_line.as_deref().map(str::trim))
        .flatten()
        .filter(|command_line| !command_line.is_empty())
}

fn command_execution_cwd(params: &TerminalParams) -> Result<Option<String>, Value> {
    if command_to_execute(params).is_none() {
        return Ok(None);
    }
    let Some(project_hint) = params
        .project_hint
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Err(json!({
            "opened": false,
            "message": "Command execution requires an absolute existing project path."
        }));
    };
    let path = Path::new(project_hint);
    if !path.is_absolute() || !path.exists() {
        return Err(json!({
            "opened": false,
            "message": "Command execution requires an absolute existing project path."
        }));
    }
    Ok(Some(project_hint.to_string()))
}

#[cfg(windows)]
fn open_terminal(params: &TerminalParams) -> Value {
    let command_cwd = match command_execution_cwd(params) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let command_hint = params
        .command_line
        .as_deref()
        .and_then(|command_line| derive_project_hint(Some(command_line), None));
    let cwd = command_cwd
        .or_else(|| {
            params
                .project_hint
                .as_deref()
                .filter(|value| Path::new(value).exists())
                .map(str::to_string)
        })
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
    let command_line = command_to_execute(params);
    let powershell_script = build_windows_terminal_script(&cwd, command_line);
    let powershell_script_path = match write_windows_terminal_script(&powershell_script) {
        Ok(path) => path,
        Err(error) => {
            return json!({
                "opened": false,
                "message": format!("Failed to prepare terminal command: {error}")
            })
        }
    };
    let mut command = Command::new(&terminal);
    if terminal.ends_with("wt.exe") {
        command.args([
            "-d",
            &cwd,
            "powershell.exe",
            "-NoExit",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            &powershell_script_path,
        ]);
    } else {
        command.args([
            "-NoExit",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            &powershell_script_path,
        ]);
    }
    match command
        .current_dir(&cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
    {
        Ok(_) if command_line.is_some() => {
            json!({ "opened": true, "message": format!("Started command in {cwd}") })
        }
        Ok(_) => json!({ "opened": true, "message": format!("Opened terminal in {cwd}") }),
        Err(error) => json!({ "opened": false, "message": error.to_string() }),
    }
}

#[cfg(target_os = "linux")]
fn open_terminal(params: &TerminalParams) -> Value {
    let command_cwd = match command_execution_cwd(params) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let command_hint = params
        .command_line
        .as_deref()
        .and_then(|command_line| derive_project_hint(Some(command_line), None));
    let cwd = command_cwd
        .or_else(|| {
            params
                .project_hint
                .as_deref()
                .filter(|value| Path::new(value).exists())
                .map(str::to_string)
        })
        .or_else(|| command_hint.filter(|value| Path::new(value).exists()))
        .or_else(|| std::env::var("HOME").ok())
        .or_else(|| {
            std::env::current_dir()
                .ok()
                .map(|path| path.display().to_string())
        })
        .unwrap_or_else(|| "/".to_string());
    let command_line = command_to_execute(params);
    for terminal in [
        "xdg-terminal-exec",
        "gnome-terminal",
        "konsole",
        "xfce4-terminal",
        "xterm",
    ] {
        let mut command = Command::new(terminal);
        if let Some(command_line) = command_line {
            if terminal == "gnome-terminal" {
                command.args([
                    "--working-directory",
                    &cwd,
                    "--",
                    "bash",
                    "-lc",
                    command_line,
                ]);
            } else if terminal == "konsole" {
                command.args(["--workdir", &cwd, "-e", "bash", "-lc", command_line]);
            } else if terminal == "xfce4-terminal" {
                command
                    .arg("--working-directory")
                    .arg(&cwd)
                    .arg("--command")
                    .arg(format!("bash -lc {}", shell_single_quote(command_line)));
            } else {
                command.args(["bash", "-lc", command_line]);
            }
        } else if terminal == "gnome-terminal" {
            command.args(["--working-directory", &cwd]);
        } else if terminal == "konsole" {
            command.args(["--workdir", &cwd]);
        }
        match command
            .current_dir(&cwd)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
        {
            Ok(_) => {
                return if command_line.is_some() {
                    json!({ "opened": true, "message": format!("Started command in {cwd}") })
                } else {
                    json!({ "opened": true, "message": format!("Opened terminal in {cwd}") })
                }
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
            Err(error) => return json!({ "opened": false, "message": error.to_string() }),
        }
    }
    json!({ "opened": false, "message": "No supported Linux terminal was found." })
}

#[cfg(target_os = "macos")]
fn open_terminal(params: &TerminalParams) -> Value {
    let command_cwd = match command_execution_cwd(params) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let command_hint = params
        .command_line
        .as_deref()
        .and_then(|command_line| derive_project_hint(Some(command_line), None));
    let cwd = command_cwd
        .or_else(|| {
            params
                .project_hint
                .as_deref()
                .filter(|value| Path::new(value).exists())
                .map(str::to_string)
        })
        .or_else(|| command_hint.filter(|value| Path::new(value).exists()))
        .or_else(|| std::env::var("HOME").ok())
        .or_else(|| {
            std::env::current_dir()
                .ok()
                .map(|path| path.display().to_string())
        })
        .unwrap_or_else(|| "/".to_string());
    if let Some(command_line) = command_to_execute(params) {
        let script = format!(
            "tell application \"Terminal\" to do script \"cd {} && {}\"",
            applescript_quote(&shell_single_quote(&cwd)),
            applescript_quote(command_line)
        );
        return match Command::new("osascript")
            .args(["-e", &script])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
        {
            Ok(_) => json!({ "opened": true, "message": format!("Started command in {cwd}") }),
            Err(error) => json!({ "opened": false, "message": error.to_string() }),
        };
    }
    match Command::new("open")
        .args(["-a", "Terminal", &cwd])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
    {
        Ok(_) => json!({ "opened": true, "message": format!("Opened Terminal in {cwd}") }),
        Err(error) => json!({ "opened": false, "message": error.to_string() }),
    }
}

fn project_folder_error() -> Value {
    json!({
        "opened": false,
        "message": "Project folder opening requires an absolute existing project directory."
    })
}

fn canonical_project_folder(params: &ProjectFolderParams) -> Result<String, Value> {
    let project_path = params.project_path.trim();
    if project_path.is_empty() {
        return Err(project_folder_error());
    }
    let path = Path::new(project_path);
    if !path.is_absolute() || !path.is_dir() {
        return Err(project_folder_error());
    }
    std::fs::canonicalize(path)
        .map(|path| path.display().to_string())
        .map_err(|_| project_folder_error())
}

#[cfg(windows)]
fn open_project_folder(params: &ProjectFolderParams) -> Value {
    let folder = match canonical_project_folder(params) {
        Ok(folder) => folder,
        Err(response) => return response,
    };
    let mut command = Command::new("explorer.exe");
    command.arg(&folder).creation_flags_no_window();
    match command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
    {
        Ok(_) => json!({ "opened": true, "message": format!("Opened project folder {folder}") }),
        Err(error) => json!({ "opened": false, "message": error.to_string() }),
    }
}

#[cfg(target_os = "linux")]
fn open_project_folder(params: &ProjectFolderParams) -> Value {
    let folder = match canonical_project_folder(params) {
        Ok(folder) => folder,
        Err(response) => return response,
    };
    match Command::new("xdg-open")
        .arg(&folder)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
    {
        Ok(_) => json!({ "opened": true, "message": format!("Opened project folder {folder}") }),
        Err(error) => json!({ "opened": false, "message": error.to_string() }),
    }
}

#[cfg(target_os = "macos")]
fn open_project_folder(params: &ProjectFolderParams) -> Value {
    let folder = match canonical_project_folder(params) {
        Ok(folder) => folder,
        Err(response) => return response,
    };
    match Command::new("open")
        .arg(&folder)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
    {
        Ok(_) => json!({ "opened": true, "message": format!("Opened project folder {folder}") }),
        Err(error) => json!({ "opened": false, "message": error.to_string() }),
    }
}

fn is_target_listener_active(listeners: &[Listener], pid: u32, port: u16) -> bool {
    listeners
        .iter()
        .any(|listener| listener.pid == pid && listener.port == port)
}

fn wait_for_listener_closed(pid: u32, port: u16, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if !is_target_listener_active(&read_tcp_listeners().unwrap_or_default(), pid, port) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(120));
    }
    !is_target_listener_active(&read_tcp_listeners().unwrap_or_default(), pid, port)
}

fn listener_probe_key(listener: &Listener) -> (u32, u16) {
    (listener.pid, listener.port)
}

fn probe_listeners(listeners: &[Listener], max_probe_ms: u64) -> HashMap<(u32, u16), ProbeResult> {
    listeners
        .iter()
        .filter_map(|listener| {
            probe_listener(listener, max_probe_ms)
                .map(|probe| (listener_probe_key(listener), probe))
        })
        .collect()
}

fn probe_listener(listener: &Listener, max_probe_ms: u64) -> Option<ProbeResult> {
    let (host, connect_host) = probe_hosts(&listener.address);
    let url = format!("http://{host}:{}", listener.port);
    let address = (connect_host, listener.port)
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

fn probe_hosts(address: &str) -> (&str, &str) {
    match address {
        "0.0.0.0" => ("127.0.0.1", "127.0.0.1"),
        "::" => ("[::1]", "::1"),
        "::1" => ("[::1]", "::1"),
        value => (value, value),
    }
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
        "chrome.exe"
            | "brave.exe"
            | "msedge.exe"
            | "firefox.exe"
            | "chrome"
            | "google-chrome"
            | "chromium"
            | "chromium-browser"
            | "brave"
            | "msedge"
            | "firefox"
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

#[cfg(windows)]
fn value_to_u64(value: Option<Value>) -> Option<u64> {
    match value? {
        Value::Number(number) => number.as_u64(),
        Value::String(text) => text.parse().ok(),
        _ => None,
    }
}

#[cfg(target_os = "linux")]
fn read_linux_resources(proc_root: &Path) -> Option<ProcessResources> {
    let status = std::fs::read_to_string(proc_root.join("status")).ok()?;
    let memory_bytes = read_status_kb(&status, "VmRSS:").map(|value| value * 1024);
    let private_memory_bytes = read_status_kb(&status, "VmData:").map(|value| value * 1024);
    let thread_count = read_status_number(&status, "Threads:");
    let handle_count = std::fs::read_dir(proc_root.join("fd"))
        .ok()
        .map(|entries| entries.filter_map(Result::ok).count() as u64);
    Some(ProcessResources {
        cpu_percent: None,
        memory_bytes,
        private_memory_bytes,
        thread_count,
        handle_count,
        uptime_ms: None,
    })
}

#[cfg(target_os = "linux")]
fn read_status_kb(status: &str, key: &str) -> Option<u64> {
    status
        .lines()
        .find(|line| line.starts_with(key))?
        .split_whitespace()
        .nth(1)?
        .parse()
        .ok()
}

#[cfg(target_os = "linux")]
fn read_status_number(status: &str, key: &str) -> Option<u64> {
    status
        .lines()
        .find(|line| line.starts_with(key))?
        .split_whitespace()
        .nth(1)?
        .parse()
        .ok()
}

#[cfg(target_os = "linux")]
fn parse_proc_stat_parent_pid(stat: &str) -> Option<u32> {
    let end = stat.rfind(") ")?;
    stat[end + 2..].split_whitespace().nth(1)?.parse().ok()
}

#[cfg(target_os = "linux")]
fn is_likely_project_path(value: &str) -> bool {
    !(value == "/"
        || value.starts_with("/usr")
        || value.starts_with("/bin")
        || value.starts_with("/sbin")
        || value.starts_with("/lib"))
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn collect_unix_process_tree(root_pid: u32) -> Vec<u32> {
    #[cfg(target_os = "macos")]
    {
        collect_pgrep_process_tree(root_pid)
    }
    #[cfg(target_os = "linux")]
    {
        collect_linux_process_tree(root_pid)
    }
}

#[cfg(target_os = "linux")]
fn collect_linux_process_tree(root_pid: u32) -> Vec<u32> {
    fn collect(
        pid: u32,
        children_by_parent: &HashMap<u32, Vec<u32>>,
        seen: &mut HashSet<u32>,
        output: &mut Vec<u32>,
    ) {
        if !seen.insert(pid) {
            return;
        }
        if let Some(children) = children_by_parent.get(&pid) {
            for child in children {
                collect(*child, children_by_parent, seen, output);
            }
        }
        output.push(pid);
    }

    let mut children_by_parent: HashMap<u32, Vec<u32>> = HashMap::new();
    if let Ok(entries) = std::fs::read_dir("/proc") {
        for entry in entries.filter_map(Result::ok) {
            let Ok(pid) = entry.file_name().to_string_lossy().parse::<u32>() else {
                continue;
            };
            let Some(parent_pid) = std::fs::read_to_string(entry.path().join("stat"))
                .ok()
                .and_then(|value| parse_proc_stat_parent_pid(&value))
            else {
                continue;
            };
            children_by_parent.entry(parent_pid).or_default().push(pid);
        }
    }

    let mut seen = HashSet::new();
    let mut output = Vec::new();
    collect(root_pid, &children_by_parent, &mut seen, &mut output);
    output
}

#[cfg(target_os = "macos")]
fn collect_pgrep_process_tree(root_pid: u32) -> Vec<u32> {
    fn collect(pid: u32, seen: &mut HashSet<u32>, output: &mut Vec<u32>) {
        if !seen.insert(pid) {
            return;
        }
        let children = Command::new("pgrep")
            .args(["-P", &pid.to_string()])
            .output()
            .ok()
            .filter(|output| output.status.success())
            .map(|output| {
                String::from_utf8_lossy(&output.stdout)
                    .split_whitespace()
                    .filter_map(|value| value.parse::<u32>().ok())
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        for child in children {
            collect(child, seen, output);
        }
        output.push(pid);
    }

    let mut seen = HashSet::new();
    let mut output = Vec::new();
    collect(root_pid, &mut seen, &mut output);
    output
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn send_unix_signal(pid: u32, signal: &str) -> Result<(), String> {
    let status = Command::new("kill")
        .args([format!("-{signal}"), pid.to_string()])
        .status()
        .map_err(|error| error.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("kill -{signal} {pid} failed"))
    }
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn parse_elapsed_ms(value: &str) -> Option<u64> {
    let day_split: Vec<&str> = value.split('-').collect();
    let (days, time) = if day_split.len() == 2 {
        (day_split[0].parse::<u64>().ok()?, day_split[1])
    } else {
        (0, value)
    };
    let parts: Vec<u64> = time
        .split(':')
        .filter_map(|part| part.parse::<u64>().ok())
        .collect();
    let seconds = match parts.as_slice() {
        [minutes, seconds] => days * 86_400 + minutes * 60 + seconds,
        [hours, minutes, seconds] => days * 86_400 + hours * 3_600 + minutes * 60 + seconds,
        _ => return None,
    };
    Some(seconds * 1000)
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
    use super::{
        derive_project_hint, parse_darwin_ps_output, parse_lsof_listeners, parse_ss_listeners,
    };

    #[test]
    fn derives_project_hint_from_node_modules_path_inside_quoted_command() {
        let command_line = "\"node\"   \"D:\\DevelopmentD\\DarkBurn\\node_modules\\.bin\\\\..\\vite\\bin\\vite.js\" --host 127.0.0.1";

        assert_eq!(
            derive_project_hint(Some(command_line), None),
            Some("D:\\DevelopmentD\\DarkBurn".to_string())
        );
    }

    #[test]
    fn parses_linux_ss_listener_with_process_pid() {
        let output = r#"State  Recv-Q Send-Q Local Address:Port Peer Address:PortProcess
LISTEN 0      5          127.0.0.1:5176      0.0.0.0:*    users:(("python3",pid=3040,fd=3))
"#;

        let listeners = parse_ss_listeners(output);

        assert_eq!(listeners.len(), 1);
        assert_eq!(listeners[0].address, "127.0.0.1");
        assert_eq!(listeners[0].port, 5176);
        assert_eq!(listeners[0].pid, 3040);
    }

    #[test]
    fn parses_macos_lsof_listener_with_process_pid() {
        let output = r#"COMMAND   PID USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME
node    42123 pella   23u  IPv4 0x123456789abcdef      0t0  TCP 127.0.0.1:5173 (LISTEN)
Python  42124 pella    4u  IPv6 0x123456789abcdea      0t0  TCP [::1]:8000 (LISTEN)
vite    42125 pella    9u  IPv4 0x123456789abcdeb      0t0  TCP *:5174 (LISTEN)
next    42126 pella   10u  IPv4 0x123456789abcdec      0t0  TCP localhost:3000 (LISTEN)
"#;

        let listeners = parse_lsof_listeners(output);

        assert_eq!(listeners.len(), 4);
        assert_eq!(listeners[0].address, "127.0.0.1");
        assert_eq!(listeners[0].port, 5173);
        assert_eq!(listeners[0].pid, 42123);
        assert_eq!(listeners[1].address, "::1");
        assert_eq!(listeners[1].port, 8000);
        assert_eq!(listeners[1].pid, 42124);
        assert_eq!(listeners[2].address, "0.0.0.0");
        assert_eq!(listeners[2].port, 5174);
        assert_eq!(listeners[2].pid, 42125);
        assert_eq!(listeners[3].address, "127.0.0.1");
        assert_eq!(listeners[3].port, 3000);
        assert_eq!(listeners[3].pid, 42126);
    }

    #[test]
    fn parses_macos_ps_metadata_with_resources() {
        let output =
            "42123 1 /usr/local/bin/node 01:02:03 3.4 2048 node /Users/pella/project/server.js\n";

        let entries = parse_darwin_ps_output(output);
        let (metadata, resources) = entries.get(&42123).expect("metadata should be parsed");

        assert_eq!(metadata.parent_pid, Some(1));
        assert_eq!(metadata.process_name, "/usr/local/bin/node");
        assert_eq!(
            metadata.command_line.as_deref(),
            Some("node /Users/pella/project/server.js")
        );
        let resources = resources.as_ref().expect("resources should be parsed");
        assert_eq!(resources.cpu_percent, Some(3.4));
        assert_eq!(resources.memory_bytes, Some(2_097_152));
        assert_eq!(resources.uptime_ms, Some(3_723_000));
    }

    #[test]
    fn maps_probe_hosts_to_matching_loopback_family() {
        assert_eq!(super::probe_hosts("0.0.0.0"), ("127.0.0.1", "127.0.0.1"));
        assert_eq!(super::probe_hosts("::"), ("[::1]", "::1"));
        assert_eq!(super::probe_hosts("::1"), ("[::1]", "::1"));
        assert_eq!(super::probe_hosts("127.0.0.1"), ("127.0.0.1", "127.0.0.1"));
    }

    #[test]
    fn listener_identity_includes_pid_for_duplicate_ports() {
        let listeners = vec![
            super::Listener {
                address: "127.0.0.1".to_string(),
                port: 5173,
                pid: 100,
            },
            super::Listener {
                address: "::1".to_string(),
                port: 5173,
                pid: 101,
            },
        ];

        assert!(super::is_target_listener_active(&listeners, 100, 5173));
        assert!(super::is_target_listener_active(&listeners, 101, 5173));
        assert!(!super::is_target_listener_active(&listeners, 102, 5173));
        assert_eq!(super::listener_probe_key(&listeners[0]), (100, 5173));
        assert_eq!(super::listener_probe_key(&listeners[1]), (101, 5173));
    }

    #[test]
    fn kill_result_is_not_successful_when_the_target_port_stays_open() {
        let result =
            super::build_kill_result(3040, 5176, false, Some("permission denied".to_string()));

        assert_eq!(result["killed"], false);
        assert_eq!(result["portClosed"], false);
        assert_eq!(result["message"], "permission denied");
    }

    #[cfg(windows)]
    #[test]
    fn windows_terminal_script_runs_saved_command_through_cmd_shell() {
        let command_line = "\"node\" \"D:\\DevelopmentD\\DrawCreator\\node_modules\\.bin\\..\\vite\\bin\\vite.js\" --host 127.0.0.1 --port 5179";

        let script = super::build_windows_terminal_script(
            "D:\\DevelopmentD\\DrawCreator",
            Some(command_line),
        );

        assert!(script.contains("Remove-Item -LiteralPath $PSCommandPath"));
        assert!(script.contains("Set-Location -LiteralPath 'D:\\DevelopmentD\\DrawCreator'"));
        assert!(script.contains("& cmd.exe /d /s /c '\"node\" \"D:\\DevelopmentD\\DrawCreator\\node_modules\\.bin\\..\\vite\\bin\\vite.js\" --host 127.0.0.1 --port 5179'"));
    }

    #[cfg(windows)]
    #[test]
    fn terminate_tree_omits_windows_force_flag() {
        assert_eq!(
            super::windows_taskkill_args(1234, "terminate-tree"),
            vec!["/PID".to_string(), "1234".to_string(), "/T".to_string()]
        );
        assert_eq!(
            super::windows_taskkill_args(1234, "force-tree"),
            vec![
                "/PID".to_string(),
                "1234".to_string(),
                "/T".to_string(),
                "/F".to_string()
            ]
        );
    }

    #[cfg(any(target_os = "linux", target_os = "macos"))]
    #[test]
    fn terminate_tree_sends_only_term_signal() {
        assert_eq!(
            super::unix_signals_for_kill_mode("terminate-tree"),
            vec!["TERM"]
        );
        assert_eq!(
            super::unix_signals_for_kill_mode("force-tree"),
            vec!["TERM", "KILL"]
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn parses_linux_proc_stat_parent_pid() {
        let stat = "1234 (python worker) S 99 1 1 0 -1 4194560";

        assert_eq!(super::parse_proc_stat_parent_pid(stat), Some(99));
    }
}

#[cfg(windows)]
trait CommandExt {
    fn creation_flags_no_window(&mut self) -> &mut Self;
}

#[cfg(windows)]
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
