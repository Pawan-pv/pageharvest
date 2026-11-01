"""Drives the real browser toolbar with Windows UI Automation.

The release gate uses this to open PageHarvest the way a person does. Controls are found
by name, never by screen position. Exit codes: 0 done, 1 could not complete the action,
3 UI Automation is not available here.
"""
import argparse
import json
import sys
import time

try:
    from pywinauto import Desktop
except ImportError as error:
    print(json.dumps({"ok": False, "error": f"pywinauto is not available: {error}"}))
    sys.exit(3)

MENU_WAIT_SECONDS = 20
EXTENSION_NAME = "PageHarvest"


def browser_windows(pid):
    return [w for w in Desktop(backend="uia").windows() if w.process_id() == pid]


def named_controls(pid):
    found = []
    for window in browser_windows(pid):
        for control in window.descendants():
            name = control.window_text()
            if name:
                found.append((control.element_info.control_type, name, control))
    return found


def wait_for_control(pid, matches):
    deadline = time.time() + MENU_WAIT_SECONDS
    while time.time() < deadline:
        for control_type, name, control in named_controls(pid):
            if matches(control_type, name):
                return control
        time.sleep(0.5)
    return None


def press(control):
    try:
        control.set_focus()
        control.click_input()
        return "mouse"
    except Exception:  # A runner without an input desktop can still invoke the control.
        control.invoke()
        return "invoke"


def is_button(control_type):
    return control_type in ("Button", "MenuItem", "SplitButton")


def open_extension(pid):
    methods = {}

    pinned = next(
        (
            control
            for control_type, name, control in named_controls(pid)
            if is_button(control_type) and name.startswith(EXTENSION_NAME)
        ),
        None,
    )
    if pinned is not None:
        methods["extension"] = press(pinned)
        return {"ok": True, "route": "pinned", "methods": methods}

    menu = wait_for_control(pid, lambda kind, name: is_button(kind) and name.startswith("Extensions"))
    if menu is None:
        return {"ok": False, "error": 'The toolbar has no "Extensions" button.'}
    methods["menu"] = press(menu)

    item = wait_for_control(
        pid, lambda kind, name: is_button(kind) and name.startswith(EXTENSION_NAME)
    )
    if item is None:
        return {"ok": False, "error": f'The Extensions menu has no "{EXTENSION_NAME}" entry.'}
    methods["extension"] = press(item)
    return {"ok": True, "route": "extensions-menu", "methods": methods}


def close_side_panel(pid):
    button = wait_for_control(pid, lambda kind, name: is_button(kind) and name == "Close side panel")
    if button is None:
        return {"ok": False, "error": 'The toolbar has no "Close side panel" button.'}
    return {"ok": True, "methods": {"close": press(button)}}


def write_tree(pid, path):
    with open(path, "w", encoding="utf-8") as output:
        for window in browser_windows(pid):
            output.write(f"WINDOW {window.window_text()!r}\n")
            for control_type, name, _ in [
                (c.element_info.control_type, c.window_text(), c) for c in window.descendants()
            ]:
                if name:
                    output.write(f"  {control_type}: {name!r}\n")


def save_screenshot(pid, path):
    windows = browser_windows(pid)
    if not windows:
        return False
    windows[0].capture_as_image().save(path)
    return True


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--pid", type=int, required=True)
    parser.add_argument("--tree")
    parser.add_argument("--screenshot")
    parser.add_argument("--open", action="store_true", help="Open the extension from the toolbar")
    parser.add_argument("--close-panel", action="store_true", help="Close the open side panel")
    options = parser.parse_args()

    result = {"ok": True, "windows": [w.window_text() for w in browser_windows(options.pid)]}
    if options.open:
        result.update(open_extension(options.pid))
    if options.close_panel:
        result.update(close_side_panel(options.pid))
    if options.tree:
        write_tree(options.pid, options.tree)
    if options.screenshot:
        result["screenshot"] = save_screenshot(options.pid, options.screenshot)

    print(json.dumps(result))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:  # Reported as evidence rather than a raw traceback.
        print(json.dumps({"ok": False, "error": f"{type(error).__name__}: {error}"}))
        sys.exit(1)
