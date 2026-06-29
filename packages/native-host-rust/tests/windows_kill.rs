#[cfg(windows)]
use localhost_control_host::{
    resolve_kill_target, KillParams, Listener, ProcessMetadata, TargetResolution,
};

#[cfg(windows)]
#[test]
fn refuses_to_kill_when_pid_is_not_the_listener_on_the_requested_port() {
    let result = resolve_kill_target(
        &KillParams {
            pid: 1234,
            port: 5173,
            mode: "force-tree".to_string(),
        },
        &[Listener {
            address: "127.0.0.1".to_string(),
            port: 5173,
            pid: 9999,
        }],
        &[ProcessMetadata {
            pid: 1234,
            parent_pid: Some(1),
            process_name: "node.exe".to_string(),
            executable_path: None,
            command_line: None,
            project_hint: None,
        }],
    );

    assert_eq!(
        result,
        TargetResolution::Denied(
            "Refused to kill PID 1234 because it is not the listener on port 5173.".to_string()
        )
    );
}
