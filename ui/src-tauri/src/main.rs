// LOQ Monitor | Tauri app entry point
// Author: cahyata
// Copyright (c) 2026 cahyata
// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
  app_lib::run();
}
