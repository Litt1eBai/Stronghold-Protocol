fn main() {
    println!("cargo:rerun-if-env-changed=SP_SERVER_URL");
    let server_url = std::env::var("SP_SERVER_URL").expect("Set SP_SERVER_URL before building");
    println!("cargo:rustc-env=SP_SERVER_URL={}", server_url.trim());
    tauri_build::build()
}
