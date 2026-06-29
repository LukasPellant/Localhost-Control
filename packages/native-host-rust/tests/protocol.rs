use localhost_control_host::{encode_native_message, handle_request, read_native_messages};
use serde_json::json;
use std::io::Cursor;

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
fn version_request_matches_extension_contract() {
    let response = handle_request(json!({ "id": "version-1", "method": "version" })).unwrap();

    assert_eq!(response["id"], "version-1");
    assert_eq!(response["result"]["version"], "0.1.4");
    assert_eq!(response["result"]["platform"], std::env::consts::OS);
}
