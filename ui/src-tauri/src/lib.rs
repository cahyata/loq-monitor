use tauri::{
  menu::{Menu, MenuItem},
  tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
  AppHandle, Manager, WindowEvent,
};
use tauri_plugin_notification::NotificationExt;

const TRAY_ID: &str = "main";

/// Updates the tray tooltip. The frontend calls this when the readings change.
#[tauri::command]
fn set_tooltip(app: AppHandle, text: String) {
  if let Some(tray) = app.tray_by_id(TRAY_ID) {
    let _ = tray.set_tooltip(Some(text));
  }
}

/// Shows a desktop notification.
#[tauri::command]
fn notify(app: AppHandle, title: String, body: String) {
  let _ = app.notification().builder().title(title).body(body).show();
}

fn show_main(app: &AppHandle) {
  if let Some(w) = app.get_webview_window("main") {
    let _ = w.show();
    let _ = w.unminimize();
    let _ = w.set_focus();
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_notification::init())
    .invoke_handler(tauri::generate_handler![set_tooltip, notify])
    .on_window_event(|window, event| {
      // The close button hides the window to the tray. "Quit" in the tray menu exits.
      if let WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        let _ = window.hide();
      }
    })
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      let show = MenuItem::with_id(app, "show", "Show LOQ Monitor", true, None::<&str>)?;
      let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
      let menu = Menu::with_items(app, &[&show, &quit])?;

      let mut tray = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("LOQ Monitor")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
          "show" => show_main(app),
          "quit" => app.exit(0),
          _ => {}
        })
        .on_tray_icon_event(|tray, event| {
          if let TrayIconEvent::Click {
            button: MouseButton::Left,
            button_state: MouseButtonState::Up,
            ..
          } = event
          {
            show_main(tray.app_handle());
          }
        });
      if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
      }
      tray.build(app)?;
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
}
