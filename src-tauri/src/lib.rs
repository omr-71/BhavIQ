
use tauri::Manager;
use tauri_plugin_deep_link::DeepLinkExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_deep_link::init())
        .setup(|app| {
            // Enable logging in development builds.
            #[cfg(debug_assertions)]
            {
                let _ = app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                );
            }

            // Desktop deep-link registration.
            #[cfg(desktop)]
            {
                if let Err(error) = app.deep_link().register_all() {
                    eprintln!(
                        "[BhavIQ] Deep-link registration skipped: {}",
                        error
                    );
                }

                let args: Vec<String> = std::env::args().collect();

                if args.len() > 1 {
                    app.deep_link()
                        .handle_cli_arguments(args.into_iter());
                }
            }

            // Inspect and recover the main window.
            if let Some(window) = app.get_webview_window("main") {
                println!("[BhavIQ] Main window found.");

                println!(
                    "[BhavIQ] Initial visibility: {:?}",
                    window.is_visible()
                );

                println!(
                    "[BhavIQ] Initial minimized state: {:?}",
                    window.is_minimized()
                );

                println!(
                    "[BhavIQ] Initial position: {:?}",
                    window.outer_position()
                );

                println!(
                    "[BhavIQ] Initial size: {:?}",
                    window.outer_size()
                );

                println!(
                    "[BhavIQ] Scale factor: {:?}",
                    window.scale_factor()
                );

                // Restore if minimized.
                match window.is_minimized() {
                    Ok(true) => {
                        if let Err(error) = window.unminimize() {
                            eprintln!(
                                "[BhavIQ] Restore failed: {}",
                                error
                            );
                        }
                    }
                    Ok(false) => {}
                    Err(error) => {
                        eprintln!(
                            "[BhavIQ] Minimized-state check failed: {}",
                            error
                        );
                    }
                }

                // Center the window on the current screen.
                if let Err(error) = window.center() {
                    eprintln!(
                        "[BhavIQ] Centering failed: {}",
                        error
                    );
                }

                // Show the window.
                if let Err(error) = window.show() {
                    eprintln!(
                        "[BhavIQ] Show failed: {}",
                        error
                    );
                }

                // Request keyboard focus.
                if let Err(error) = window.set_focus() {
                    eprintln!(
                        "[BhavIQ] Focus failed: {}",
                        error
                    );
                }

                // Log final state.
                println!(
                    "[BhavIQ] Final visibility: {:?}",
                    window.is_visible()
                );

                println!(
                    "[BhavIQ] Final minimized state: {:?}",
                    window.is_minimized()
                );

                println!(
                    "[BhavIQ] Final position: {:?}",
                    window.outer_position()
                );

                println!(
                    "[BhavIQ] Final size: {:?}",
                    window.outer_size()
                );
            } else {
                eprintln!(
                    "[BhavIQ] ERROR: Main window was not found."
                );
            }

            Ok(())
        });

    if let Err(error) = builder.run(tauri::generate_context!()) {
        eprintln!(
            "[BhavIQ] Application startup/runtime error: {:?}",
            error
        );
    }
}
