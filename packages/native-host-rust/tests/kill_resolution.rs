use localhost_control_host::{
    resolve_kill_target, KillParams, Listener, ProcessMetadata, TargetResolution,
};

fn kill_params(pid: u32, port: u16) -> KillParams {
    KillParams {
        pid,
        port,
        mode: "force-tree".to_string(),
    }
}

fn listener(pid: u32, port: u16) -> Listener {
    Listener {
        address: "127.0.0.1".to_string(),
        port,
        pid,
    }
}

fn process(pid: u32, process_name: &str, executable_path: Option<&str>) -> ProcessMetadata {
    ProcessMetadata {
        pid,
        parent_pid: Some(1),
        process_name: process_name.to_string(),
        executable_path: executable_path.map(str::to_string),
        command_line: None,
        project_hint: None,
    }
}

#[test]
fn refuses_to_kill_when_pid_is_not_the_listener_on_the_requested_port() {
    let result = resolve_kill_target(
        &kill_params(1234, 5173),
        &[listener(9999, 5173)],
        &[process(1234, "node", None)],
    );

    assert_eq!(
        result,
        TargetResolution::Denied(
            "Refused to kill PID 1234 because it is not the listener on port 5173.".to_string()
        )
    );
}

#[test]
fn refuses_to_kill_browser_processes_even_when_they_own_the_port() {
    let result = resolve_kill_target(
        &kill_params(1234, 9222),
        &[listener(1234, 9222)],
        &[process(1234, "chrome", None)],
    );

    assert_eq!(
        result,
        TargetResolution::Denied(
            "Refused to kill PID 1234 on port 9222: Protected browser process.".to_string()
        )
    );
}

#[test]
fn refuses_to_kill_common_linux_browser_process_names() {
    for process_name in ["google-chrome", "chromium", "chromium-browser", "msedge"] {
        let result = resolve_kill_target(
            &kill_params(1234, 9222),
            &[listener(1234, 9222)],
            &[process(1234, process_name, None)],
        );

        assert_eq!(
            result,
            TargetResolution::Denied(
                "Refused to kill PID 1234 on port 9222: Protected browser process.".to_string()
            )
        );
    }
}

#[test]
fn refuses_to_kill_windows_system_paths_even_when_they_own_the_port() {
    let result = resolve_kill_target(
        &kill_params(1234, 5357),
        &[listener(1234, 5357)],
        &[process(
            1234,
            "some-service.exe",
            Some("C:\\Windows\\System32\\some-service.exe"),
        )],
    );

    assert_eq!(
        result,
        TargetResolution::Denied(
            "Refused to kill PID 1234 on port 5357: Protected Windows executable.".to_string()
        )
    );
}
