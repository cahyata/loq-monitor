// LOQ Monitor | Tauri app (tray, notifications, service start)
// Author: cahyata
// Copyright (c) 2026 cahyata
use std::sync::Mutex;
use tauri::{
  menu::{Menu, MenuItem},
  tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
  AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
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

/// Starts the SensorService scheduled task (the user owns it, so no elevation is needed).
#[tauri::command]
fn start_service() -> Result<(), String> {
  use std::os::windows::process::CommandExt;
  const CREATE_NO_WINDOW: u32 = 0x0800_0000;
  let out = std::process::Command::new("schtasks")
    .args(["/run", "/tn", "LOQ Monitor Service"])
    .creation_flags(CREATE_NO_WINDOW)
    .output()
    .map_err(|e| e.to_string())?;
  if out.status.success() { Ok(()) } else { Err(String::from_utf8_lossy(&out.stderr).trim().to_string()) }
}

// ---------------------------------------------------------------------------
// Game overlay: a second window that is transparent, always on top and ignores the mouse, so clicks
// go through to the game. It is created the first time it is shown and only hidden afterwards.
// It cannot draw over a game in exclusive fullscreen; windowed and borderless modes work.
// ---------------------------------------------------------------------------
struct OverlayState {
  corner: String, // "tl", "tc", "tr", "ml", "mr", "bl", "bc" or "br"
  margin_x: f64,  // logical pixels from the screen edge, or the shift from the centre
  margin_y: f64,
  monitor: usize, // index in ordered_monitors, 0 is the primary display
  w: f64,         // content size reported by the overlay page, logical pixels
  h: f64,
  visible: bool,
  hotkey: String,
}

fn overlay_window(app: &AppHandle) -> Option<WebviewWindow> {
  if let Some(w) = app.get_webview_window("overlay") {
    return Some(w);
  }
  let w = WebviewWindowBuilder::new(app, "overlay", WebviewUrl::App("overlay.html".into()))
    .title("LOQ Overlay")
    .inner_size(260.0, 120.0)
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(false)
    .shadow(false)
    .focused(false)
    .visible(false)
    .build()
    .ok()?;
  let _ = w.set_ignore_cursor_events(true);
  Some(w)
}

fn overlay_place(app: &AppHandle) {
  let Some(win) = app.get_webview_window("overlay") else { return };
  let state = app.state::<Mutex<OverlayState>>();
  let st = state.lock().unwrap();
  let all = ordered_monitors(&win);
  let Some(mon) = all.get(st.monitor).or_else(|| all.first()) else { return };
  let scale = mon.scale_factor();
  let size = mon.size();
  let pos = mon.position();
  let w = (st.w * scale).round() as i32;
  let h = (st.h * scale).round() as i32;
  let mx = (st.margin_x * scale).round() as i32;
  let my = (st.margin_y * scale).round() as i32;
  let (sw, sh) = (size.width as i32, size.height as i32);
  // The name has two letters: t, m, b for top, middle, bottom, then l, c, r for left, centre, right.
  let c = st.corner.as_str();
  let x = match c.chars().nth(1) {
    Some('r') => sw - w - mx,
    Some('c') => (sw - w) / 2 + mx,
    _ => mx,
  };
  let y = match c.chars().next() {
    Some('b') => sh - h - my,
    Some('m') => (sh - h) / 2 + my,
    _ => my,
  };
  let _ = win.set_size(LogicalSize::new(st.w, st.h));
  let _ = win.set_position(PhysicalPosition::new(pos.x + x, pos.y + y));
}

/// The connected displays with the primary one first, so index 0 always means "primary".
fn ordered_monitors(win: &WebviewWindow) -> Vec<tauri::Monitor> {
  let mut all: Vec<tauri::Monitor> = win.available_monitors().unwrap_or_default();
  if let Some(p) = win.primary_monitor().ok().flatten() {
    if let Some(i) = all.iter().position(|m| m.position() == p.position()) {
      let m = all.remove(i);
      all.insert(0, m);
    }
  }
  all
}

fn overlay_set_visible(app: &AppHandle, visible: bool) {
  if visible {
    let Some(win) = overlay_window(app) else { return };
    let _ = win.set_ignore_cursor_events(true);
    let _ = win.set_always_on_top(true);
    overlay_place(app);
    let _ = win.show();
    let _ = win.set_always_on_top(true);
  } else if let Some(win) = app.get_webview_window("overlay") {
    let _ = win.hide();
  }
  app.state::<Mutex<OverlayState>>().lock().unwrap().visible = visible;
  let _ = app.emit("overlay-state", visible);
}

fn overlay_toggle_now(app: &AppHandle) {
  let visible = app.state::<Mutex<OverlayState>>().lock().unwrap().visible;
  overlay_set_visible(app, !visible);
}

/// Sets where the overlay sits: a screen corner and a margin from the edges.
#[tauri::command]
fn overlay_configure(app: AppHandle, corner: String, margin_x: f64, margin_y: f64, monitor: usize) {
  {
    let state = app.state::<Mutex<OverlayState>>();
    let mut st = state.lock().unwrap();
    st.corner = corner;
    st.margin_x = margin_x.clamp(-2000.0, 2000.0);
    st.margin_y = margin_y.clamp(-2000.0, 2000.0);
    st.monitor = monitor;
  }
  overlay_place(&app);
}

/// The overlay page reports the size of its content so the window fits it exactly.
#[tauri::command]
fn overlay_resize(app: AppHandle, w: f64, h: f64) {
  {
    let state = app.state::<Mutex<OverlayState>>();
    let mut st = state.lock().unwrap();
    st.w = w.clamp(20.0, 2400.0);
    st.h = h.clamp(20.0, 1400.0);
  }
  overlay_place(&app);
}

/// Names of the connected displays for the Display setting, primary first.
#[tauri::command]
fn overlay_monitors(app: AppHandle) -> Vec<String> {
  let Some(win) = app.get_webview_window("main") else { return vec![] };
  ordered_monitors(&win)
    .iter()
    .enumerate()
    .map(|(i, m)| format!("Display {}{} ({} x {})", i + 1, if i == 0 { ", primary" } else { "" }, m.size().width, m.size().height))
    .collect()
}

/// Async on purpose: a synchronous command runs on the main thread, and building a window there
/// can deadlock on Windows, so the button would do nothing.
#[tauri::command]
async fn overlay_show(app: AppHandle, visible: bool) -> Result<(), String> {
  if visible && overlay_window(&app).is_none() {
    return Err("the overlay window could not be created".into());
  }
  overlay_set_visible(&app, visible);
  Ok(())
}

#[tauri::command]
fn overlay_is_visible(app: AppHandle) -> bool {
  app.state::<Mutex<OverlayState>>().lock().unwrap().visible
}

/// Some games push other windows down; asking again keeps the overlay on top.
#[tauri::command]
fn overlay_raise(app: AppHandle) {
  let visible = app.state::<Mutex<OverlayState>>().lock().unwrap().visible;
  if visible {
    if let Some(win) = app.get_webview_window("overlay") {
      let _ = win.set_always_on_top(true);
    }
  }
}

/// Registers the global key that shows or hides the overlay while a game has focus.
#[tauri::command]
fn overlay_hotkey(app: AppHandle, accelerator: String) -> Result<(), String> {
  let gs = app.global_shortcut();
  let old = app.state::<Mutex<OverlayState>>().lock().unwrap().hotkey.clone();
  if !old.is_empty() {
    let _ = gs.unregister(old.as_str());
  }
  match gs.register(accelerator.as_str()) {
    Ok(()) => {
      app.state::<Mutex<OverlayState>>().lock().unwrap().hotkey = accelerator;
      Ok(())
    }
    Err(e) => {
      if !old.is_empty() {
        let _ = gs.register(old.as_str());
      }
      Err(e.to_string())
    }
  }
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
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(
      tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, _shortcut, event| {
          if event.state() == ShortcutState::Pressed {
            overlay_toggle_now(app);
          }
        })
        .build(),
    )
    .manage(Mutex::new(OverlayState {
      corner: "tl".into(),
      margin_x: 16.0,
      margin_y: 16.0,
      monitor: 0,
      w: 260.0,
      h: 120.0,
      visible: false,
      hotkey: String::new(),
    }))
    .invoke_handler(tauri::generate_handler![
      set_tooltip,
      notify,
      start_service,
      overlay_configure,
      overlay_monitors,
      overlay_resize,
      overlay_show,
      overlay_is_visible,
      overlay_raise,
      overlay_hotkey
    ])
    .on_window_event(|window, event| {
      // The close button of the main window hides it to the tray. "Quit" in the tray menu exits.
      if window.label() == "main" {
        if let WindowEvent::CloseRequested { api, .. } = event {
          api.prevent_close();
          let _ = window.hide();
        }
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
      let overlay = MenuItem::with_id(app, "overlay", "Show or hide game overlay", true, None::<&str>)?;
      let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
      let menu = Menu::with_items(app, &[&show, &overlay, &quit])?;

      let mut tray = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("LOQ Monitor")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
          "show" => show_main(app),
          "overlay" => overlay_toggle_now(app),
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
