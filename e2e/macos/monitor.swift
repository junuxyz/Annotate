import AppKit
import CoreGraphics
import Darwin

let root = CommandLine.arguments[1]
let bundle = CommandLine.arguments[2]
let fm = FileManager.default
var activations = 0, visibleSamples = 0, samples = 0, hostChanges = 0
var firstWindow: [String: Any] = [:]
let initial = NSWorkspace.shared.frontmostApplication?.processIdentifier
func target(_ app: NSRunningApplication) -> Bool {
    return app.bundleURL?.path == bundle
}
func pid() -> pid_t? {
    guard let value = try? String(contentsOfFile: root + "/pid", encoding: .utf8) else { return nil }
    return Int32(value.trimmingCharacters(in: .whitespacesAndNewlines))
}
func violation() {
    fm.createFile(atPath: root + "/violation", contents: Data("window or activation".utf8))
    if let process = pid() { kill(process, SIGKILL) }
}
let token = NSWorkspace.shared.notificationCenter.addObserver(
    forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main
) { note in
    if let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication {
        if app.processIdentifier != initial { hostChanges += 1 }
        if target(app) { activations += 1; violation() }
    }
}
try "ready".write(toFile: root + "/ready", atomically: true, encoding: .utf8)
let timer = Timer.scheduledTimer(withTimeInterval: 0.01, repeats: true) { _ in
    if let process = pid() {
        samples += 1
        if NSWorkspace.shared.frontmostApplication?.processIdentifier == process {
            activations += 1; violation()
        }
        guard let windows = CGWindowListCopyWindowInfo(
            [.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID
        ) as? [[String: Any]] else {
            fm.createFile(atPath: root + "/violation", contents: Data("window observer unavailable".utf8))
            kill(process, SIGKILL)
            exit(2)
        }
        if let window = windows.first(where: { ($0[kCGWindowOwnerPID as String] as? Int32) == process }) {
            if firstWindow.isEmpty {
                for key in [kCGWindowLayer, kCGWindowBounds, kCGWindowAlpha, kCGWindowName] {
                    if let value = window[key as String] { firstWindow[key as String] = value }
                }
            }
            visibleSamples += 1; violation()
        }
    }
    if fm.fileExists(atPath: root + "/stop") {
        let data = try! JSONSerialization.data(withJSONObject: [
            "testAppActivations": activations, "visibleWindowSamples": visibleSamples,
            "hostFrontAppChanges": hostChanges, "samples": samples, "firstVisibleWindow": firstWindow
        ])
        do { try data.write(to: URL(fileURLWithPath: root + "/results.json"), options: .atomic) }
        catch { exit(2) }
        exit(0)
    }
}
RunLoop.main.run()
