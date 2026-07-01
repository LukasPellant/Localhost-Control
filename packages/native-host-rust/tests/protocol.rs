use localhost_control_host::{encode_native_message, handle_request, read_native_messages};
use serde_json::json;
use std::io::{Cursor, ErrorKind};

#[test]
fn native_messaging_frames_round_trip_json() {
    let encoded =
        encode_native_message(&json!({ "id": "version-1", "method": "version" })).unwrap();
    let messages = read_native_messages(&mut Cursor::new(encoded)).unwrap();

    assert_eq!(
        messages,
        vec![json!({ "id": "version-1", "method": "version" })]
    );
}

#[test]
fn oversized_native_messaging_frames_are_rejected_before_body_read() {
    let mut encoded = Vec::new();
    encoded.extend_from_slice(&(1_048_577u32).to_le_bytes());

    let error = read_native_messages(&mut Cursor::new(encoded)).unwrap_err();

    assert_eq!(error.kind(), ErrorKind::InvalidData);
}

#[test]
fn version_request_matches_extension_contract() {
    let response = handle_request(json!({ "id": "version-1", "method": "version" })).unwrap();

    assert_eq!(response["id"], "version-1");
    assert_eq!(response["result"]["version"], "0.1.10");
    assert_eq!(response["result"]["platform"], std::env::consts::OS);
}

#[test]
fn resolve_start_port_request_matches_extension_contract() {
    let response = handle_request(json!({
        "id": "port-1",
        "method": "resolveStartPort",
        "params": {
            "preferredPort": 5173,
            "avoidPorts": [5174],
            "searchLimit": 20
        }
    }))
    .unwrap();

    assert_eq!(response["id"], "port-1");
    assert_eq!(response["result"]["preferredPort"], 5173);
    assert!(response["result"]["selectedPort"].as_u64().unwrap() >= 5173);
    assert!(response["result"]["changed"].is_boolean());
}

#[test]
fn command_execution_requires_project_hint() {
    let response = handle_request(json!({
        "id": "terminal-1",
        "method": "openTerminal",
        "params": {
            "commandLine": "pnpm dev",
            "executeCommand": true
        }
    }))
    .unwrap();

    assert_eq!(response["id"], "terminal-1");
    assert_eq!(response["result"]["opened"], false);
    assert_eq!(
        response["result"]["message"],
        "Command execution requires an absolute existing project path."
    );
}

#[test]
fn command_execution_rejects_relative_project_hint() {
    let response = handle_request(json!({
        "id": "terminal-2",
        "method": "openTerminal",
        "params": {
            "projectHint": ".",
            "commandLine": "pnpm dev",
            "executeCommand": true
        }
    }))
    .unwrap();

    assert_eq!(response["id"], "terminal-2");
    assert_eq!(response["result"]["opened"], false);
    assert_eq!(
        response["result"]["message"],
        "Command execution requires an absolute existing project path."
    );
}

#[test]
fn project_folder_open_rejects_relative_paths() {
    let response = handle_request(json!({
        "id": "folder-1",
        "method": "openProjectFolder",
        "params": {
            "projectPath": "."
        }
    }))
    .unwrap();

    assert_eq!(response["id"], "folder-1");
    assert_eq!(response["result"]["opened"], false);
    assert_eq!(
        response["result"]["message"],
        "Project folder opening requires an absolute existing project directory."
    );
}
