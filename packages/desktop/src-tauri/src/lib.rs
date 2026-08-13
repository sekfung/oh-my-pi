#![forbid(unsafe_code)]

use std::{
	path::{Path, PathBuf},
	process::Command,
	sync::atomic::{AtomicU64, Ordering},
};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_shell::{
	ShellExt,
	process::{CommandChild, CommandEvent},
};
use tokio::sync::Mutex;

struct SidecarState {
	child:      Mutex<Option<RunningSidecar>>,
	generation: AtomicU64,
	project:    Mutex<Option<PathBuf>>,
}

struct RunningSidecar {
	child: CommandChild,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SidecarExit {
	generation: u64,
	code:       Option<i32>,
}

#[tauri::command]
fn startup_project() -> Option<String> {
	let args = std::env::args().collect::<Vec<_>>();
	let cwd = std::env::current_dir().ok()?;
	project_argument(&args, &cwd)
}

fn project_argument(args: &[String], cwd: &Path) -> Option<String> {
	let mut args = args.iter();
	let raw = loop {
		let argument = args.next()?;
		if argument == "--project" {
			break args.next()?.to_owned();
		}
		if let Some(path) = argument.strip_prefix("--project=") {
			break path.to_owned();
		}
	};
	let project = PathBuf::from(raw);
	let resolved = if project.is_absolute() {
		project
	} else {
		cwd.join(project)
	};
	Some(resolved.to_string_lossy().into_owned())
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
	if !url.starts_with("https://")
		|| url.len() <= "https://".len()
		|| url.chars().any(char::is_control)
	{
		return Err("Only HTTPS external URLs are allowed".to_owned());
	}

	#[cfg(target_os = "linux")]
	let mut command = Command::new("xdg-open");
	#[cfg(target_os = "macos")]
	let mut command = Command::new("open");
	#[cfg(target_os = "windows")]
	let mut command = {
		let mut command = Command::new("rundll32");
		command.arg("url.dll,FileProtocolHandler");
		command
	};
	command
		.arg(url)
		.spawn()
		.map_err(|error| error.to_string())?;
	Ok(())
}

#[tauri::command]
async fn open_path(state: State<'_, SidecarState>, path: String) -> Result<(), String> {
	let target = PathBuf::from(&path)
		.canonicalize()
		.map_err(|error| format!("Unable to open path: {error}"))?;
	let project = state.project.lock().await;
	let root = project
		.as_ref()
		.ok_or_else(|| "No project is open".to_owned())?
		.canonicalize()
		.map_err(|error| format!("Unable to resolve project: {error}"))?;
	if !is_within(&root, &target) {
		return Err("Path is outside the active project".to_owned());
	}

	#[cfg(target_os = "linux")]
	let mut command = Command::new("xdg-open");
	#[cfg(target_os = "macos")]
	let mut command = Command::new("open");
	#[cfg(target_os = "windows")]
	let mut command = {
		let mut command = Command::new("rundll32");
		command.arg("url.dll,FileProtocolHandler");
		command
	};
	command
		.arg(&target)
		.spawn()
		.map_err(|error| error.to_string())?;
	Ok(())
}

fn is_within(root: &Path, target: &Path) -> bool {
	target.starts_with(root)
}

#[tauri::command]
async fn open_project(
	app: AppHandle,
	state: State<'_, SidecarState>,
	path: String,
) -> Result<u64, String> {
	let canonical = PathBuf::from(path)
		.canonicalize()
		.map_err(|error| format!("Unable to open project: {error}"))?;
	if !canonical.is_dir() {
		return Err("Project path is not a directory".to_owned());
	}

	let mut guard = state.child.lock().await;
	if let Some(previous) = guard.take() {
		previous.child.kill().map_err(|error| error.to_string())?;
	}

	let generation = state.generation.fetch_add(1, Ordering::Relaxed) + 1;
	let shell = app.shell();
	let command = match std::env::var_os("OMP_DESKTOP_SIDECAR") {
		Some(executable) => shell.command(executable),
		None => shell
			.sidecar("omp-desktop-sidecar")
			.map_err(|error| error.to_string())?,
	};
	let sidecar = command.args(["--mode", "rpc-ui"]).current_dir(&canonical);
	let (mut events, child) = sidecar.spawn().map_err(|error| error.to_string())?;
	*guard = Some(RunningSidecar { child });
	drop(guard);
	*state.project.lock().await = Some(canonical);

	tauri::async_runtime::spawn(async move {
		while let Some(event) = events.recv().await {
			match event {
				CommandEvent::Stdout(bytes) => {
					let _ = app.emit("omp-sidecar-data", bytes);
				},
				CommandEvent::Stderr(bytes) => {
					let message = String::from_utf8_lossy(&bytes).into_owned();
					let _ = app.emit("omp-sidecar-log", message);
				},
				CommandEvent::Terminated(payload) => {
					let _ = app.emit("omp-sidecar-exit", SidecarExit { generation, code: payload.code });
				},
				_ => {},
			}
		}
	});

	Ok(generation)
}

#[tauri::command]
async fn write_sidecar(state: State<'_, SidecarState>, bytes: Vec<u8>) -> Result<(), String> {
	let mut guard = state.child.lock().await;
	let child = guard
		.as_mut()
		.ok_or_else(|| "Oh My Pi sidecar is not running".to_owned())?;
	child.child.write(&bytes).map_err(|error| error.to_string())
}

#[tauri::command]
async fn close_sidecar(state: State<'_, SidecarState>) -> Result<(), String> {
	let mut guard = state.child.lock().await;
	if let Some(child) = guard.take() {
		child.child.kill().map_err(|error| error.to_string())?;
	}
	Ok(())
}

pub fn run() {
	tauri::Builder::default()
		.plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
			if let Some(project) = project_argument(&args, Path::new(&cwd)) {
				let _ = app.emit("omp-open-project", project);
			}
			if let Some(window) = app.get_webview_window("main") {
				let _ = window.show();
				let _ = window.unminimize();
				let _ = window.set_focus();
			}
		}))
		.plugin(tauri_plugin_dialog::init())
		.plugin(tauri_plugin_shell::init())
		.manage(SidecarState {
			child:      Mutex::new(None),
			generation: AtomicU64::new(0),
			project:    Mutex::new(None),
		})
		.invoke_handler(tauri::generate_handler![
			startup_project,
			open_external_url,
			open_path,
			open_project,
			write_sidecar,
			close_sidecar
		])
		.run(tauri::generate_context!())
		.expect("error while running Oh My Pi desktop application");
}

#[cfg(test)]
mod tests {
	use std::path::Path;

	use super::{is_within, project_argument};

	#[test]
	fn resolves_a_relative_project_from_the_launching_instance_cwd() {
		let args = vec!["omp-desktop".to_owned(), "--project".to_owned(), "work/project".to_owned()];

		assert_eq!(
			project_argument(&args, Path::new("/home/tester")),
			Some("/home/tester/work/project".to_owned())
		);
	}

	#[test]
	fn accepts_the_equals_form_without_changing_an_absolute_project() {
		let args = vec!["omp-desktop".to_owned(), "--project=/srv/project".to_owned()];

		assert_eq!(project_argument(&args, Path::new("/ignored")), Some("/srv/project".to_owned()));
	}

	#[test]
	fn confines_path_opening_to_the_active_project() {
		assert!(is_within(Path::new("/srv/project"), Path::new("/srv/project/src/app.ts")));
		assert!(is_within(Path::new("/srv/project"), Path::new("/srv/project")));
		assert!(!is_within(Path::new("/srv/project"), Path::new("/srv/project-other/app.ts")));
		assert!(!is_within(Path::new("/srv/project"), Path::new("/etc/passwd")));
	}
}
