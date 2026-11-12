#![cfg(target_os = "macos")]
#![allow(unexpected_cfgs)]

use cocoa::appkit::{
    NSApp, NSApplication, NSApplicationActivationPolicyAccessory,
    NSApplicationActivationPolicyRegular, NSBackingStoreType, NSMenu, NSMenuItem, NSStatusBar,
    NSWindow, NSWindowStyleMask,
};
use cocoa::base::{id, nil, BOOL, NO, YES};
use cocoa::foundation::{NSAutoreleasePool, NSPoint, NSRect, NSSize, NSString};
use dispatch::Queue;
use objc::declare::ClassDecl;
use objc::runtime::{Class, Object, Sel};
use objc::{class, msg_send, sel, sel_impl};
use simp_protocol::AudioCommand;
use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::OnceLock;
use std::time::Duration;

#[link(name = "AppKit", kind = "framework")]
extern "C" {}

#[link(name = "WebKit", kind = "framework")]
extern "C" {}

static MAIN_WINDOW_PTR: AtomicUsize = AtomicUsize::new(0);
static STATUS_MENU_PTR: AtomicUsize = AtomicUsize::new(0);
static STATUS_ITEM_PTR: AtomicUsize = AtomicUsize::new(0);
static STATUS_HEADER_ITEM_PTR: AtomicUsize = AtomicUsize::new(0);

// NSEventMask constants for NSStatusBarButton left/right click detection
const NS_EVENT_MASK_LEFT_MOUSE_UP: u64 = 1 << 2;
const NS_EVENT_MASK_RIGHT_MOUSE_UP: u64 = 1 << 4;
const NS_EVENT_TYPE_RIGHT_MOUSE_UP: u64 = 4;

unsafe fn ns_string(s: &str) -> id {
    NSString::alloc(nil).init_str(s).autorelease()
}

/// Shows the main SIMP window, restores the Dock icon (`NSApplicationActivationPolicyRegular`),
/// and activates the application to the foreground. Safe to call from any thread.
pub fn show_simp_macos_window() {
    Queue::main().exec_async(|| unsafe {
        let win_ptr = MAIN_WINDOW_PTR.load(Ordering::SeqCst) as id;
        if win_ptr == nil {
            return;
        }
        let app = NSApp();
        app.setActivationPolicy_(NSApplicationActivationPolicyRegular);
        let is_mini: BOOL = msg_send![win_ptr, isMiniaturized];
        if is_mini == YES {
            let _: () = msg_send![win_ptr, deminiaturize: nil];
        }
        win_ptr.makeKeyAndOrderFront_(nil);
        app.activateIgnoringOtherApps_(YES);
    });
}

/// Hides the main SIMP window to the Menu Bar and hides the Dock icon (`NSApplicationActivationPolicyAccessory`).
pub unsafe fn hide_simp_macos_window_to_tray(win: id) {
    if win != nil {
        let _: () = msg_send![win, orderOut: nil];
    }
    let app = NSApp();
    app.setActivationPolicy_(NSApplicationActivationPolicyAccessory);
}

/// Toggles the main SIMP window between visible/focused and hidden in the Menu Bar.
pub unsafe fn toggle_simp_macos_window() {
    let win = MAIN_WINDOW_PTR.load(Ordering::SeqCst) as id;
    if win == nil {
        return;
    }
    let is_visible: BOOL = msg_send![win, isVisible];
    let is_key: BOOL = msg_send![win, isKeyWindow];
    let app_active: BOOL = msg_send![NSApp(), isActive];
    if is_visible == YES && is_key == YES && app_active == YES {
        hide_simp_macos_window_to_tray(win);
    } else {
        let app = NSApp();
        app.setActivationPolicy_(NSApplicationActivationPolicyRegular);
        let is_mini: BOOL = msg_send![win, isMiniaturized];
        if is_mini == YES {
            let _: () = msg_send![win, deminiaturize: nil];
        }
        win.makeKeyAndOrderFront_(nil);
        app.activateIgnoringOtherApps_(YES);
    }
}

fn send_daemon_ws_action(json_payload: &'static str) {
    std::thread::spawn(move || {
        // Use HTTP or local command endpoint via curl or TCP
        let _ = std::process::Command::new("curl")
            .args([
                "-fsS",
                "--max-time",
                "1",
                "-X",
                "POST",
                "-H",
                "Content-Type: application/json",
                "-d",
                json_payload,
                "http://127.0.0.1:18888/api/v1/transport",
            ])
            .output();
    });
}


fn resolve_tray_icon_path() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            candidates.push(exe_dir.join("../Resources/simp-icon-dark.png"));
            candidates.push(exe_dir.join("../Resources/ui/simp-icon-dark.png"));
            candidates.push(exe_dir.join("../../ui/public/simp-icon-dark.png"));
            candidates.push(exe_dir.join("../../ui/dist/simp-icon-dark.png"));
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("ui/public/simp-icon-dark.png"));
        candidates.push(cwd.join("ui/dist/simp-icon-dark.png"));
    }
    candidates.into_iter().find(|p| p.is_file())
}

fn resolve_dock_icon_path() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            candidates.push(exe_dir.join("../Resources/SIMP.icns"));
            candidates.push(exe_dir.join("../../dist/SIMP.app/Contents/Resources/SIMP.icns"));
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("dist/SIMP.app/Contents/Resources/SIMP.icns"));
    }
    if let Some(icns) = candidates.into_iter().find(|p| p.is_file()) {
        return Some(icns);
    }
    resolve_tray_icon_path()
}

unsafe fn load_simp_nsimage(size_pt: f64) -> id {
    if let Some(path) = resolve_tray_icon_path() {
        if let Some(path_str) = path.to_str() {
            let ns_path = ns_string(path_str);
            let img: id = msg_send![class!(NSImage), alloc];
            let img: id = msg_send![img, initWithContentsOfFile: ns_path];
            if img != nil {
                let _: () = msg_send![img, setSize: NSSize::new(size_pt, size_pt)];
                return img;
            }
        }
    }
    nil
}

unsafe fn load_simp_dock_nsimage() -> id {
    if let Some(path) = resolve_dock_icon_path() {
        if let Some(path_str) = path.to_str() {
            let ns_path = ns_string(path_str);
            let img: id = msg_send![class!(NSImage), alloc];
            let img: id = msg_send![img, initWithContentsOfFile: ns_path];
            if img != nil {
                return img;
            }
        }
    }
    nil
}

extern "C" fn on_app_should_handle_reopen(
    _this: &Object,
    _cmd: Sel,
    _sender: id,
    _has_visible_windows: BOOL,
) -> BOOL {
    show_simp_macos_window();
    YES
}

extern "C" fn on_window_should_close(this: &Object, _cmd: Sel, sender: id) -> BOOL {
    unsafe {
        let main_win = MAIN_WINDOW_PTR.load(Ordering::SeqCst) as id;
        if sender == main_win {
            // Hide main window to Menu Bar and remove Dock icon while audio continues
            hide_simp_macos_window_to_tray(sender);
            return NO;
        }
        let _ = this;
        YES
    }
}

extern "C" fn on_status_bar_click(_this: &Object, _cmd: Sel, _sender: id) {
    unsafe {
        let app = NSApp();
        let event: id = msg_send![app, currentEvent];
        let mut show_menu = false;
        if event != nil {
            let ev_type: u64 = msg_send![event, type];
            let flags: u64 = msg_send![event, modifierFlags];
            // Right-click or Control-click opens the context menu; Left-click toggles window pop-out
            if ev_type == NS_EVENT_TYPE_RIGHT_MOUSE_UP || (flags & (1 << 18)) != 0 {
                show_menu = true;
            }
        }

        if show_menu {
            let header_item = STATUS_HEADER_ITEM_PTR.load(Ordering::SeqCst) as id;
            if header_item != nil {
                if let Some((summary, _)) = simp_core::mpris::current_now_playing_summary() {
                    let _: () = msg_send![header_item, setTitle: ns_string(&summary)];
                }
            }
            let status_item = STATUS_ITEM_PTR.load(Ordering::SeqCst) as id;
            let menu = STATUS_MENU_PTR.load(Ordering::SeqCst) as id;
            if status_item != nil && menu != nil {
                let _: () = msg_send![status_item, popUpStatusItemMenu: menu];
            }
        } else {
            toggle_simp_macos_window();
        }
    }
}

extern "C" fn on_menu_toggle_window(_this: &Object, _cmd: Sel, _sender: id) {
    unsafe {
        let win = MAIN_WINDOW_PTR.load(Ordering::SeqCst) as id;
        if win != nil {
            let is_vis: BOOL = msg_send![win, isVisible];
            if is_vis == YES {
                hide_simp_macos_window_to_tray(win);
            } else {
                show_simp_macos_window();
            }
        }
    }
}

extern "C" fn on_menu_play_pause(_this: &Object, _cmd: Sel, _sender: id) {
    if !simp_core::mpris::send_inprocess_audio_command(AudioCommand::TogglePlayPause) {
        send_daemon_ws_action(r#"{"command":"toggle_play_pause"}"#);
    }
}

extern "C" fn on_menu_next_track(_this: &Object, _cmd: Sel, _sender: id) {
    if !simp_core::mpris::send_inprocess_audio_command(AudioCommand::Next) {
        send_daemon_ws_action(r#"{"command":"next"}"#);
    }
}

extern "C" fn on_menu_prev_track(_this: &Object, _cmd: Sel, _sender: id) {
    if !simp_core::mpris::send_inprocess_audio_command(AudioCommand::Previous) {
        send_daemon_ws_action(r#"{"command":"previous"}"#);
    }
}

extern "C" fn on_menu_quit_simp(_this: &Object, _cmd: Sel, _sender: id) {
    std::process::exit(0);
}

/// WKUIDelegate `webView:createWebViewWithConfiguration:forNavigationAction:windowFeatures:`
/// Opens a child `NSWindow` + `WKWebView` when MusicKit JS (`mk.authorize()`) or SoundCloud OAuth
/// calls `window.open(...)`, preserving `window.opener` across the shared `WKProcessPool`.
extern "C" fn create_popup_webview(
    this: &Object,
    _cmd: Sel,
    _webview: id,
    configuration: id,
    nav_action: id,
    _window_features: id,
) -> id {
    unsafe {
        let frame = NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(540.0, 700.0));
        let style = NSWindowStyleMask::NSTitledWindowMask
            | NSWindowStyleMask::NSClosableWindowMask
            | NSWindowStyleMask::NSResizableWindowMask;
        let popup_win: id = NSWindow::alloc(nil).initWithContentRect_styleMask_backing_defer_(
            frame,
            style,
            NSBackingStoreType::NSBackingStoreBuffered,
            NO,
        );
        let _: () = msg_send![popup_win, setReleasedWhenClosed: NO];
        popup_win.center();
        popup_win.setTitle_(ns_string("SIMP — Sign In"));

        let dark_appearance: id = msg_send![
            class!(NSAppearance),
            appearanceNamed: ns_string("NSAppearanceNameDarkAqua")
        ];
        if dark_appearance != nil {
            let _: () = msg_send![popup_win, setAppearance: dark_appearance];
        }
        let bg_color: id = msg_send![
            class!(NSColor),
            colorWithSRGBRed: 0.031_f64
            green: 0.031_f64
            blue: 0.047_f64
            alpha: 1.0_f64
        ];
        if bg_color != nil {
            popup_win.setBackgroundColor_(bg_color);
        }

        let child_wv: id = msg_send![class!(WKWebView), alloc];
        let child_wv: id = msg_send![child_wv, initWithFrame: frame configuration: configuration];
        let this_id: id = this as *const Object as id;
        let _: () = msg_send![child_wv, setUIDelegate: this_id];

        // If the navigation action has a targetFrame == nil and an initial URL request, load it if needed
        let target_frame: id = msg_send![nav_action, targetFrame];
        if target_frame == nil {
            let req: id = msg_send![nav_action, request];
            if req != nil {
                let url: id = msg_send![req, URL];
                if url != nil {
                    let abs_str: id = msg_send![url, absoluteString];
                    if abs_str != nil {
                        let len: usize = msg_send![abs_str, length];
                        if len > 0 {
                            // WebKit automatically loads the request into the returned WKWebView
                        }
                    }
                }
            }
        }

        popup_win.setContentView_(child_wv);
        popup_win.makeKeyAndOrderFront_(nil);
        child_wv
    }
}

/// WKUIDelegate `webViewDidClose:` — closes the child popup `NSWindow` when OAuth completes and calls `window.close()`.
extern "C" fn on_popup_webview_did_close(_this: &Object, _cmd: Sel, webview: id) {
    unsafe {
        if webview == nil {
            return;
        }
        let win: id = msg_send![webview, window];
        let main_win = MAIN_WINDOW_PTR.load(Ordering::SeqCst) as id;
        if win != nil && win != main_win {
            let _: () = msg_send![win, close];
        }
    }
}

fn register_delegate_class() -> &'static Class {
    static DELEGATE_CLASS: OnceLock<&'static Class> = OnceLock::new();
    DELEGATE_CLASS.get_or_init(|| unsafe {
        let superclass = class!(NSObject);
        let mut decl = ClassDecl::new("SimpMacAppDelegate", superclass)
            .expect("Failed to declare SimpMacAppDelegate");

        decl.add_method(
            sel!(applicationShouldHandleReopen:hasVisibleWindows:),
            on_app_should_handle_reopen as extern "C" fn(&Object, Sel, id, BOOL) -> BOOL,
        );
        decl.add_method(
            sel!(windowShouldClose:),
            on_window_should_close as extern "C" fn(&Object, Sel, id) -> BOOL,
        );
        decl.add_method(
            sel!(onStatusBarClick:),
            on_status_bar_click as extern "C" fn(&Object, Sel, id),
        );
        decl.add_method(
            sel!(onMenuToggleWindow:),
            on_menu_toggle_window as extern "C" fn(&Object, Sel, id),
        );
        decl.add_method(
            sel!(onMenuPlayPause:),
            on_menu_play_pause as extern "C" fn(&Object, Sel, id),
        );
        decl.add_method(
            sel!(onMenuNextTrack:),
            on_menu_next_track as extern "C" fn(&Object, Sel, id),
        );
        decl.add_method(
            sel!(onMenuPrevTrack:),
            on_menu_prev_track as extern "C" fn(&Object, Sel, id),
        );
        decl.add_method(
            sel!(onMenuQuitSimp:),
            on_menu_quit_simp as extern "C" fn(&Object, Sel, id),
        );
        decl.add_method(
            sel!(webView:createWebViewWithConfiguration:forNavigationAction:windowFeatures:),
            create_popup_webview as extern "C" fn(&Object, Sel, id, id, id, id) -> id,
        );
        decl.add_method(
            sel!(webViewDidClose:),
            on_popup_webview_did_close as extern "C" fn(&Object, Sel, id),
        );

        decl.register()
    })
}

unsafe fn setup_macos_main_menubar(delegate: id) {
    let menubar = NSMenu::new(nil).autorelease();
    let app_menu_item = NSMenuItem::new(nil).autorelease();
    menubar.addItem_(app_menu_item);

    let app_menu = NSMenu::new(nil).autorelease();
    let show_item = NSMenuItem::alloc(nil)
        .initWithTitle_action_keyEquivalent_(
            ns_string("Show / Hide SIMP Window"),
            sel!(onMenuToggleWindow:),
            ns_string("0"),
        )
        .autorelease();
    let _: () = msg_send![show_item, setTarget: delegate];
    app_menu.addItem_(show_item);

    let close_item = NSMenuItem::alloc(nil)
        .initWithTitle_action_keyEquivalent_(
            ns_string("Close Window to Menu Bar"),
            sel!(performClose:),
            ns_string("w"),
        )
        .autorelease();
    app_menu.addItem_(close_item);

    app_menu.addItem_(NSMenuItem::separatorItem(nil));

    let quit_item = NSMenuItem::alloc(nil)
        .initWithTitle_action_keyEquivalent_(
            ns_string("Quit SIMP"),
            sel!(onMenuQuitSimp:),
            ns_string("q"),
        )
        .autorelease();
    let _: () = msg_send![quit_item, setTarget: delegate];
    app_menu.addItem_(quit_item);
    app_menu_item.setSubmenu_(app_menu);

    // Standard Edit menu so Cmd+C / Cmd+V / Cmd+X / Cmd+A work inside WKWebView text inputs
    let edit_menu_item = NSMenuItem::new(nil).autorelease();
    menubar.addItem_(edit_menu_item);
    let edit_menu = NSMenu::alloc(nil).initWithTitle_(ns_string("Edit")).autorelease();
    for (title, action, key) in [
        ("Undo", sel!(undo:), "z"),
        ("Redo", sel!(redo:), "Z"),
        ("Cut", sel!(cut:), "x"),
        ("Copy", sel!(copy:), "c"),
        ("Paste", sel!(paste:), "v"),
        ("Select All", sel!(selectAll:), "a"),
    ] {
        let item = NSMenuItem::alloc(nil)
            .initWithTitle_action_keyEquivalent_(ns_string(title), action, ns_string(key))
            .autorelease();
        edit_menu.addItem_(item);
    }
    edit_menu_item.setSubmenu_(edit_menu);

    NSApp().setMainMenu_(menubar);
}

unsafe fn setup_status_bar_tray(delegate: id) {
    let status_bar = NSStatusBar::systemStatusBar(nil);
    // -2.0 = NSSquareStatusItemLength
    let status_item = status_bar.statusItemWithLength_(-2.0);
    let _: id = msg_send![status_item, retain];
    STATUS_ITEM_PTR.store(status_item as usize, Ordering::SeqCst);

    let button: id = msg_send![status_item, button];
    if button != nil {
        let icon = load_simp_nsimage(18.0);
        if icon != nil {
            let _: () = msg_send![button, setImage: icon];
        } else {
            let _: () = msg_send![button, setTitle: ns_string("🎵")];
        }
        let _: () = msg_send![button, setToolTip: ns_string("SIMP Media Player — Left-click to toggle window, Right-click for menu")];
        let _: () = msg_send![button, setTarget: delegate];
        let _: () = msg_send![button, setAction: sel!(onStatusBarClick:)];
        let _: () = msg_send![
            button,
            sendActionOn: (NS_EVENT_MASK_LEFT_MOUSE_UP | NS_EVENT_MASK_RIGHT_MOUSE_UP)
        ];
    }

    let menu = NSMenu::alloc(nil).initWithTitle_(ns_string("SIMP"));
    let header_item = NSMenuItem::new(nil);
    let _: () = msg_send![header_item, setTitle: ns_string("🎵 SIMP Media Player")];
    let _: () = msg_send![header_item, setEnabled: NO];
    STATUS_HEADER_ITEM_PTR.store(header_item as usize, Ordering::SeqCst);
    menu.addItem_(header_item);
    menu.addItem_(NSMenuItem::separatorItem(nil));

    for (label, action) in [
        ("⏯ Play / Pause", sel!(onMenuPlayPause:)),
        ("⏭ Next Track", sel!(onMenuNextTrack:)),
        ("⏮ Previous Track", sel!(onMenuPrevTrack:)),
    ] {
        let item = NSMenuItem::alloc(nil)
            .initWithTitle_action_keyEquivalent_(ns_string(label), action, ns_string(""))
            .autorelease();
        let _: () = msg_send![item, setTarget: delegate];
        menu.addItem_(item);
    }

    menu.addItem_(NSMenuItem::separatorItem(nil));

    let toggle_win_item = NSMenuItem::alloc(nil)
        .initWithTitle_action_keyEquivalent_(
            ns_string("↗ Show / Hide SIMP Window"),
            sel!(onMenuToggleWindow:),
            ns_string(""),
        )
        .autorelease();
    let _: () = msg_send![toggle_win_item, setTarget: delegate];
    menu.addItem_(toggle_win_item);

    let quit_item = NSMenuItem::alloc(nil)
        .initWithTitle_action_keyEquivalent_(
            ns_string("⏻ Quit SIMP"),
            sel!(onMenuQuitSimp:),
            ns_string("q"),
        )
        .autorelease();
    let _: () = msg_send![quit_item, setTarget: delegate];
    menu.addItem_(quit_item);

    STATUS_MENU_PTR.store(menu as usize, Ordering::SeqCst);
}

/// Ensures the SIMP daemon is running on `127.0.0.1:18888`.
/// On macOS, spawns `simp_daemon::run_daemon()` in-process on a background Tokio runtime
/// if port 18888 is not already bound, unifying `SIMP.app` into a single native process.
pub fn ensure_inprocess_or_existing_daemon() {
    let addr = SocketAddr::from(([127, 0, 0, 1], 18888));
    if TcpStream::connect_timeout(&addr, Duration::from_millis(120)).is_ok() {
        return;
    }

    let _ = std::thread::Builder::new()
        .name("simp-macos-daemon".to_string())
        .spawn(|| {
            let rt = tokio::runtime::Builder::new_multi_thread()
                .worker_threads(2)
                .enable_all()
                .build()
                .expect("Failed to build Tokio runtime for in-process macOS daemon");
            let _ = rt.block_on(simp_daemon::run_daemon());
        });

    for _ in 0..30 {
        if TcpStream::connect_timeout(&addr, Duration::from_millis(100)).is_ok() {
            break;
        }
        std::thread::sleep(Duration::from_millis(80));
    }
}

/// Launches the native macOS Cocoa (`NSApplication` + `NSStatusItem` + `NSWindow` + `WKWebView`) UI.
pub fn run_macos_native_app(ui_url: &str) {
    ensure_inprocess_or_existing_daemon();
    simp_core::mpris::set_native_window_raiser(show_simp_macos_window);

    unsafe {
        let _pool = NSAutoreleasePool::new(nil);
        let app = NSApp();
        app.setActivationPolicy_(NSApplicationActivationPolicyRegular);

        // Set application Dock icon from SIMP.icns (with proper macOS 824x824 squircle padding)
        let dock_icon = load_simp_dock_nsimage();
        if dock_icon != nil {
            let _: () = msg_send![app, setApplicationIconImage: dock_icon];
        }

        let delegate_cls = register_delegate_class();
        let delegate: id = msg_send![delegate_cls, new];
        let _: () = msg_send![app, setDelegate: delegate];

        setup_macos_main_menubar(delegate);
        setup_status_bar_tray(delegate);

        let frame = NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(1280.0, 800.0));
        let style = NSWindowStyleMask::NSTitledWindowMask
            | NSWindowStyleMask::NSClosableWindowMask
            | NSWindowStyleMask::NSMiniaturizableWindowMask
            | NSWindowStyleMask::NSResizableWindowMask;

        let window: id = NSWindow::alloc(nil).initWithContentRect_styleMask_backing_defer_(
            frame,
            style,
            NSBackingStoreType::NSBackingStoreBuffered,
            NO,
        );
        let _: () = msg_send![window, setReleasedWhenClosed: NO];
        let _: () = msg_send![window, setDelegate: delegate];
        window.center();
        window.setTitle_(ns_string("SIMP"));

        // Apply Dark Aqua appearance and #08080c background color so startup never flashes white
        let dark_appearance: id = msg_send![
            class!(NSAppearance),
            appearanceNamed: ns_string("NSAppearanceNameDarkAqua")
        ];
        if dark_appearance != nil {
            let _: () = msg_send![window, setAppearance: dark_appearance];
        }
        let bg_color: id = msg_send![
            class!(NSColor),
            colorWithSRGBRed: 0.031_f64
            green: 0.031_f64
            blue: 0.047_f64
            alpha: 1.0_f64
        ];
        if bg_color != nil {
            window.setBackgroundColor_(bg_color);
        }

        // Configure WKWebView with zero-gesture media playback enabled
        let wk_config: id = msg_send![class!(WKWebViewConfiguration), new];
        // WKAudiovisualMediaTypeNone = 0 (allow autoplay without requiring user gesture)
        let _: () = msg_send![wk_config, setMediaTypesRequiringUserActionForPlayback: 0usize];

        let webview: id = msg_send![class!(WKWebView), alloc];
        let webview: id = msg_send![webview, initWithFrame: frame configuration: wk_config];
        let _: () = msg_send![webview, setUIDelegate: delegate];

        // Allow transparent/dark background before first paint
        let no_val: id = msg_send![class!(NSNumber), numberWithBool: NO];
        let _: () = msg_send![webview, setValue: no_val forKey: ns_string("drawsBackground")];

        let ns_url: id = msg_send![class!(NSURL), URLWithString: ns_string(ui_url)];
        let ns_req: id = msg_send![class!(NSURLRequest), requestWithURL: ns_url];
        let _: id = msg_send![webview, loadRequest: ns_req];

        window.setContentView_(webview);
        MAIN_WINDOW_PTR.store(window as usize, Ordering::SeqCst);

        window.makeKeyAndOrderFront_(nil);
        app.activateIgnoringOtherApps_(YES);
        app.run();
    }
}
