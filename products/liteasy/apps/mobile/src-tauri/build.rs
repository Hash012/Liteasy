fn main() {
    // NDK r27 needs both flags for 16 KiB LOAD and GNU_RELRO alignment.
    // https://developer.android.com/guide/practices/page-sizes
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("android") {
        println!("cargo:rustc-link-arg-cdylib=-Wl,-z,max-page-size=16384");
        println!("cargo:rustc-link-arg-cdylib=-Wl,-z,common-page-size=16384");
    }
    tauri_build::build()
}
