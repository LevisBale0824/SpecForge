use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::Path;
use std::sync::mpsc;
use tauri::AppHandle;
use tauri::Emitter;

pub struct FileWatcher {
    _watcher: RecommendedWatcher,
    _rx: mpsc::Receiver<Result<Event, notify::Error>>,
}

impl FileWatcher {
    pub fn new(app: AppHandle, watch_path: String) -> Result<Self, String> {
        let (_tx, rx) = mpsc::channel();

        let app_clone = app.clone();
        let mut watcher = RecommendedWatcher::new(
            move |res: Result<Event, notify::Error>| {
                if let Ok(event) = res {
                    let paths: Vec<String> = event
                        .paths
                        .iter()
                        .map(|p| p.to_string_lossy().to_string())
                        .collect();
                    if !paths.is_empty() {
                        let _ = app_clone.emit("file:changed", paths);
                    }
                }
            },
            Config::default(),
        )
        .map_err(|e| e.to_string())?;

        watcher
            .watch(Path::new(&watch_path), RecursiveMode::Recursive)
            .map_err(|e| e.to_string())?;

        Ok(Self {
            _watcher: watcher,
            _rx: rx,
        })
    }
}
