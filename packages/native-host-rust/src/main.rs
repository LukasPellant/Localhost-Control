fn main() {
    if let Err(error) = localhost_control_host::run_stdio_loop(std::io::stdin(), std::io::stdout())
    {
        let _ = std::fs::write(
            std::env::temp_dir().join("localhost-control-rust-host.log"),
            error.to_string(),
        );
        std::process::exit(1);
    }
}
