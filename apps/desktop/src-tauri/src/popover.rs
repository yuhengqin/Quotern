use std::sync::Mutex;
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize};

const WIDTH: f64 = 446.0;
const MIN_HEIGHT: f64 = 216.0;
const MAX_HEIGHT: f64 = 716.0;
const MARGIN: f64 = 6.0;

#[derive(Clone, Copy, Debug, PartialEq)]
struct Bounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

// Match Math.round, including negative half-pixel coordinates.
fn js_round(value: f64) -> f64 {
    (value + 0.5).floor()
}

fn bounded_height(height: f64) -> Option<f64> {
    height
        .is_finite()
        .then(|| js_round(height.clamp(MIN_HEIGHT, MAX_HEIGHT)))
}

// This is the DIP equivalent of quotaPopoverBounds in tray-quota.ts.
fn bounds(icon: Bounds, work: Bounds, height: f64) -> Bounds {
    let width = WIDTH.min((work.width - MARGIN * 2.0).max(1.0));
    let height = height.min((work.height - MARGIN * 2.0).max(1.0));
    let missing = icon.width == 0.0 && icon.height == 0.0;
    let x = if missing {
        work.x + work.width - width - MARGIN
    } else {
        icon.x + icon.width / 2.0 - width / 2.0
    };
    let y = if missing {
        work.y + work.height - height - MARGIN
    } else if icon.y < work.y + work.height / 2.0 {
        icon.y + icon.height + MARGIN
    } else {
        icon.y - height - MARGIN
    };
    Bounds {
        x: js_round((work.x + MARGIN).max(x.min(work.x + work.width - width - MARGIN))),
        y: js_round((work.y + MARGIN).max(y.min(work.y + work.height - height - MARGIN))),
        width: js_round(width),
        height: js_round(height),
    }
}

fn physical_bounds(icon: Bounds, work: Bounds, scale: f64, height: f64) -> Bounds {
    let logical = |rect: Bounds| Bounds {
        x: rect.x / scale,
        y: rect.y / scale,
        width: rect.width / scale,
        height: rect.height / scale,
    };
    let result = bounds(logical(icon), logical(work), height);
    Bounds {
        x: (result.x * scale).round(),
        y: (result.y * scale).round(),
        width: (result.width * scale).round(),
        height: (result.height * scale).round(),
    }
}

#[derive(Clone, Copy)]
struct State {
    anchor: Option<(tauri::Rect, PhysicalPosition<f64>)>,
    height: f64,
}

static STATE: Mutex<State> = Mutex::new(State {
    anchor: None,
    height: MIN_HEIGHT,
});

fn apply(app: &AppHandle, state: State) -> tauri::Result<()> {
    let Some(window) = app.get_webview_window("tray") else {
        return Ok(());
    };
    let monitor = if let Some((_, point)) = state.anchor {
        app.monitor_from_point(point.x, point.y)?
    } else {
        None
    };
    let monitor = match monitor {
        Some(monitor) => Some(monitor),
        None => app.primary_monitor()?,
    };
    let Some(monitor) = monitor else {
        return Ok(());
    };
    let scale = monitor.scale_factor();
    if !scale.is_finite() || scale <= 0.0 {
        return Ok(());
    }
    let work = monitor.work_area();
    let work = Bounds {
        x: f64::from(work.position.x),
        y: f64::from(work.position.y),
        width: f64::from(work.size.width),
        height: f64::from(work.size.height),
    };
    let icon = if let Some((rect, _)) = state.anchor {
        let position = rect.position.to_physical::<i32>(scale);
        let size = rect.size.to_physical::<u32>(scale);
        Bounds {
            x: f64::from(position.x),
            y: f64::from(position.y),
            width: f64::from(size.width),
            height: f64::from(size.height),
        }
    } else {
        Bounds {
            x: 0.0,
            y: 0.0,
            width: 0.0,
            height: 0.0,
        }
    };
    let target = physical_bounds(icon, work, scale, state.height);
    window.set_position(PhysicalPosition::new(target.x as i32, target.y as i32))?;
    window.set_size(PhysicalSize::new(target.width as u32, target.height as u32))
}

/// Remember the tray click and position the window if it already exists.
pub fn anchor(
    app: &AppHandle,
    rect: tauri::Rect,
    point: PhysicalPosition<f64>,
) -> tauri::Result<()> {
    let state = {
        let mut state = STATE
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        state.anchor = Some((rect, point));
        *state
    };
    apply(app, state)
}

/// Update the content height and reapply the most recent anchor.
pub fn resize(app: &AppHandle, height: f64) -> tauri::Result<()> {
    let Some(height) = bounded_height(height) else {
        return Ok(());
    };
    let state = {
        let mut state = STATE
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        state.height = height;
        *state
    };
    apply(app, state)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(x: f64, y: f64, width: f64, height: f64) -> Bounds {
        Bounds {
            x,
            y,
            width,
            height,
        }
    }

    #[test]
    fn positions_at_top_and_bottom_and_clamps_both_horizontal_edges() {
        let work = rect(0.0, 0.0, 1000.0, 800.0);
        assert_eq!(
            bounds(rect(0.0, 0.0, 20.0, 20.0), work, 300.0),
            rect(6.0, 26.0, 446.0, 300.0)
        );
        assert_eq!(
            bounds(rect(980.0, 780.0, 20.0, 20.0), work, 300.0),
            rect(548.0, 474.0, 446.0, 300.0)
        );
    }

    #[test]
    fn fallback_and_small_secondary_work_area_match_original() {
        let work = rect(-800.0, 0.0, 800.0, 600.0);
        assert_eq!(
            bounds(rect(-20.0, 600.0, 20.0, 20.0), work, 700.0),
            rect(-452.0, 6.0, 446.0, 588.0)
        );
        assert_eq!(
            bounds(rect(0.0, 0.0, 0.0, 0.0), work, 300.0),
            rect(-452.0, 294.0, 446.0, 300.0)
        );
        assert_eq!(
            bounds(
                rect(0.0, 0.0, 0.0, 0.0),
                rect(0.0, 0.0, 200.0, 180.0),
                300.0
            ),
            rect(6.0, 6.0, 188.0, 168.0)
        );
    }

    #[test]
    fn mixed_dpi_uses_clicked_monitors_scale_and_physical_origin() {
        let target = physical_bounds(
            rect(-30.0, 1170.0, 30.0, 30.0),
            rect(-1200.0, 0.0, 1200.0, 1200.0),
            1.5,
            300.0,
        );
        assert_eq!(target, rect(-678.0, 711.0, 669.0, 450.0));
        assert_eq!(js_round(-1.5), -1.0);
    }

    #[test]
    fn content_height_is_finite_rounded_and_clamped() {
        assert_eq!(bounded_height(f64::NAN), None);
        assert_eq!(bounded_height(f64::INFINITY), None);
        assert_eq!(bounded_height(100.0), Some(216.0));
        assert_eq!(bounded_height(320.5), Some(321.0));
        assert_eq!(bounded_height(900.0), Some(716.0));
    }
}
